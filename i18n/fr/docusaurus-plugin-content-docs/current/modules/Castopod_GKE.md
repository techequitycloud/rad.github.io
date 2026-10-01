---
title: "Castopod sur GKE Autopilot"
description: "Référence de configuration pour déployer Castopod sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Castopod_GKE.md @ 3055034 sha256:7c0de71525e6 -->

# Castopod sur GKE Autopilot {#castopod-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Castopod_GKE.png" alt="Castopod sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Castopod est une plateforme open source d'hébergement de podcasts, nativement compatible
ActivityPub, construite sur CodeIgniter 4 (PHP 8) et servie par FrankenPHP/Caddy. Ce module
déploie Castopod sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Castopod et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Castopod s'exécute comme une charge de travail web FrankenPHP/Caddy unique. Le déploiement
assemble un ensemble restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods FrankenPHP/Caddy sur le port 8080, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` ; Castopod ne prend pas en charge PostgreSQL |
| Persistance des fichiers | Cloud Filestore (NFS) | Les médias des podcasts (audio, illustrations) sont conservés sous `/var/lib/castopod`, partagé entre les pods |
| Stockage d'objets | Cloud Storage | Deux buckets sont provisionnés par défaut (suffixes `data` et `media`) — aucun n'est monté dans le pod, sauf si `gcs_volumes` est configuré |
| Cache | Redis (facultatif) | Castopod utilise par défaut un cache sur le système de fichiers (`CP_CACHE_HANDLER = file`) ; Redis est optionnel |
| Secrets | Secret Manager | `CP_ANALYTICS_SALT` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing / Gateway API | LoadBalancer externe avec une IP statique réservée et HTTPS sans configuration via un nom d'hôte `<ip>.nip.io` émis automatiquement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (la variante transmet `database_type = null`, ce qui conserve la valeur
  par défaut de Common, `MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge et font
  échouer les migrations CodeIgniter.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface de loopback, mais
  l'application s'y connecte en TCP.** `enable_cloudsql_volume = true` monte un sidecar
  cloud-sql-proxy à l'écoute sur `127.0.0.1:3306`, et le module Common impose en dur
  `DB_HOST = 127.0.0.1` pour le conteneur du service. Comme Castopod (CodeIgniter 4) lit sa
  connexion à la base de données depuis des clés `database.default.*` **en notation pointée**
  — qui ne peuvent pas être exprimées comme des noms de variables d'environnement Cloud Run/K8s
  — le point d'entrée de la plateforme les écrit dans le fichier `.env` de Castopod au
  démarrage du conteneur, au lieu de les injecter comme variables d'environnement.
- **Deux jeux de configuration existent pour les sondes de santé — un seul est effectif.**
  Les variables `startup_probe`/`liveness_probe` propres à Castopod (groupe 10) l'emportent
  toujours ; les variables génériques `health_check_config`/`startup_probe_config` héritées
  d'App_GKE sont transmises, mais structurellement remplacées par la configuration de sondes
  du module Common, si bien qu'elles n'ont aucun effet pour cette application.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  La charge de travail adossée à NFS est déployée avec la stratégie `Recreate` ; ne dépassez
  donc pas 1 sans vérifier le comportement du stockage partagé pour les téléversements de
  médias et le cache d'objets.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur `/var/lib/castopod`) afin que
  l'audio et les illustrations des épisodes téléversés soient conservés entre les redémarrages
  de pods et partagés entre les réplicas — Castopod stocke les médias sur le système de
  fichiers, et non dans la base de données.
- **L'affinité de session vaut `ClientIP`**, de sorte que les requêtes d'un client atteignent
  le même pod.
- **HTTPS sans configuration est activé par défaut.** `enable_custom_domain = true` et
  `reserve_static_ip = true` sont tous deux des valeurs par défaut ; lorsque
  `application_domains` est laissé vide, App_GKE provisionne une Gateway et dérive un nom
  d'hôte gratuit `<ip>.nip.io` avec un certificat géré par Google — aucune configuration DNS
  n'est nécessaire pour joindre Castopod en HTTPS.
- **`CP_ANALYTICS_SALT` est généré automatiquement** et stocké dans Secret Manager. Il
  anonymise les statistiques d'écoute des podcasts et doit rester stable après le premier
  démarrage.
- **Pas de job de migration distinct — mais les migrations ne sont pas non plus automatiques
  dans l'image de base.** L'image `castopod/castopod` (construite sur `serversideup/php`) n'a
  pas de hook de migration CodeIgniter propre ; son seul comportement de migration automatique
  intégré est spécifique à Laravel (`php artisan migrate`, conditionné par
  `AUTORUN_ENABLED`, par défaut `false`). Le point d'entrée de la surcouche de la plateforme
  (`Castopod_Common/scripts/entrypoint.sh`) exécute explicitement `php spark migrate --all`
  à chaque démarrage du conteneur ; le schéma est donc créé au premier démarrage, une fois que
  le job `db-init` a provisionné la base et l'utilisateur.
- **La configuration au premier lancement est manuelle.** Après le déploiement, ouvrez l'URL du
  service et suivez l'assistant d'installation web de Castopod pour créer le premier compte
  super-administrateur et configurer les paramètres par défaut de l'instance et des podcasts.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Castopod {#a-gke-autopilot--the-castopod-workload}

Les pods Castopod sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. Comme la charge de travail est adossée à NFS, le Deployment utilise la
stratégie `Recreate` (une mise à jour progressive ferait tourner deux pods sur le même
répertoire de médias adossé à NFS et la même base partagée, et provoquerait un interblocage).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Castopod pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress
  affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app~castopod" 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle
et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Castopod stocke toutes les données de l'application (podcasts, épisodes, utilisateurs,
statistiques) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors
du premier déploiement, le job `db-init` crée la base de données, l'utilisateur et les droits
de l'application ; les migrations CodeIgniter créent ensuite le schéma au premier démarrage du
conteneur de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~castopod"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant
le mot de passe figurent tous dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md)
pour le modèle de connexion, les sauvegardes automatiques et la rotation du mot de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

**Deux buckets Cloud Storage** sont provisionnés automatiquement par défaut — un bucket
générique `data` (la valeur par défaut du socle App_GKE) et un bucket `media` propre à
Castopod, déclaré par `Castopod_Common`. Aucun n'est monté dans le système de fichiers du pod,
sauf si `gcs_volumes` est explicitement configuré ; le répertoire de médias réel de Castopod
(`/var/www/castopod/public/media`) est en revanche conservé via **NFS (Cloud Filestore)**,
monté sur `/var/lib/castopod` et partagé entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~castopod"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache d'objets facultatif) {#d-redis-optional-object-cache}

Redis est **désactivé par défaut** — Castopod utilise un cache sur le système de fichiers
(`CP_CACHE_HANDLER = file`). Lorsque `enable_redis = true`, le module injecte
`REDIS_HOST`/`REDIS_PORT` pour le cache d'objets de Castopod ; si `redis_host` est laissé
vide, le socle le résout vers l'IP de la VM du serveur NFS (nécessite `enable_nfs = true`).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée plutôt que le Redis
  colocalisé avec NFS).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`CP_ANALYTICS_SALT` (utilisé pour anonymiser les statistiques d'écoute des podcasts). Le mot
de passe de la base de données est géré séparément par le socle. Sur GKE, les secrets sont
projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~analytics-salt"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true`). Comme
`enable_custom_domain = true` par défaut, App_GKE provisionne en outre une Gateway et —
lorsque `application_domains` est laissé vide — un nom d'hôte `<ip>.nip.io` sans
configuration, avec un certificat géré par Google ; Castopod est ainsi accessible en HTTPS
immédiatement, sans posséder de domaine. Un vrai domaine personnalisé peut être fourni à la
place.

- **Console :** Network services → Load balancing / Gateways ; VPC network → IP
  addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les adresses IP
statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de GKE et
de Cloud SQL vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Castopod {#3-castopod-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute
  `db-init.sh` avec `mysql:8.0-debian`. Il se connecte à Cloud SQL (socket Unix sous
  `/cloudsql` via le sidecar Auth Proxy, avec repli en TCP sur l'IP privée), crée de manière
  idempotente la base de données, l'utilisateur et les droits de l'application, vérifie que
  l'utilisateur de l'application peut se connecter, puis arrête le sidecar proxy. Le job peut
  être relancé sans risque (`execute_on_apply = true`,
  `max_retries = 3`).
- **Les migrations s'exécutent au démarrage du conteneur (pas de job de migration distinct) —
  via le point d'entrée de la plateforme, et non l'image de base.** L'image `castopod/castopod`
  (construite sur `serversideup/php`) n'a pas de hook de migration CodeIgniter propre ; son
  seul comportement de migration automatique est spécifique à Laravel (`php artisan migrate`,
  conditionné par `AUTORUN_ENABLED`, par défaut `false`) et n'exécuterait pas le
  `spark migrate` de CI4 même s'il était activé. Le point d'entrée de la surcouche de la
  plateforme (`Castopod_Common/scripts/entrypoint.sh`) exécute explicitement
  `php spark migrate --all` — idempotent, sans risque à chaque démarrage — une fois
  `.env`/la connectivité à la base écrits ; le schéma est donc créé au premier démarrage, une
  fois que `db-init` a provisionné la base et l'utilisateur, et la mise à niveau de
  `application_version` applique les changements de schéma au démarrage suivant, sans job
  distinct. Si cet appel explicite venait à être supprimé, chaque requête renverrait une
  erreur 500 avec `Table '...' doesn't exist` alors même que `db-init` a réussi — vérifiez
  d'abord `entrypoint.sh` lorsque vous diagnostiquez ce symptôme.
- **La configuration de la base de données réside dans `.env`, matérialisée au démarrage du
  conteneur.** Castopod (CodeIgniter 4) lit sa connexion par défaut depuis des clés natives du
  framework, en notation pointée
  (`database.default.hostname|database|username|password|port|DBDriver|DBPrefix`), qui ne
  peuvent pas être exprimées comme des noms de variables d'environnement Kubernetes. Le point
  d'entrée de la surcouche de la plateforme les écrit dans le `.env` de Castopod à partir du
  `DB_HOST` injecté par le socle (qui vaut `127.0.0.1` sur GKE, le sidecar Auth Proxy) et
  de `DB_NAME`/`DB_USER`/`DB_PASSWORD`, puis délègue au point d'entrée FrankenPHP/Caddy amont.
- **`CP_BASEURL` est dérivée automatiquement.** Lorsqu'elle n'est pas définie explicitement, le
  point d'entrée la dérive du `GKE_SERVICE_URL` injecté par le socle et l'écrit sous
  `app.baseURL` dans `.env`, de sorte que les liens du flux du podcast et des médias reflètent
  l'adresse réelle du service (y compris le nom d'hôte nip.io émis automatiquement).
- **`CP_ANALYTICS_SALT` doit rester stable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager ; le modifier rompt la continuité de la
  déduplication pour les statistiques déjà enregistrées, sans toutefois corrompre les lignes
  existantes.
- **Les déploiements adossés à NFS utilisent `Recreate`.** Les mises à jour arrêtent l'ancien
  pod avant de démarrer le nouveau, ce qui évite que deux pods s'interbloquent sur le
  répertoire de médias partagé adossé à NFS et sur les verrous de la base.
- **Chemin de santé.** La sonde de démarrage est une sonde **TCP** sur le port du conteneur,
  avec un délai initial de 30 secondes et une fenêtre de 20 tentatives
  (`period_seconds = 15`), ce qui laisse amplement le temps aux migrations CodeIgniter du
  premier démarrage de se terminer. La sonde de vivacité est un **HTTP
  `GET /`** avec un délai initial de 300 secondes (5 minutes) — la page d'accueil non
  authentifiée de Castopod renvoie 200 une fois l'application démarrée et connectée à MySQL.
- **Configuration au premier lancement.** Après le déploiement, ouvrez l'URL du service et
  suivez l'assistant d'installation web de Castopod pour créer le premier compte
  super-administrateur et définir le nom de l'instance et les paramètres par défaut des
  podcasts. Les médias téléversés sont ensuite conservés dans le répertoire de médias adossé à
  NFS.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- cat /var/www/castopod/.env
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement (selon leur tag `{{UIMeta group=N}}`, qui ne correspond pas toujours aux titres
de section du fichier source). Seuls les paramètres propres à Castopod ou notables pour lui
sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `castopod` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `castopod/castopod` utilisé comme base du build personnalisé ; `latest` est épinglé sur un tag connu pour fonctionner (`1.15.5`) au moment du build via l'ARG de build propre à l'application `CASTOPOD_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU par instance de conteneur Castopod. |
| `memory_limit` | `2Gi` | Environ 512Mi au minimum pour démarrer ; 2Gi recommandé pour les grandes médiathèques. |
| `min_instance_count` | `1` | Conservez 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Conservez 1** sauf si le comportement du NFS et du cache partagés a été vérifié pour plusieurs pods. |
| `container_port` | `8080` | Le serveur FrankenPHP/Caddy de Castopod écoute sur 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les plugins gourmands en mémoire. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale d'un téléversement / d'un POST ; conservez `post_max_size ≥ upload_max_filesize` pour les téléversements d'audio d'épisodes. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface de Castopod et les flux de podcast publics. |
| `workload_type` | `null` → `Deployment` | Deployment (adossé à NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant, afin qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s, 20 tentatives | Sonde de démarrage effective — remplace le `startup_probe_config` générique, qui est transmis mais écrasé et n'a aucun effet. |
| `liveness_probe` | HTTP `/`, délai de 300s | Sonde de vivacité effective, sur la page d'accueil non authentifiée de Castopod — remplace le `health_check_config` générique. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que l'audio et les illustrations des épisodes téléversés soient conservés et partagés. |
| `nfs_mount_path` | `/var/lib/castopod` | Emplacement de montage de l'état partagé des médias de Castopod. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Bascule le cache d'objets de Castopod du système de fichiers vers Redis. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Conserve la valeur par défaut MySQL 8.0 de Common ; Castopod ne prend pas en charge d'autres moteurs. |
| `application_database_name` | `castopod` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `castopod` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway ; lorsque `application_domains` est vide, fournit un nom d'hôte HTTPS `<ip>.nip.io` sans configuration. |
| `application_domains` | `[]` | À définir pour utiliser un vrai nom d'hôte personnalisé et un certificat géré au lieu du repli nip.io. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements — requise pour que le nom d'hôte nip.io reste constant. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Castopod. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`data` et `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms du job de configuration (`db-init`) et du job d'import (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | Choisir un moteur autre que MySQL fait échouer les migrations CodeIgniter et toutes les routes adossées à la base. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base et l'utilisateur et détruit toutes les données des podcasts. |
| `enable_nfs` | `true` | Critique | Sans NFS, l'audio et les illustrations des épisodes téléversés résident sur un disque éphémère et sont perdus à chaque redémarrage ou redéploiement de pod. |
| `CP_ANALYTICS_SALT` (généré automatiquement) | Ne jamais modifier | Élevé | Le modifier après le premier démarrage rompt la continuité de la déduplication des auditeurs pour les statistiques déjà enregistrées. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base sur GKE. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 sans avoir vérifié le comportement du stockage et du cache partagés expose à un état des médias incohérent et à des statistiques en double. |
| `session_affinity` | `ClientIP` | Élevé | Sans affinité, les requêtes rebondissent entre les pods et perturbent les sessions d'administration authentifiées. |
| `memory_limit` | `2Gi` | Élevé | En dessous d'environ 512Mi, le pod PHP/FrankenPHP ne démarre pas ; les grandes médiathèques nécessitent davantage de marge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans elle, l'IP externe et tout nom d'hôte nip.io dérivé automatiquement peuvent changer entre les redéploiements, ce qui casse les URL enregistrées en favori et celles des flux RSS. |
| `enable_custom_domain` + `application_domains` vide | Convient par défaut (nip.io) | Faible | Produit une URL `<ip>.nip.io` fonctionnelle mais sans image de marque ; définissez `application_domains` pour un vrai nom d'hôte. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La
configuration applicative propre à Castopod, partagée avec la variante Cloud Run, est décrite
dans **[Castopod_Common](Castopod_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Castopod sur GKE Autopilot](../labs/Castopod_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Castopod sur Google Cloud Run](Castopod_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Castopod Common — Configuration applicative partagée](Castopod_Common.md) — la configuration partagée par les deux cibles de déploiement.
