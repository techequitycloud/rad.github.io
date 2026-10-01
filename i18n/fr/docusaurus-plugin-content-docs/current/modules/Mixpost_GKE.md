---
title: "Mixpost sur GKE Autopilot"
description: "Référence de configuration pour déployer Mixpost sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mixpost_GKE.md @ 3055034 sha256:69a8b595d41e -->

# Mixpost sur GKE Autopilot {#mixpost-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mixpost_GKE.png" alt="Mixpost sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mixpost est une plateforme open source et auto-hébergée de planification et de gestion des réseaux sociaux — une alternative à Buffer/Hootsuite pour rédiger, planifier, publier et analyser des publications sur plusieurs comptes sociaux depuis un seul tableau de bord. Elle est livrée sous forme d'application Laravel (nginx + PHP-FPM + supervisord exécutant le worker de file d'attente et le planificateur dans un seul conteneur). Ce module déploie Mixpost sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Mixpost et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Mixpost s'exécute sous forme d'une charge de travail web unique et autonome (l'image officielle `inovector/mixpost`). Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod nginx + PHP-FPM + supervisord sur le port 80, 2 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| File d'attente, cache et sessions | Redis | Activé par défaut ; pilote `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` ; utilise par défaut l'adresse IP du serveur NFS colocalisé lorsqu'aucun hôte externe n'est fourni |
| Persistance des fichiers | Cloud Filestore (NFS) | Les médias/téléversements sont conservés sous `/mnt/nfs`, partagés entre les pods ; c'est aussi la source par défaut de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Mixpost_Common` |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une adresse IP statique réservée ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche applicative partagée (`Mixpost_Common` définit `database_type = "MYSQL_8_0"` et `DB_CONNECTION = "mysql"`) ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est joint via le sidecar Auth Proxy en TCP simple sur la boucle locale, et non par un socket.** La variante définit `DB_HOST = 127.0.0.1` ; sur GKE, le Cloud SQL Auth Proxy (`enable_cloudsql_volume = true`) est un simple écouteur TCP sur `127.0.0.1:3306` (contrairement au socket Unix de Cloud Run). **Laissez cette valeur à `true`** — la désactiver fait se connecter le job `db-init` via l'adresse IP privée et se terminer avant le démarrage du proxy, de sorte que son signal d'arrêt `quitquitquit` est manqué et que le sidecar du proxy tourne indéfiniment, bloquant le job.
- **Redis est activé par défaut et, en pratique, obligatoire.** `enable_redis = true` relie `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` à `redis` (avec un repli sur `sync`/`file` uniquement lorsqu'il est désactivé). Lorsque `redis_host` est vide, le module utilise par défaut l'adresse IP du serveur NFS — une garde de validation au moment du plan impose que `redis_host` soit défini ou que `enable_nfs` vaille `true`.
- **`min_instance_count = 1`, `max_instance_count = 5`.** Contrairement à la valeur par défaut à démarrage à froid de la variante Cloud Run, GKE maintient au moins un pod en fonctionnement continu, si bien que le planificateur Laravel et le worker de file d'attente gérés par supervisord fonctionnent sans cron externe — la convention CLAUDE.md consistant à externaliser les tâches planifiées via Cloud Scheduler (utilisée pour le `schedule:run` de la variante Cloud Run) **ne s'applique pas** ici.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur `/mnt/nfs`) pour le stockage partagé des médias/fichiers, et sert aussi d'hôte Redis par défaut.
- **L'affinité de session est `ClientIP`**, de sorte que les requêtes d'un client atteignent le même pod.
- **Pas de job de migration séparé.** L'image précompilée `inovector/mixpost` exécute `php artisan migrate --force` et crée elle-même le compte administrateur à chaque démarrage via son point d'entrée supervisord intégré ; le seul job d'initialisation est la création idempotente de la base de données/de l'utilisateur par `db-init`.
- **Correspondance des variables d'environnement de base de données Laravel.** `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"` et `db_name_env_var_name = "DB_DATABASE"` afin que les `DB_USER`/`DB_NAME` propres au locataire créés par le socle soient exposés sous les noms que lit réellement `env()` de Laravel — ce n'est pas configurable par l'opérateur.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager ; la variante GKE suffixe son préfixe de ressource par `-gke` afin que le secret n'entre pas en collision avec un déploiement Cloud Run du même locataire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Mixpost {#a-gke-autopilot--the-mixpost-workload}

Les pods Mixpost sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés par les pods. Comme la charge de travail s'appuie par défaut sur NFS, le Deployment utilise la stratégie `Recreate` (une mise à jour progressive ferait tourner deux pods sur le même volume NFS et la même base de données partagée, provoquant un interblocage).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Mixpost pour consulter les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mixpost stocke toutes les données applicatives (comptes, publications, métadonnées des médias, utilisateurs) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** qui écoute sur `127.0.0.1:3306` (TCP simple sur la boucle locale — pas de socket Unix sur GKE). Au premier déploiement, le job `db-init` crée la base de données applicative (`utf8mb4`/`utf8mb4_0900_ai_ci`), l'utilisateur et les droits, puis signale au sidecar du proxy de s'arrêter.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les options et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe.

### C. Redis — file d'attente, cache et sessions {#c-redis--queue-cache--sessions}

Le pipeline de publication en arrière-plan de Mixpost, le cache des réponses et les sessions passent tous par Redis lorsque `enable_redis = true` (valeur par défaut). Ce module ne provisionne aucune instance Memorystore dédiée — sauf si `redis_host` est redéfini vers une instance externe, Redis est censé être joignable à l'adresse IP du serveur NFS (la même VM Compute Engine qui sert NFS exécute aussi Redis, selon la convention d'infrastructure partagée de ce dépôt).

- **Console :** Memorystore → Redis instances (uniquement si vous faites pointer `redis_host` vers une instance gérée) ; sinon Compute Engine → VM instances pour l'hôte NFS/Redis.
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER|REDIS'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### D. Cloud Storage et persistance des fichiers (NFS) {#d-cloud-storage--file-persistence-nfs}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement et le compte de service de la charge de travail y reçoit l'accès. Par ailleurs, l'arborescence des médias/téléversements de Mixpost réside sur **NFS (Cloud Filestore)** sous `/mnt/nfs`, partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret propre à Mixpost est généré automatiquement : l'`APP_KEY` Laravel (`secret-<resource_prefix>-gke-mixpost-app-key`), une valeur aléatoire de 32 caractères encodée en base64 au format natif de Laravel `base64:<value>`. Le mot de passe de la base de données est géré séparément par le socle. Sur GKE, les secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Mixpost {#3-mixpost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `scripts/db-init.sh` avec `mysql:8.0-debian`. Il se connecte via le sidecar Cloud SQL Auth Proxy en TCP (`--get-server-public-key`, nécessaire car `caching_sha2_password` refuse d'envoyer un mot de passe sur une connexion de boucle locale qui semble non chiffrée), crée de manière idempotente la base de données applicative avec `utf8mb4`/`utf8mb4_0900_ai_ci`, supprime puis recrée l'utilisateur applicatif, accorde les privilèges, vérifie que l'utilisateur applicatif peut se connecter, puis envoie un POST `quitquitquit` au sidecar du proxy sur le port 9091 pour l'arrêter. Le job peut être réexécuté sans risque (`execute_on_apply = true`, `max_retries = 1`).
- **Pas de job de migration séparé.** Le point d'entrée supervisord intégré à l'image précompilée `inovector/mixpost` exécute `php artisan migrate --force` et crée le compte administrateur à chaque démarrage ; il n'existe pas de job d'initialisation de migration distinct.
- **Les valeurs par défaut du compte administrateur sont intégrées à l'image et ne sont pas configurables via ce module.** La connexion initiale utilise par défaut `admin@example.com` / `changeme`, quelle que soit la valeur de `mixpost_admin_email` — cette variable est déclarée pour la transmission entre variantes mais n'est **actuellement pas injectée** dans la configuration en cours d'exécution (l'image crée elle-même le compte administrateur). Modifiez le mot de passe administrateur immédiatement après la première connexion.
- **Correspondance des variables d'environnement de base de données.** Le socle injecte `DB_HOST` (`127.0.0.1`, le sidecar du proxy), `DB_PORT` et `DB_PASSWORD` ; `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"` et `db_name_env_var_name = "DB_DATABASE"` afin que l'utilisateur et le nom de base de données propres au locataire aboutissent dans les noms de variables natifs de Laravel.
- **Câblage de Redis.** `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` sont définis à `redis` lorsque `enable_redis = true` (valeur par défaut), avec un repli sur `sync`/`file` dans le cas contraire. `Mixpost_Common` ne les définit **pas** lui-même — c'est la fusion des locals du propre `main.tf` de la variante GKE qui les définit en fonction de `enable_redis`.
- **Les déploiements adossés à NFS utilisent `Recreate`.** Les mises à jour arrêtent l'ancien pod avant de démarrer le nouveau, ce qui évite que deux pods s'interbloquent sur le volume NFS partagé et sur les verrous de la base de données.
- **Au niveau du pod, les sondes de santé sont TCP, et non HTTP.** Mixpost répond à `/` par une redirection `302` vers `https://<app_url>/` ; la sonde HTTP du kubelet GKE **suit les redirections** et aboutit sur `https://<pod-ip>:443` où rien n'écoute — connexion refusée, échec de la sonde, boucle de redémarrage (pods `0/1`) alors que l'application fonctionne parfaitement sur `:80`. `startup_probe_config` et `health_check_config` (les variables que le socle utilise réellement pour le `startupProbe`/`livenessProbe` du Deployment) valent donc par défaut `type = "TCP"` sur le port 80. (La sonde de Cloud Run ne suit pas les redirections, c'est pourquoi la même sonde HTTP fonctionne sans modification sur cette variante.) Les variables distinctes `startup_probe`/`liveness_probe` transmises à la configuration applicative valent HTTP par défaut et sont purement cosmétiques au niveau de l'objet de configuration — les véritables sondes des pods proviennent de `startup_probe_config`/`health_check_config`.
- **Le planificateur s'exécute en continu dans le pod.** Avec `min_instance_count = 1`, un pod est toujours en fonctionnement, de sorte que le planificateur Laravel et le worker de file d'attente gérés par supervisord publient les publications planifiées sans aucun câblage Cloud Scheduler externe (contrairement à la valeur par défaut à démarrage à froid de la variante Cloud Run, qui nécessite un appel cron externalisé à `schedule:run`).
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|APP_KEY|QUEUE_CONNECTION'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Mixpost ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mixpost` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `inovector/mixpost` déployée directement (précompilée, sans build personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement `inovector/mixpost` ; transmis explicitement afin que le socle ne le traite pas comme un build personnalisé sans Dockerfile. |
| `cpu_limit` | `2000m` | 2 vCPU par défaut. |
| `memory_limit` | `2Gi` | 2 GiB par défaut. |
| `min_instance_count` | `1` | Maintient en fonctionnement continu le planificateur Laravel/worker de file d'attente dans le pod. |
| `max_instance_count` | `5` | Plafond maxReplicas du HPA. |
| `container_port` | `80` | nginx + PHP-FPM servent du HTTP simple. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale TCP) — obligatoire sur GKE ; le désactiver bloque le job `db-init`. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Adresse IP externe pour l'interface Mixpost. |
| `workload_type` | `null` → `Deployment` | Deployment (adossé à NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP `/`, 90s delay, period 15s, failure_threshold 20 | La véritable sonde de démarrage au niveau du pod. TCP évite le piège de la redirection 302. |
| `health_check_config` | TCP `/`, 120s delay, period 30s, failure_threshold 3 | La véritable sonde de vivacité au niveau du pod. TCP pour la même raison. |
| `startup_probe` / `liveness_probe` | HTTP `/` (90s / 120s) | Transmises à l'objet de configuration applicative ; cosmétiques — remplacées par les sondes TCP ci-dessus dans la véritable spécification du Deployment. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut pour les médias/téléversements partagés, et sert aussi de source par défaut de l'hôte Redis. |
| `nfs_mount_path` | `/mnt/nfs` | Emplacement où Mixpost stocke les médias/téléversements. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Relie `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` à `redis`. Une garde au moment du plan exige que `redis_host` soit défini ou que `enable_nfs = true`. |
| `redis_host` | `""` | À redéfinir pour pointer vers une instance Redis/Memorystore externe. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe Redis AUTH, si l'instance cible en exige un. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Mixpost_Common` ; ne peut pas être remplacé par un autre moteur. |
| `application_database_name` | `mixpost` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mixpost` | Utilisateur de la base de données applicative ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

### Groupe 23 — Paramètres de l'application Mixpost {#group-23--mixpost-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Déclarée pour la transmission entre variantes ; **actuellement non injectée dans la configuration en cours d'exécution** — l'image crée elle-même `admin@example.com` / `changeme` dans tous les cas. |
| `mail_from_name` | `Mixpost` | Nom d'affichage de l'expéditeur des e-mails sortants. |
| `mail_from_address` | `mixpost@example.com` | Adresse de l'expéditeur des e-mails sortants. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Mixpost. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
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

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé conjointement à un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage. Le propre `validation.tf` de `Mixpost_GKE` ajoute quatre gardes supplémentaires (ordre des instances min/max, source de l'hôte Redis, identifiants OAuth d'IAP, volume Cloud SQL face à `database_type = "NONE"`). Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critique | Ne peut pas être remplacé par un autre moteur ; `Mixpost_Common` code MySQL en dur quelle que soit la valeur apparente de cette variable. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelines toutes les données. |
| `APP_KEY` (généré automatiquement) | Ne jamais le modifier | Critique | Faire tourner la clé Laravel après le premier démarrage invalide les données chiffrées de session/cookies et tous les champs chiffrés de la base de données. |
| `enable_cloudsql_volume` | `true` | Critique | Le désactiver fait manquer au signal d'arrêt `quitquitquit` du job `db-init` le proxy pas encore démarré, bloquant le job indéfiniment sur GKE. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS activé, ou un `redis_host` explicite | Élevé | Activer Redis sans source d'hôte (ni `redis_host`, ni NFS) laisse `REDIS_HOST` vide — bloqué au moment du plan par `validation.tf`, mais désactiver/vider les deux casse la file d'attente, le cache et les sessions. |
| `startup_probe_config` / `health_check_config` | `type = "TCP"` | Élevé | Les passer en HTTP réintroduit l'échec de la redirection 302 vers `:443` — le Deployment entre en boucle de redémarrage à `0/1` alors que l'application est saine. |
| `enable_nfs` | `true` | Élevé | Le désactiver supprime à la fois la persistance partagée des médias et (sauf si `redis_host` est défini) l'hôte Redis par défaut, ce qui dégrade la fiabilité de la publication. |
| `min_instance_count` | `1` | Élevé | Descendre à `0` arrête le planificateur Laravel et le worker de file d'attente dans le pod — les publications sociales planifiées cessent silencieusement d'être publiées. |
| `mixpost_admin_email` | Récupérer les identifiants réels après le déploiement | Moyen | La variable n'est pas injectée dans la configuration en cours d'exécution ; la première connexion se fait toujours avec `admin@example.com` / `changeme` — modifiez-les immédiatement après la première connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de l'ensemble de travail de PHP-FPM et des workers gérés par supervisord, les pods subissent des OOM sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'adresse IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toutes les URI de redirection OAuth enregistrées auprès des plateformes sociales. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Mixpost (le secret `APP_KEY`, le script `db-init` et les variables d'environnement fusionnées dans le conteneur) est partagée avec la variante Cloud Run via le module interne `Mixpost_Common`, qui n'est pas déployé directement et ne dispose pas encore de son propre guide de configuration.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mixpost sur GKE Autopilot](../labs/Mixpost_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mixpost Common — Configuration applicative partagée](Mixpost_Common.md) — la configuration partagée par les deux cibles de déploiement.
