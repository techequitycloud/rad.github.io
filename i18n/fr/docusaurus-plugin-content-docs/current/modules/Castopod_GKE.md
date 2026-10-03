---
title: "Castopod sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Castopod sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Castopod_GKE.md @ 15fd4c7 sha256:ecf413a2959d -->

# Castopod sur GKE Autopilot {#castopod-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_GKE.png" alt="Castopod sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod est une plateforme d'hébergement de podcasts open source, native ActivityPub,
construite sur CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy. Ce module déploie
Castopod sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Castopod et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Castopod fonctionne comme une seule charge de travail web FrankenPHP/Caddy. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods FrankenPHP/Caddy sur le port 8080, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` ; Castopod ne prend pas en charge PostgreSQL |
| Persistance des fichiers | Cloud Filestore (NFS) | Les médias de podcast (audio, illustrations) persistent sur NFS monté dans le répertoire média de Castopod, `/var/www/html/public/media` |
| Stockage d'objets | Cloud Storage | Deux buckets sont provisionnés par défaut (suffixes `data` et `media`) — aucun n'est monté dans le pod sauf si `gcs_volumes` est configuré |
| Cache | Redis (optionnel) | Castopod utilise par défaut un cache de système de fichiers (`CP_CACHE_HANDLER = file`) ; Redis est optionnel |
| Secrets | Secret Manager | `CP_ANALYTICS_SALT` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing / Gateway API | LoadBalancer externe avec une IP statique réservée et HTTPS sans configuration via un nom d'hôte `<ip>.nip.io` auto-émis |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (la variante passe `database_type = null`, qui conserve la valeur par
  défaut commune `MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge et
  cassent les migrations CodeIgniter.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur le loopback, mais
  l'application le compose via TCP.** `enable_cloudsql_volume = true` monte un sidecar
  cloud-sql-proxy écoutant sur `127.0.0.1:3306`, et le module Common code en dur
  `DB_HOST = 127.0.0.1` pour le conteneur de service. Parce que Castopod (CodeIgniter 4) lit sa
  connexion à la base de données à partir de clés `database.default.*` **pointées** — qui ne
  peuvent pas être exprimées comme noms de variables d'environnement Cloud Run/K8s —
  le point d'entrée de la plateforme les écrit dans le fichier `.env` de
  Castopod au démarrage du conteneur plutôt que de les injecter comme variables
  d'environnement.
- **Deux réplicas de configuration existent pour les sondes de santé — un seul est
  effectif.** Les variables `startup_probe`/`liveness_probe` spécifiques à l'application
  Castopod (Groupe 10) l'emportent toujours ; les variables génériques
  `health_check_config`/`startup_probe_config` héritées d'App_GKE sont transmises mais
  structurellement remplacées par la propre configuration de sonde du module Common,
  elles n'ont donc aucun effet pour cette application.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. La charge de travail
  basée sur NFS se déploie avec la stratégie `Recreate`, donc ne pas
  dépasser 1 sans vérifier le comportement du stockage partagé pour les
  téléchargements de médias et le cache d'objets.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/www/html/public/media`) afin que
  l'audio et les illustrations des épisodes téléchargés persistent après les
  redémarrages des pods et soient partagés entre les réplicas — Castopod stocke les
  médias sur le système de fichiers, pas dans la base de données.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **HTTPS sans configuration est activé par défaut.** `enable_custom_domain = true` et
  `reserve_static_ip = true` sont tous deux des valeurs par défaut ; avec `application_domains` laissé vide,
  App_GKE provisionne une Gateway et dérive un nom d'hôte `<ip>.nip.io` gratuit avec
  un certificat géré par Google — aucune configuration DNS n'est requise pour
  atteindre Castopod via HTTPS.
- **`CP_ANALYTICS_SALT` est généré automatiquement** et stocké dans Secret Manager. Il
  anonymise les analyses d'écouteurs de podcast et doit rester stable après le
  premier démarrage.
- **Pas de job de migration séparé — mais les migrations ne sont pas non plus
  automatiques dans l'image de base.** L'image `castopod/castopod` (construite sur
  `serversideup/php`) n'a pas de hook de migration CodeIgniter propre ; son seul
  comportement de migration automatique intégré est spécifique à Laravel
  (`php artisan migrate`, protégé par `AUTORUN_ENABLED`, par défaut
  `false`). Le point d'entrée du wrapper de plateforme (`Castopod_Common/scripts/entrypoint.sh`) exécute
  explicitement `php spark migrate --all` à chaque démarrage du conteneur, de sorte que le schéma
  est créé au premier démarrage une fois que le job `db-init` a provisionné la
  base de données et l'utilisateur.
- **La configuration initiale est manuelle.** Après le déploiement, ouvrez l'URL du
  service et complétez l'assistant d'installation web de Castopod pour créer le
  premier compte super-administrateur et configurer les valeurs par défaut de
  l'instance/podcast.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Castopod {#a-gke-autopilot--the-castopod-workload}

Les pods Castopod sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. Comme la charge de travail est basée sur NFS, le
déploiement utilise la stratégie `Recreate` (une mise à jour progressive
exécuterait deux pods sur le même répertoire média basé sur NFS et la base de
données partagée, ce qui entraînerait un blocage).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Castopod pour les pods, les révisions et les événements. Kubernetes Engine → Services
  & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app~castopod" 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Castopod stocke toutes les données d'application (podcasts, épisodes, utilisateurs,
analyses) dans une instance gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent
via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est
exposée. Lors du premier déploiement, le job `db-init` crée la base de données
d'application, l'utilisateur et les autorisations ; les migrations CodeIgniter
créent ensuite le schéma au premier démarrage du conteneur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe se trouvent tous dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la
rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

**Deux buckets Cloud Storage** sont provisionnés automatiquement par défaut — un
bucket générique `data` (la valeur par défaut de la fondation App_GKE) et un
bucket `media` spécifique à Castopod déclaré par `Castopod_Common`. Aucun n'est
monté dans le système de fichiers du pod à moins que `gcs_volumes` ne soit
explicitement configuré ; au lieu de cela, le répertoire média réel de Castopod
(`/var/www/html/public/media`) est lui-même le montage **NFS (Cloud Filestore)**. Un nouveau
partage se monte vide, de sorte que le point d'entrée réinitialise l'arborescence
média (`persons/`, `podcasts/`, `site/`) et la transmet à
`www-data` à chaque démarrage.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~castopod"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache d'objets optionnel) {#d-redis-optional-object-cache}

Redis est **désactivé par défaut** — Castopod utilise un cache de système de
fichiers (`CP_CACHE_HANDLER = file`). Lorsque `enable_redis = true`, le module injecte
`REDIS_HOST`/`REDIS_PORT` pour le cache d'objets de Castopod ; si `redis_host` est
laissé vide, la fondation le résout à l'IP de la VM du serveur NFS (nécessite
`enable_nfs = true`).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée au lieu du
  Redis colocalisé NFS).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`CP_ANALYTICS_SALT` (utilisé pour anonymiser les analyses d'écouteurs de podcast). Le mot
de passe de la base de données est géré séparément par la fondation. Sur GKE, les
secrets sont projetés dans les pods via le pilote CSI du Secret Store.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true`). Parce que `enable_custom_domain = true` par défaut,
App_GKE provisionne en outre une Gateway et — lorsque `application_domains` est laissé vide
— un nom d'hôte `<ip>.nip.io` sans configuration avec un certificat géré par
Google, de sorte que Castopod est immédiatement accessible via HTTPS sans posséder
de domaine. Un véritable domaine personnalisé peut être fourni à la place.

- **Console :** Network services → Load balancing / Gateways ; VPC network → IP
  addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties standard et d'erreur des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Castopod {#3-castopod-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il se connecte à
  Cloud SQL (socket Unix sous `/cloudsql` via le sidecar Auth Proxy, avec
  repli sur TCP via IP privée), crée de manière idempotente la base de données
  d'application, l'utilisateur et les autorisations, vérifie que l'utilisateur de
  l'application peut se connecter, puis arrête le sidecar proxy. Le job peut être
  réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Les migrations s'exécutent au démarrage du conteneur (pas de job de migration
  séparé) — via le point d'entrée de la plateforme, pas l'image de base.** L'image
  `castopod/castopod` (construite sur `serversideup/php`) n'a pas de hook de migration
  CodeIgniter propre ; son seul comportement de migration automatique est spécifique
  à Laravel (`php artisan migrate`, protégé par `AUTORUN_ENABLED`, par défaut
  `false`) et n'exécuterait pas `spark migrate` de CI4 même s'il était
  activé. Le point d'entrée du wrapper de plateforme (`Castopod_Common/scripts/entrypoint.sh`) exécute
  explicitement `php spark migrate --all` — idempotent, sûr à chaque démarrage — une fois que
  la connectivité `.env`/DB est écrite, de sorte que le schéma est créé au
  premier démarrage une fois que `db-init` a provisionné la base de données et
  l'utilisateur, et la mise à niveau `application_version` applique les changements de schéma
  au prochain démarrage, sans job séparé. Si cet appel explicite est un jour
  supprimé, chaque requête renvoie 500 avec `Table '...' doesn't exist` même si
  `db-init` a réussi — vérifiez `entrypoint.sh` en premier lors du
  débogage de ce symptôme.
- **La configuration de la base de données se trouve dans `.env`, matérialisée au
  démarrage du conteneur.** Castopod (CodeIgniter 4) lit sa connexion par défaut à
  partir de clés natives du framework, notées par des points
  (`database.default.hostname|database|username|password|port|DBDriver|DBPrefix`) qui ne peuvent pas être exprimées comme noms de variables
  d'environnement Kubernetes. Le point d'entrée du wrapper de plateforme les écrit
  dans le fichier `.env` de Castopod à partir de `DB_HOST` injecté par
  la fondation (qui sur GKE est `127.0.0.1`, le sidecar Auth Proxy) et
  `DB_NAME`/`DB_USER`/`DB_PASSWORD`, puis délègue au point
  d'entrée amont de FrankenPHP/Caddy.
- **`CP_BASEURL` est dérivé automatiquement.** Lorsqu'il n'est pas explicitement
  défini, le point d'entrée le dérive de `GKE_SERVICE_URL` injecté par la fondation
  et l'écrit comme `app.baseURL` dans `.env`, de sorte que les liens
  du flux de podcast et des médias reflètent l'adresse réelle du service (y compris
  le nom d'hôte nip.io auto-émis).
- **`CP_ANALYTICS_SALT` doit être stable après le premier démarrage.** Il est généré une
  fois et écrit dans Secret Manager ; le modifier rompt la continuité de la
  déduplication pour les analyses précédemment enregistrées, bien qu'il ne corrompe
  pas les lignes existantes.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour
  terminent l'ancien pod avant de démarrer le nouveau, évitant ainsi que deux pods
  ne se bloquent sur le répertoire média partagé basé sur NFS et les verrous de la
  base de données.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port du conteneur
  avec un délai initial de 30 secondes et une fenêtre de 20 tentatives
  (`period_seconds = 15`), donnant aux migrations CodeIgniter du premier démarrage amplement
  le temps de se terminer. La sonde de vivacité est **HTTP `GET /`** avec un
  délai initial de 300 secondes (5 minutes) — la page d'accueil non authentifiée de
  Castopod renvoie 200 une fois démarrée et connectée à MySQL.
- **Configuration initiale.** Après le déploiement, ouvrez l'URL du service et
  complétez l'assistant d'installation web de Castopod pour créer le premier compte
  super-administrateur et définir le nom de l'instance et les valeurs par défaut du
  podcast. Les téléchargements de médias persistent ensuite dans le répertoire média
  basé sur NFS.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- cat /var/www/html/.env
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement (par leur tag `{{UIMeta group=N}}`, qui ne correspond pas toujours aux
titres de section du fichier source). Seuls les paramètres spécifiques ou notables
pour Castopod sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `castopod` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `castopod/castopod` utilisé comme base de construction personnalisée ; `latest` est épinglé à un tag connu et fonctionnel (`1.15.5`) au moment de la construction via l'ARG de construction `CASTOPOD_VERSION` spécifique à l'application. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU par instance de conteneur Castopod. |
| `memory_limit` | `2Gi` | Minimum ~512Mi pour démarrer ; 2Gi recommandé pour les grandes bibliothèques multimédias. |
| `min_instance_count` | `1` | Maintenir à 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le comportement partagé NFS/cache est vérifié pour plusieurs pods. |
| `container_port` | `8080` | Le serveur FrankenPHP/Caddy de Castopod écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmenter pour les plugins gourmands en mémoire. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; conserver `post_max_size ≥ upload_max_filesize` pour les téléchargements audio d'épisodes. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Castopod et les flux de podcast publics. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, 20 tentatives | Sonde de démarrage effective — remplace la sonde générique `startup_probe_config`, qui est transmise mais surchargée et sans effet. |
| `liveness_probe` | HTTP `/`, délai de 300s | Sonde de vivacité effective contre la page d'accueil non authentifiée de Castopod — remplace la sonde générique `health_check_config`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que l'audio/les illustrations des épisodes téléchargés persistent et soient partagés. |
| `nfs_mount_path` | `/var/www/html/public/media` | Où l'état des médias partagés de Castopod est monté. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Bascule le cache d'objets de Castopod du système de fichiers vers Redis. |
| `redis_host` | `""` | Point d'accès Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Conserve la valeur par défaut de MySQL 8.0 de Common ; Castopod ne prend pas en charge d'autres moteurs. |
| `application_database_name` | `castopod` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `castopod` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway ; avec `application_domains` vide, produit un nom d'hôte HTTPS `<ip>.nip.io` sans configuration. |
| `application_domains` | `[]` | Définir pour utiliser un véritable nom d'hôte personnalisé + certificat géré au lieu du repli nip.io. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements — requise pour que le nom d'hôte nip.io reste constant. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Castopod. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point d'accès de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`data` et `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — un `StatefulSet` forcé
> avec un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné
> comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | La sélection d'un moteur non-MySQL rompt les migrations CodeIgniter et toutes les routes basées sur la base de données. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données de podcast. |
| `enable_nfs` | `true` | Critique | Si NFS est désactivé, l'audio et les illustrations des épisodes téléchargés résident sur un disque éphémère et sont perdus à chaque redémarrage/redéploiement du pod. |
| `CP_ANALYTICS_SALT` (auto-généré) | Ne jamais changer | Élevé | Le modifier après le premier démarrage rompt la continuité de la déduplication des auditeurs pour les analyses précédemment enregistrées. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base de données sur GKE. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans un comportement de stockage/cache partagé vérifié risque un état média incohérent et des analyses dupliquées. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions d'administration authentifiées. |
| `memory_limit` | `2Gi` | Élevé | En dessous de ~512Mi, le pod PHP/FrankenPHP ne démarre pas ; les grandes bibliothèques multimédias nécessitent plus de marge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe et tout nom d'hôte nip.io auto-dérivé peuvent changer lors des redéploiements, ce qui rompt les URL de flux RSS/mis en favoris. |
| `enable_custom_domain` + `application_domains` vide | Bien par défaut (nip.io) | Faible | Produit une URL `<ip>.nip.io` fonctionnelle mais non personnalisée ; définissez `application_domains` pour un véritable nom d'hôte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Castopod
partagée avec la variante Cloud Run est décrite dans
**[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Castopod sur GKE Autopilot](../labs/Castopod_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Castopod sur Google Cloud Run](Castopod_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Castopod Common — Configuration d'application partagée](Castopod_Common.md) — la configuration partagée par les deux cibles de déploiement.
