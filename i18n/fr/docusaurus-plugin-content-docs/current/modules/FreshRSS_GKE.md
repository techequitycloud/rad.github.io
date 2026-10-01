---
title: "FreshRSS sur GKE Autopilot"
description: "Référence de configuration pour déployer FreshRSS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/FreshRSS_GKE.md @ 3055034 sha256:f7d2d6f97e7b -->

# FreshRSS sur GKE Autopilot {#freshrss-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreshRSS_GKE.png" alt="FreshRSS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreshRSS est un agrégateur de flux RSS et Atom gratuit, auto-hébergé et sous licence
GPL-3.0 — un « lecteur d'actualités » léger et multi-utilisateur écrit en PHP, qui
s'exécute derrière Apache et expose les API Google Reader et Fever pour les clients
mobiles. Ce module déploie FreshRSS sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par FreshRSS et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

FreshRSS s'exécute comme une charge de travail web PHP/Apache. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le point d'entrée effectue l'installation avec `--db-type pgsql` |
| Stockage persistant | NFS (Filestore / autogéré) ou PVC en mode bloc | Répertoire de données sur `/var/www/FreshRSS/data` ; contient la configuration, l'état par utilisateur et le cache des flux. Aucun bucket GCS |
| Cache | Redis (facultatif) | Désactivé par défaut ; FreshRSS n'en a pas besoin |
| Secrets | Secret Manager | `FRESHRSS_ADMIN_PASSWORD` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur pris en charge.** Le point d'entrée du conteneur
  code en dur `--db-type pgsql` et le job `db-init` ne prend en charge que Postgres ;
  le schéma est créé par l'installateur de FreshRSS lui-même au premier démarrage.
- **Sur GKE, le Cloud SQL Auth Proxy s'exécute comme sidecar** lié à
  `127.0.0.1:5432`, si bien que FreshRSS se connecte à l'adresse de loopback
  (`DB_HOST = 127.0.0.1`) — le point d'entrée traite le loopback comme un hôte TCP
  en clair (le proxy assure la terminaison TLS).
- **NFS est activé par défaut** (`enable_nfs = true`) et monté sur
  `/var/www/FreshRSS/data`. FreshRSS y écrit sa configuration générée, l'état par
  utilisateur, les articles mis en cache et les favicons — sans volume persistant,
  cet état est perdu au redémarrage du pod. Un Deployment adossé à NFS utilise la
  stratégie `Recreate`, afin que deux pods n'écrivent jamais sur le même volume
  pendant un déploiement progressif.
- **`FRESHRSS_ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret
  Manager. Il initialise le compte `admin` par défaut (ainsi que son mot de passe
  d'API) lors de la première installation.
- **L'affinité de session est `ClientIP` par défaut.** Elle maintient les requêtes
  d'un client sur le même pod.
- **Un minimum d'un réplica est maintenu** (`min_instance_count = 1`,
  `max_instance_count = 1`) ; GKE ne prend pas en charge la mise à l'échelle à zéro,
  si bien que le cron d'actualisation des flux du conteneur s'exécute en permanence.
- **Une adresse IP externe statique est réservée par défaut**
  (`reserve_static_ip = true`) et un Ingress de domaine personnalisé est provisionné
  par défaut (`enable_custom_domain = true`) — renseignez `application_domains` pour
  servir de vrais noms d'hôte.
- **Le conteneur écoute sur le port 80** (Apache), et non 8080.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail FreshRSS {#a-gke-autopilot--the-freshrss-workload}

Les pods FreshRSS sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Comme le répertoire de données repose sur NFS, le
Deployment utilise la stratégie de mise à jour `Recreate` plutôt qu'une mise à jour
progressive.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail FreshRSS pour consulter les pods et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE" <service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

FreshRSS stocke toutes les données de l'application (flux, abonnements, articles,
catégories, utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Les
pods s'y connectent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur le
loopback `127.0.0.1:5432` ; aucune adresse IP publique n'est exposée. Lors du premier
déploiement, le Job `db-init` crée la base de données et l'utilisateur de
l'application, et l'installateur de FreshRSS crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les
sauvegardes et la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Stockage persistant (NFS / PVC) {#c-persistent-storage-nfs--pvc}

Le répertoire de données de FreshRSS (`/var/www/FreshRSS/data`) repose sur un
**volume NFS** (`enable_nfs = true`), qui contient la configuration générée, l'état
par utilisateur, les articles mis en cache et les favicons. Ce module ne déclare
**aucun bucket GCS**. Un PVC en mode bloc (StatefulSet) constitue un mode de
persistance alternatif, via les variables StatefulSet du groupe 7.

- **Console :** Filestore → Instances (NFS géré) ; Kubernetes Engine → Storage
  (PVC).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /var/www/FreshRSS/data
  ```

Consultez [App_GKE](App_GKE.md) pour le modèle de serveur NFS, les PVC en mode bloc
et GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`) et FreshRSS n'en a pas
besoin. Il est exposé comme option transmise par souci de cohérence avec les modules
PHP apparentés ; laissez-le désactivé sauf raison précise de l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

Un secret d'application est généré automatiquement : `FRESHRSS_ADMIN_PASSWORD`, qui
initialise le compte `admin` par défaut et son mot de passe d'API lors de la
première installation. Le mot de passe de la base de données est géré séparément
par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freshrss"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP Cloud Load Balancing
externe avec une adresse IP statique réservée, et un Ingress de domaine personnalisé
est provisionné. Ajoutez des noms d'hôte via `application_domains` pour obtenir un
certificat géré par Google.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
de GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application FreshRSS {#3-freshrss-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job `db-init`
  s'exécute avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données et l'utilisateur de l'application,
  puis accorde les privilèges. Le job peut être réexécuté sans risque.
- **Installation au premier démarrage.** Le script `platform-entrypoint.sh` du
  conteneur résout l'hôte de la base de données (loopback du proxy `127.0.0.1` sur
  GKE), puis pilote les scripts de FreshRSS `cli/do-install.php` (qui crée
  `data/config.php` et le schéma) et `cli/create-user.php` (qui crée le compte
  `admin` à partir de `FRESHRSS_ADMIN_PASSWORD`), avant d'enchaîner sur le point
  d'entrée d'origine. L'installation est idempotente — elle est ignorée dès que
  `data/config.php` existe sur le volume persistant.
- **Cron d'actualisation des flux.** L'image d'origine démarre un cron dans le
  conteneur (`CRON_MIN = */15`) qui actualise les flux suivis toutes les
  15 minutes. Comme GKE maintient au moins un réplica en cours d'exécution, le cron
  se déclenche toujours.
- **Identifiant administrateur.** L'identifiant par défaut est `admin` avec le
  `FRESHRSS_ADMIN_PASSWORD` généré ; la même valeur est définie comme mot de passe
  d'API utilisé par les clients mobiles des API Google Reader / Fever. Modifiez-le
  dans l'interface de FreshRSS après la première connexion — la seule rotation de la
  valeur dans Secret Manager ne réinitialise pas un compte déjà installé.
- **Stratégie de déploiement.** Lorsque NFS est activé, le Deployment utilise
  `Recreate` (et non `RollingUpdate`) afin que deux pods n'écrivent jamais
  simultanément dans le répertoire de données partagé — une mise à jour progressive
  de cette application avec état se bloquerait sur les verrous de fichiers et de
  base de données.
- **Chemin de santé.** La sonde de démarrage est une vérification TCP sur le
  port 80 ; la sonde de vivacité est un HTTP GET sur `/` (200). FreshRSS sert
  également un point de terminaison JSON `/status` non authentifié, adapté aux
  tests de disponibilité. Prévoyez une fenêtre généreuse au premier démarrage, le
  temps que l'installateur crée le schéma.
- **Définissez l'URL externe une fois l'adresse IP connue.** Vérifiez l'adresse IP
  du LoadBalancer / l'hôte de l'Ingress et définissez `BASE_URL` (via
  `environment_variables`) ou `application_domains` afin que les liens
  autoréférents de FreshRSS soient correctement résolus :
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à FreshRSS ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freshrss` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image FreshRSS ; `latest` est épinglé sur un tag éprouvé (`1.26.3`) au moment du build. Épinglez-le explicitement en production. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | FreshRSS est livré avec un build personnalisé léger ; n'utilisez `prebuilt` qu'avec une `container_image` externe. |
| `cpu_limit` | `1000m` | CPU par pod (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par pod ; conservez au moins 512Mi. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige au moins 1. Maintient FreshRSS et son cron d'actualisation en fonctionnement. |
| `max_instance_count` | `1` | Conservez 1 — un seul pod détient le cron d'actualisation et l'état stocké sur fichiers. |
| `container_port` | `80` | FreshRSS/Apache écoute sur le port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions Postgres. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0 à 3600 secondes). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout en `Deployment` ; adossé à NFS, il utilise donc la stratégie `Recreate`. Ne définissez `StatefulSet` qu'avec un PVC en mode bloc. |
| `session_affinity` | `ClientIP` | Routage persistant, afin qu'un client reste sur un même pod. |
| `network_tags` | `["nfsserver"]` | `nfsserver` est requis lorsque `enable_nfs = true`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC en mode bloc par pod comme alternative à NFS pour le répertoire de données. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/var/www/FreshRSS/data` | Chemin de montage du PVC dans le conteneur ; doit correspondre au chemin de montage NFS afin que le répertoire de données soit persistant dans les deux cas. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s delay, threshold 20 | Sonde de démarrage ; le seuil élevé laisse le temps à l'installation du premier démarrage. |
| `liveness_probe` | HTTP `/` 300s delay | Sonde de vivacité ; `/status` est un point de terminaison JSON non authentifié alternatif. |
| `uptime_check_config` | `{enabled=false, path="/"}` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un volume NFS persistant pour le répertoire de données de FreshRSS. **Laissez-le activé** — indispensable pour conserver la configuration et l'état par utilisateur. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Emplacement de montage du volume NFS dans le conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Version du moteur PostgreSQL. FreshRSS s'installe avec `--db-type pgsql`. |
| `application_database_name` | `freshrss` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `freshrss` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir ; à définir pour obtenir un certificat géré. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut ; FreshRSS n'a pas besoin de Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis, s'il est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à FreshRSS. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (FreshRSS n'en déclare aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, IAP sans identité autorisée, des valeurs de quota mémoire sans suffixe d'unité binaire, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (ou un PVC en mode bloc) | `true` | Critical | Sans volume persistant, le répertoire de données de FreshRSS est éphémère — `config.php`, l'état par utilisateur et le cache sont effacés au redémarrage du pod, ce qui impose une réinstallation. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Critical | Un montage ailleurs laisse le répertoire de données éphémère (même effet qu'une absence de NFS). |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur, et rend orphelines toutes les données des flux. |
| `database_type` | `POSTGRES_15` | Critical | FreshRSS s'installe avec `--db-type pgsql` ; un moteur autre que Postgres casse l'installateur et `db-init`. |
| `container_port` | `80` | High | FreshRSS/Apache écoute sur le port 80 ; un port erroné fait échouer la sonde de démarrage et les pods ne deviennent jamais Ready. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL via le loopback `127.0.0.1`. |
| `max_instance_count` | `1` | High | Exécuter plusieurs pods duplique le cron d'actualisation du conteneur et fragmente l'état de session/cache stocké sur fichiers ; une mise à jour progressive sur le répertoire NFS partagé se bloque. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes d'un client se dispersent entre les pods, ce qui perturbe les sessions connectées. |
| `min_instance_count` | `1` | High | GKE exige un minimum d'au moins 1 ; la garde de validation rejette les valeurs invalides. Conserver 1 maintient FreshRSS et son cron d'actualisation en fonctionnement. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_iap` | uniquement pour les déploiements privés | High | IAP bloque toutes les requêtes non authentifiées, y compris celles des clients mobiles utilisant les API Google Reader / Fever. |
| `FRESHRSS_ADMIN_PASSWORD` (généré automatiquement) | À modifier dans l'interface après la première connexion | Medium | La seule rotation du secret ne réinitialise pas un compte déjà installé ; le premier mot de passe reste valide jusqu'à sa modification dans l'application. |
| `application_domains` | À définir avec `enable_custom_domain` | Medium | `enable_custom_domain = true` sans nom d'hôte provisionne un Ingress qui ne sert aucun certificat géré. |
| `memory_limit` | `2Gi` | Medium | Les valeurs inférieures à 512Mi exposent à un OOM lors d'actualisations de flux intensives. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à FreshRSS, partagée
avec la variante Cloud Run, est décrite dans **[FreshRSS_Common](FreshRSS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreshRSS sur GKE Autopilot](../labs/FreshRSS_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreshRSS Common — Configuration applicative partagée](FreshRSS_Common.md) — la configuration partagée par les deux cibles de déploiement.
