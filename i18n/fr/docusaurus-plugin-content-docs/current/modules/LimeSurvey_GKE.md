---
title: "LimeSurvey sur GKE Autopilot"
description: "Référence de configuration pour déployer LimeSurvey sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LimeSurvey_GKE.md @ 3055034 sha256:de1624409e22 -->

# LimeSurvey sur GKE Autopilot {#limesurvey-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LimeSurvey_GKE.png" alt="LimeSurvey sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LimeSurvey est une plateforme libre et open source d'enquêtes et de questionnaires
en ligne (PHP/Yii). Elle prend en charge un nombre illimité d'enquêtes avec des
dizaines de types de questions, le branchement conditionnel, les quotas, les
enquêtes multilingues et des statistiques et exports riches. Ce module déploie
LimeSurvey sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par LimeSurvey et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LimeSurvey s'exécute sous forme d'une charge de travail web PHP/Apache unique
construite à partir de l'image `martialblog/limesurvey`. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 8080, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le module Common impose `database_type = "MYSQL_8_0"` quelle que soit la valeur par défaut `null` de la variable de l'application |
| Persistance des fichiers | Cloud Filestore (NFS) | Les téléversements, exports et données d'exécution des enquêtes sont conservés sous `/var/www/html/upload`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket générique `data` (valeur par défaut du groupe 14) plus un bucket `limesurvey-uploads` provisionné par Common ; aucun n'est monté dans le pod par défaut |
| Secrets | Secret Manager | `ADMIN_PASSWORD` généré automatiquement (super-administrateur LimeSurvey) ; mot de passe de la base de données géré par le socle |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sortie `config` de `LimeSurvey_Common` code en
  dur `database_type = "MYSQL_8_0"`, ce qui remplace la valeur par défaut `null` de
  `database_type` dans le module de l'application ; les autres moteurs ne sont pas
  pris en charge.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface de bouclage.** La
  variante définit `enable_cloudsql_volume = true`, et `limesurvey.tf` fusionne
  `DB_HOST = "127.0.0.1"` dans la configuration de l'application afin que LimeSurvey
  se connecte au sidecar cloud-sql-proxy plutôt qu'à un chemin de socket.
- **InnoDB est forcé.** Le point d'entrée de l'image martialblog utilise MyISAM
  comme moteur de base de données par défaut, que Cloud SQL for MySQL 8.0 désactive
  (`disabled_storage_engines=MyISAM`). Sans remplacement explicite, le
  `CREATE TABLE ... ENGINE=MyISAM` de l'installateur en console échoue et — comme
  le point d'entrée appelle l'installateur sans sortie détaillée — l'échec est
  masqué : le pod se déclare sain alors que chaque page renvoie une erreur 500 avec
  `table settings_global not found`. Le module définit `DB_MYSQL_ENGINE=InnoDB` et
  `DBENGINE=InnoDB` pour l'éviter.
- **Un seul réplica par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. LimeSurvey conserve un état de session PHP ; ne passez
  pas au-delà de 1 sans avoir vérifié le comportement du stockage partagé et des
  sessions.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur
  `/var/www/html/upload`) afin que les ressources d'enquête téléversées, les imports
  et les exports soient conservés et partagés entre les pods.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Installation automatique au premier démarrage (pas de tâche de migration
  distincte).** Le point d'entrée upstream `martialblog/limesurvey` exécute
  l'installateur en console / `updatedb` de LimeSurvey au premier démarrage du
  conteneur, une fois que `db-init` a provisionné la base de données et
  l'utilisateur.
- **`ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret Manager. Il
  crée le compte super-administrateur du premier lancement (nom d'utilisateur fixe
  `admin`, `ADMIN_EMAIL = admin@techequity.cloud`) ; le point d'entrée martialblog
  se termine si `ADMIN_PASSWORD` est absent.
- **`PUBLIC_URL` n'est pas prédéfini sur GKE.** L'appel du module `limesurvey_app`
  dans `limesurvey.tf` ne transmet pas de `service_url` ; `PUBLIC_URL` n'est donc
  injecté que si vous le définissez explicitement via `environment_variables` —
  faites-le une fois l'IP du LoadBalancer externe ou le domaine personnalisé connu,
  afin que les liens absolus se résolvent correctement.
- **`application_version = "latest"` correspond à un tag de base figé.** Le
  Dockerfile détermine l'image de base à partir d'un argument de build propre à
  l'application, `LIMESURVEY_VERSION` (et non du générique `APP_VERSION`, que le
  socle injecte dans `build_args` et qui serait sinon écrasé par `"latest"`) ;
  `"latest"` se résout en `6-apache`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LimeSurvey {#a-gke-autopilot--the-limesurvey-workload}

Les pods LimeSurvey sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. La charge de travail s'exécute en tant que
Deployment (aucun remplacement `Recreate` imposé par NFS n'est défini pour cette
application ; vérifiez donc la stratégie effective avant de supposer que les mises
à jour progressives sont sûres avec `max_instance_count > 1`).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail LimeSurvey pour les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

LimeSurvey stocke toutes les données d'enquête (enquêtes, questions, réponses,
utilisateurs, paramètres) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods
la joignent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune
IP publique n'est exposée. Lors du premier déploiement, la tâche `db-init` crée la
base de données applicative, l'utilisateur et les privilèges ; l'installateur en
console de LimeSurvey crée ensuite le schéma avec le moteur `InnoDB` forcé.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers NFS {#c-cloud-storage--nfs-file-persistence}

Deux buckets Cloud Storage sont provisionnés par défaut (un bucket générique `data`
issu de la valeur par défaut de la variable du groupe 14, et un bucket
`limesurvey-uploads` fourni par `LimeSurvey_Common`) ; aucun n'est monté dans le pod
sauf si vous ajoutez une entrée à `gcs_volumes`. L'arborescence réelle des
téléversements et exports d'enquêtes réside sur **NFS (Cloud Filestore)** sous
`/var/www/html/upload`, partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~limesurvey"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret propre à LimeSurvey est généré automatiquement et stocké dans Secret
Manager : `ADMIN_PASSWORD` (le mot de passe du super-administrateur du premier
lancement, 20 caractères, sans caractères spéciaux). Le mot de passe de la base de
données est géré séparément par le socle. Sur GKE, les secrets sont projetés dans
les pods via le pilote CSI Secret Store.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~limesurvey"
  gcloud secrets versions access latest --secret=secret-<resource-prefix>-limesurvey-admin-password --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration CSI Secret Store et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré par
Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LimeSurvey {#3-limesurvey-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` exécute `db-init.sh` avec `mysql:8.0-debian`. Elle privilégie un socket
  Unix Cloud SQL s'il en existe un sous `/cloudsql`, sinon elle se rabat sur le TCP
  via `DB_IP`/`DB_HOST`, crée de manière idempotente la base de données applicative,
  l'utilisateur et les privilèges, vérifie que l'utilisateur de l'application peut
  se connecter, puis arrête le sidecar du proxy via le point de terminaison
  d'administration `quitquitquit` (avec `SIGKILL` en dernier recours). La tâche peut
  être réexécutée sans risque (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de tâche de migration
  distincte).** Une fois la base de données provisionnée, le point d'entrée propre à
  l'image martialblog génère `application/config/config.php` à partir de
  l'environnement et exécute l'installateur en console / `updatedb` de LimeSurvey au
  premier démarrage du pod, créant le schéma dans la base de données vide avec le
  moteur `InnoDB` forcé.
- **Compte administrateur.** L'installateur crée un super-administrateur avec le nom
  d'utilisateur fixe `admin` (`ADMIN_NAME = "Administrator"`,
  `ADMIN_EMAIL = admin@techequity.cloud`) et le secret `ADMIN_PASSWORD` généré.
  Récupérez-le avant la première connexion.
- **Alias des variables d'environnement de base de données sur l'interface de
  bouclage.** La variante définit `db_user_env_var_name = "DB_USERNAME"`,
  `db_password_env_var_name = "DB_PASSWORD"` et
  `db_name_env_var_name = "DB_NAME"` afin que les valeurs propres au tenant
  injectées par le socle arrivent sous les noms attendus par le point d'entrée
  martialblog ; `limesurvey.tf` remplace `DB_HOST` par `127.0.0.1` (le sidecar Auth
  Proxy).
- **`DB_MYSQL_ENGINE` / `DBENGINE` sont forcés à `InnoDB`.** Cela évite l'échec
  d'installation silencieux décrit dans la [Vue d'ensemble](#1-overview) — Cloud SQL
  for MySQL 8.0 désactive MyISAM, la valeur par défaut de l'image.
- **Définissez `PUBLIC_URL` une fois l'IP connue.** Il n'est pas prédéfini sur GKE —
  modifiez le déploiement ou définissez `environment_variables` avec l'URL externe
  une fois l'IP du LoadBalancer ou le domaine personnalisé attribué :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"limesurvey","env":[
      {"name":"PUBLIC_URL","value":"https://survey.example.com"}]}]}}}}'
  ```
- **Chemin de santé.** La sonde de démarrage est une sonde **TCP** sur `/` (délai
  initial de 30 s, timeout de 10 s, période de 15 s, 20 échecs — une marge généreuse
  pour l'installation au premier démarrage). La sonde de vivacité est une sonde
  **HTTP** `GET /` (délai initial de 300 s, timeout de 60 s, période de 60 s,
  3 échecs) une fois que LimeSurvey traite les requêtes. Prévoyez plusieurs minutes
  au premier démarrage pour l'installateur.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_|ADMIN_|PUBLIC_URL'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à LimeSurvey ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `limesurvey` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de base `martialblog/limesurvey` ; `latest` se résout en tag figé `6-apache` via l'argument de build propre à l'application `LIMESURVEY_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU minimum. |
| `memory_limit` | `2Gi` | Minimum 512Mi ; 2Gi recommandé en production. |
| `min_instance_count` | `1` | Conservez 1 pour que la charge de travail reste joignable. |
| `max_instance_count` | `1` | **Conservez 1** sauf si le comportement de partage des sessions a été vérifié. |
| `container_port` | `8080` | L'image apache martialblog/limesurvey écoute sur le port 8080 (la variante Cloud Run construit la même surcouche légère via `LimeSurvey_Common` et utilise également le port 8080 par défaut). |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (interface de bouclage) — requis sur GKE. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour les enquêtes ou exports volumineux. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléversement / POST ; conservez `post_max_size ≥ upload_max_filesize`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface LimeSurvey. |
| `workload_type` | `null` → `Deployment` | Deployment. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |

### Groupe 10 — Observabilité {#group-10--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | `TCP /`, délai de 30s, 20 échecs | Fenêtre généreuse au premier démarrage pour l'installateur en console. |
| `liveness_probe` | `HTTP /`, délai de 300s, 3 échecs | La page d'accueil `/` renvoie 200 une fois que LimeSurvey traite les requêtes. |

### Groupe 13 — Stockage NFS {#group-13--nfs-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les ressources d'enquête téléversées soient conservées et partagées. |
| `nfs_mount_path` | `/var/www/html/upload` | Emplacement où LimeSurvey stocke les téléversements, exports et données d'exécution. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique par défaut du groupe 14 ; un second bucket `limesurvey-uploads` est ajouté par le `module_storage_buckets` de `LimeSurvey_Common`. Aucun n'est monté par défaut. |
| `gcs_volumes` | `[]` | Aucun montage GCS Fuse par défaut — la persistance passe par NFS. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` (imposé par Common) | Seul MySQL 8.0 est pris en charge. |
| `application_database_name` | `limesurvey` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `limesurvey` | Utilisateur de base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Accès et réseau {#group-19--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à LimeSurvey. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms de la tâche de configuration (`db-init`) et de la tâche d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans
> état, IAP sans identités autorisées, des `quota_memory_*` donnés sous forme
> d'entiers bruts, un `container_port`/`backup_retention_days` hors plage. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc
> détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0` imposé) | Critical | Seul MySQL 8.0 est pris en charge par le point d'entrée et le schéma. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; un renommage recrée la base de données et l'utilisateur et rend toutes les données orphelines. |
| Variables d'environnement du moteur de base de données (`DB_MYSQL_ENGINE`/`DBENGINE`) | Laisser `InnoDB` (valeur par défaut du module) | Critical | Revenir à la valeur par défaut MyISAM de l'image empêche la création des tables sur Cloud SQL — le pod semble sain mais chaque page renvoie une erreur 500. |
| `enable_nfs` | `true` | High | Le désactiver rend éphémères les ressources et exports d'enquête téléversés — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base de données sur GKE. |
| `max_instance_count` | `1` | High | Passer au-delà de 1 sans comportement de partage des sessions vérifié risque de fragmenter les sessions. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes passent d'un pod à l'autre et perturbent les sessions authentifiées. |
| `PUBLIC_URL` (défini une fois l'IP connue) | URL externe du LoadBalancer/domaine | High | Une URL publique absente ou erronée casse les liens absolus et la résolution des ressources. |
| `memory_limit` | `2Gi` | High | En dessous de 512Mi, le pod PHP/Apache subit un OOM sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `ADMIN_PASSWORD` (généré automatiquement) | À récupérer avant la première connexion | Medium | Ne pas le connaître vous empêche d'accéder au premier compte super-administrateur jusqu'à sa réinitialisation via la base de données. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer entre les redéploiements, ce qui casse le DNS et `PUBLIC_URL`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention conforme aux exigences réglementaires. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à LimeSurvey partagée
avec la variante Cloud Run (génération des secrets, tâche `db-init`, stockage NFS des
téléversements et correspondance des variables d'environnement de base de données)
est décrite dans **[LimeSurvey_Common](LimeSurvey_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LimeSurvey sur GKE Autopilot](../labs/LimeSurvey_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LimeSurvey Common — Configuration applicative partagée](LimeSurvey_Common.md) — la configuration partagée par les deux cibles de déploiement.
