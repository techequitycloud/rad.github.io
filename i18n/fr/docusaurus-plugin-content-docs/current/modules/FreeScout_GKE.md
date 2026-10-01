---
title: "FreeScout sur GKE Autopilot"
description: "Référence de configuration pour déployer FreeScout sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/FreeScout_GKE.md @ 3055034 sha256:ccace978d761 -->

# FreeScout sur GKE Autopilot {#freescout-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreeScout_GKE.png" alt="FreeScout sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreeScout est une plateforme gratuite et auto-hébergée de **helpdesk et de boîte aux
lettres partagée** construite sur Laravel (PHP) — elle transforme des boîtes de
réception partagées en une file de tickets collaborative avec conversations, tags,
réponses enregistrées, profil client, API REST et système de plugins. Ce module
déploie FreeScout sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise FreeScout et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

FreeScout s'exécute sous la forme d'une unique charge de travail web PHP (nginx +
php-fpm), construite comme une image personnalisée légère `FROM tiredofit/freescout`.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP sur le port 80, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — FreeScout ne prend en charge ni PostgreSQL ni d'autres moteurs |
| Fichiers persistants | Cloud Filestore (NFS) | Activé par défaut ; monté sur `/var/lib/freescout` pour les pièces jointes et les données d'exécution |
| Stockage d'objets | Cloud Storage | Un bucket de téléversements (`freescout-uploads`) provisionné automatiquement |
| Cache (facultatif) | Redis | Cache d'objets facultatif ; désactivé par défaut |
| Secrets | Secret Manager | `APP_KEY` Laravel et `ADMIN_PASS` de premier démarrage générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (`MYSQL_8_0`) ; choisir un autre moteur empêche le démarrage.
- **L'`APP_KEY` Laravel est généré automatiquement** et stocké dans Secret Manager.
  Il chiffre les données de session et toutes les colonnes chiffrées de la base
  (identifiants de boîtes aux lettres stockés, jetons OAuth). **Ne le renouvelez jamais
  après le premier démarrage** — cela invaliderait définitivement toutes les données
  chiffrées auparavant.
- **Un administrateur initial est créé automatiquement.** `ADMIN_EMAIL` (par défaut
  `admin@techequity.cloud`), avec le secret `ADMIN_PASS` généré, crée le premier
  administrateur au premier démarrage. Modifiez le mot de passe dans l'interface après
  la première connexion.
- **Cloud SQL est joint via le sidecar Auth Proxy.** `enable_cloudsql_volume`
  vaut `true` par défaut ; la variante GKE définit `DB_HOST = "127.0.0.1"` afin que
  FreeScout se connecte au proxy en boucle locale sur le port 3306.
- **NFS est activé par défaut** afin que les pièces jointes et les fichiers d'exécution
  soient partagés entre les pods et survivent aux replanifications ; il est monté sur
  `/var/lib/freescout`.
- **L'affinité de session vaut `ClientIP` par défaut**, ce qui maintient les requêtes
  d'un client sur le même pod — important pour l'expérience de session PHP/d'interface.
- **Au moins 1 réplica est maintenu** (`min_instance_count = 1`, `max_instance_count = 1`)
  afin que l'endpoint du helpdesk reste toujours joignable.
- **La santé est signalée sur `GET /`.** Il n'existe pas d'endpoint de santé JSON
  dédié ; la sonde de démarrage est TCP et la sonde de vivacité est `GET /`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail FreeScout {#a-gke-autopilot--the-freescout-workload}

Les pods FreeScout sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. Comme l'application s'appuie sur NFS, le socle la
déploie avec une stratégie de mise à jour `Recreate` (et non RollingUpdate) afin que
deux pods ne se disputent jamais le même volume NFS et la base de données partagée
pendant une mise à jour.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  FreeScout pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

FreeScout stocke toutes les données applicatives (conversations, boîtes aux lettres,
utilisateurs, clients, paramètres) dans une instance gérée Cloud SQL for MySQL 8.0.
Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** lié à
`127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, le
Job `db-init` crée la base de données applicative, l'utilisateur et les droits ;
l'application exécute ensuite ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~freescout"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Filestore (NFS) {#c-cloud-filestore-nfs}

Les pièces jointes et les fichiers d'exécution de FreeScout sont conservés sur un
volume NFS monté sur `/var/lib/freescout` (activé par défaut), partagé entre les pods
afin que les téléversements survivent aux replanifications.

- **Console :** Filestore → Instances (instance gérée par Services_GCP ou intégrée).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour le modèle de découverte du NFS partagé et la
stratégie `Recreate` utilisée pour les applications reposant sur NFS.

### D. Cloud Storage {#d-cloud-storage}

Un bucket de téléversements **Cloud Storage** dédié (`freescout-uploads`) est
provisionné automatiquement ; le compte de service de la charge de travail y reçoit
l'accès. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~freescout"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Redis (cache d'objets facultatif) {#e-redis-optional-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, `REDIS_HOST`/`REDIS_PORT`
sont injectés dans le pod comme backend de cache d'objets. Lorsque `redis_host` est
laissé vide et que `enable_nfs` vaut true, l'IP de la VM du serveur NFS sert
d'endpoint Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### F. Secret Manager {#f-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : l'`APP_KEY`
Laravel (qui chiffre les données de session et les colonnes chiffrées de la base) et
`ADMIN_PASS` (le mot de passe de l'administrateur initial). Ils sont fournis aux pods
via le pilote Secret Store CSI. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freescout"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret contenant le mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et l'IP statique.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application FreeScout {#3-freescout-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte via le
  Cloud SQL Auth Proxy, crée de manière idempotente la base de données applicative et
  l'utilisateur, accorde les privilèges et vérifie que l'utilisateur applicatif peut se
  connecter. Le job peut être relancé sans risque.
- **Les migrations s'exécutent au démarrage du conteneur.** Il n'y a pas de job de
  migration distinct — l'image tiredofit exécute `php artisan migrate --force` à chaque
  démarrage du conteneur, de sorte que la mise à niveau d'`application_version`
  applique les changements de schéma au démarrage suivant.
- **Un administrateur initial est créé.** Au premier démarrage, l'image crée
  l'administrateur défini par `ADMIN_EMAIL` / `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME`
  avec le secret `ADMIN_PASS`. Connectez-vous et modifiez immédiatement le mot de passe.
- **L'`APP_KEY` est immuable après le premier démarrage.** La clé Laravel est générée
  une seule fois et écrite dans Secret Manager. La modifier invalide définitivement
  toutes les données chiffrées auparavant. Ne la renouvelez que lors d'une fenêtre de
  maintenance planifiée, avec une reconfiguration complète.
- **`APP_URL` doit correspondre à l'hôte du navigateur.** FreeScout construit les liens
  absolus et son routage `/` à partir d'`APP_URL` ; le point d'entrée le définit à
  partir du `GKE_SERVICE_URL` injecté. Une fois l'IP du LoadBalancer ou le domaine
  personnalisé connu, définissez `APP_URL`/`SITE_URL` sur cet hôte externe afin que les
  liens et les redirections soient résolus correctement :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"freescout","env":[
      {"name":"APP_URL","value":"https://freescout.example.com"},
      {"name":"SITE_URL","value":"https://freescout.example.com"}
    ]}]}}}}'
  ```
  Vous pouvez aussi définir `environment_variables` dans la configuration du module
  avant le déploiement.
- **Les déploiements reposant sur NFS utilisent `Recreate`.** Comme FreeScout s'appuie
  sur NFS, les mises à jour arrêtent complètement l'ancien pod avant de démarrer le
  nouveau, ce qui évite que deux pods se disputent le même volume NFS et la base de
  données partagée.
- **Chemin de santé.** La sonde de démarrage est TCP sur le port du conteneur (délai de
  30 s, 20 échecs) et la sonde de vivacité est HTTP `GET /` (délai initial de 300 s).
  Prévoyez plusieurs minutes au premier démarrage, pendant l'exécution des migrations,
  avant que le pod ne soit signalé comme sain.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à FreeScout ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs
par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freescout` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image de base pour le build léger (`latest` correspond à `php8.3-1.17.159`) ; fixez un tag explicite tel que `1.8.170` en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour un traitement intensif des pièces jointes. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléversement des pièces jointes / des requêtes POST. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; conservez 1 afin que l'endpoint reste toujours joignable. |
| `max_instance_count` | `1` | Conservez 1 tant que le fonctionnement multi-pods n'est pas confirmé comme sûr (stockage NFS, base de données partagée). |
| `container_port` | `80` | FreeScout (nginx/php-fpm) écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour MySQL en boucle locale (`DB_HOST = 127.0.0.1`) ; conservez `true`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry avant le build léger. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par ex. `MAIL_*`, ou un `APP_URL` personnalisé). Les valeurs essentielles de base de données et d'administration sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. `APP_KEY` et `ADMIN_PASS` sont câblés automatiquement — ne les définissez pas ici. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (effectif : `Deployment`) | `Deployment` (par défaut) ou `StatefulSet`. FreeScout s'appuie sur NFS ; un Deployment avec une stratégie `Recreate` est donc utilisé. |
| `session_affinity` | `ClientIP` | Le routage persistant maintient un client sur un même pod pour la session PHP/l'interface. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/`, délai de 30 s, 20 échecs | Fenêtre généreuse pour les migrations du premier démarrage. |
| `liveness_probe` | HTTP `GET /`, délai de 300 s | `GET /` renvoie 200 une fois l'application démarrée ; pas d'endpoint de santé dédié. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut — il conserve les pièces jointes et les fichiers d'exécution entre les pods. |
| `nfs_mount_path` | `/var/lib/freescout` | Chemin de montage dans le conteneur. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active un cache d'objets Redis. |
| `redis_host` | `""` | Endpoint Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (issu de Common) | MySQL 8.0 fixé ; ne changez pas de moteur. |
| `application_database_name` | `freescout` | Nom de la base de données MySQL (injecté sous `DB_DATABASE`). Immuable après le premier déploiement. |
| `application_database_user` | `freescout` | Utilisateur applicatif de la base (injecté sous `DB_USERNAME`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL d'accès à FreeScout. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Endpoint de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'import (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) —
> **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à l'application, des `quota_memory_*` fournis sous forme d'entiers nus, `stateful_pvc_enabled` avec `workload_type = "Deployment"`, IAP sans identité autorisée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critique | Le renouveler invalide définitivement toutes les données chiffrées auparavant — les identifiants de boîtes aux lettres chiffrés et les jetons OAuth ne peuvent plus être déchiffrés. |
| `database_type` | `MYSQL_8_0` | Critique | FreeScout ne fonctionne qu'avec MySQL ; un moteur Postgres ou autre empêche le démarrage. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `APP_URL` / `SITE_URL` | URL du LoadBalancer externe / du domaine | Élevé | Un hôte erroné casse les liens absolus, le routage `/` et les liens de réinitialisation de mot de passe / d'e-mail. |
| `enable_nfs` | `true` | Élevé | Le désactiver fait perdre les pièces jointes et fichiers d'exécution partagés et rompt la cohérence des fichiers entre plusieurs pods. |
| `enable_cloudsql_volume` | `true` (GKE) | Élevé | Le sidecar Auth Proxy fournit l'endpoint MySQL `127.0.0.1:3306` ; sa désactivation est bloquée par un garde-fou de validation au moment du plan. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, la session PHP/l'interface peut aboutir sur un pod différent d'une requête à l'autre. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; le garde-fou de validation rejette les valeurs invalides. |
| `memory_limit` | `2Gi` | Élevé | Une valeur trop basse provoque l'arrêt OOM du worker PHP sous la charge des pièces jointes. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 sans gestion confirmée du stockage partagé et des sessions peut entraîner un état incohérent entre les pods. |
| `enable_iap` | uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les rappels d'intégration entrants. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `ADMIN_PASS` (généré automatiquement) | À modifier dans l'interface après la première connexion | Moyen | Le mot de passe généré se trouve dans Secret Manager ; renouvelez-le dans l'application pour obtenir un identifiant détenu par une personne. |
| `application_version` | À fixer en production | Moyen | `latest` peut changer l'image de base à votre insu entre deux déploiements. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de conservation réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à FreeScout, partagée
avec la variante Cloud Run, est décrite dans **[FreeScout_Common](FreeScout_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreeScout sur GKE Autopilot](../labs/FreeScout_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreeScout Common — Configuration applicative partagée](FreeScout_Common.md) — la configuration partagée par les deux cibles de déploiement.
