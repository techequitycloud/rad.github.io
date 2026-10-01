---
title: "Monica sur GKE Autopilot"
description: "Référence de configuration pour déployer Monica sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Monica_GKE.md @ 3055034 sha256:19fd23fae766 -->

# Monica sur GKE Autopilot {#monica-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Monica_GKE.png" alt="Monica sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Monica est une application open source de gestion des relations personnelles (PRM) — un « CRM personnel » pour organiser la façon dont vous restez en contact avec vos amis, votre famille et vos relations. Ce module déploie Monica sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Monica et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Monica s'exécute sous forme de charge de travail web PHP/Laravel (image Apache officielle). Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Apache/PHP, 1 vCPU / 2 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — Monica est liée à MySQL |
| Stockage d'objets | Cloud Storage | Un bucket dédié `monica-uploads` pour les photos et documents des contacts, plus un bucket `data` par défaut issu de `storage_buckets` |
| Persistance | NFS (activé par défaut) | Volume partagé entre les pods pour les téléversements du répertoire `storage/` de Laravel |
| Cache | Redis (facultatif) | Désactivé par défaut ; utilisé pour le cache et les sessions lorsqu'il est activé |
| Secrets | Secret Manager | `APP_KEY` Laravel généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** Le moteur de base de données provient de la couche applicative partagée (`MYSQL_8_0`) ; Monica ne s'exécute pas sur PostgreSQL ici.
- **L'image est l'image officielle précompilée `monica:<version>`.** Pas d'étape Cloud Build — `container_image_source = "prebuilt"` récupère la variante Apache depuis Docker Hub, qui sert sur le **port 80**.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager. C'est une clé de chiffrement Laravel qui ne doit jamais faire l'objet d'une rotation après le premier démarrage — sa rotation corrompt définitivement tous les champs chiffrés de la base de données et invalide toutes les sessions.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image exécute `php artisan migrate --force` à chaque démarrage de pod, de sorte que le schéma est créé et mis à niveau au démarrage (après que le job `db-init` a provisionné la base de données et l'utilisateur).
- **Sidecar Cloud SQL Auth Proxy sur `127.0.0.1`.** `enable_cloudsql_volume = true` sur GKE — l'Auth Proxy s'exécute sous forme de sidecar lié à la boucle locale, si bien que `Monica_GKE` redéfinit `DB_HOST = 127.0.0.1`.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les fichiers téléversés dans le répertoire `storage/` de Laravel soient partagés et durables entre les pods.
- **Un minimum d'un réplica est maintenu** (`min_instance_count = 1`, `max = 1`) — GKE ne prend pas en charge la mise à l'échelle jusqu'à zéro, et un seul réplica convient à un CRM personnel.
- **`APP_URL` est défini à partir de l'URL prévue du service** afin que Laravel construise des liens absolus corrects ; mettez-le à jour avec l'URL du LoadBalancer externe ou du domaine personnalisé une fois l'adresse IP connue.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Monica {#a-gke-autopilot--the-monica-workload}

Les pods Monica sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés par les pods. Le déploiement exécute un seul réplica par défaut.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Monica pour voir les pods et les événements. Kubernetes Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe deploy -n "$NAMESPACE" <service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle et le type de charge de travail (Deployment ou StatefulSet). Notez que lorsque l'application s'appuie sur NFS, le socle utilise une stratégie de mise à jour `Recreate` pour éviter que deux pods se disputent le volume partagé et la base de données pendant les déploiements.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Monica stocke toutes les données applicatives (contacts, activités, rappels, entrées de journal, utilisateurs) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune adresse IP publique n'est exposée. Au premier déploiement, le job `db-init` crée la base de données applicative et l'utilisateur et accorde les privilèges ; le point d'entrée du conteneur exécute ensuite les migrations Laravel.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les options et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `monica-uploads`) est provisionné automatiquement pour les fichiers téléversés de Monica (photos des contacts, documents). Un second bucket (suffixe `data`) est également créé par défaut via l'entrée par défaut de la variable `storage_buckets`. Le compte de service de la charge de travail y reçoit l'accès. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, le socle injecte `REDIS_HOST`/`REDIS_PORT` ; si `redis_host` est laissé vide alors que NFS est activé, l'adresse IP de la VM du serveur NFS est utilisée comme point de terminaison Redis (la VM NFS héberge aussi Redis).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected Redis env in the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS_HOST
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : l'**`APP_KEY`** Laravel (utilisé pour le chiffrement AES-256-CBC des colonnes chiffrées et pour la signature des sessions/cookies). Il est transmis au pod via le pilote Secret Store CSI. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
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

## 3. Comportement de l'application Monica {#3-monica-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte via le Cloud SQL Auth Proxy puis crée de manière idempotente la base de données applicative et l'utilisateur, accorde les privilèges et vérifie que l'utilisateur applicatif peut se connecter (ce qui préchauffe aussi le cache d'authentification `caching_sha2_password` de MySQL 8). Le job peut être réexécuté sans risque.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image officielle Monica exécute `php artisan migrate --force` à chaque démarrage de pod — il n'existe pas de job de migration distinct. Le schéma est créé au premier démarrage (après `db-init`) et mis à niveau automatiquement lorsque vous augmentez `application_version`.
- **`APP_KEY` est immuable après le premier démarrage.** Il est généré une seule fois et écrit dans Secret Manager. Le modifier corrompt définitivement tous les champs chiffrés de la base de données et invalide toutes les sessions — n'effectuez sa rotation que pendant une fenêtre de maintenance planifiée, avec un plan complet de re-chiffrement des données.
- **Configuration initiale dans l'interface.** Monica n'a **aucun identifiant par défaut**. Accédez à l'URL du LoadBalancer externe : un visiteur non authentifié est redirigé vers la page d'inscription/de configuration. Le premier compte que vous créez devient l'administrateur. Inscrivez-vous avec `admin@techequity.cloud` pour les déploiements RAD.
- **Les téléversements de fichiers sont partagés entre les pods.** Les photos et documents téléversés résident sous le répertoire `storage/` de Laravel. NFS est activé par défaut afin que le volume soit partagé et durable ; le bucket GCS `monica-uploads` est également provisionné. Les déploiements adossés à NFS utilisent la stratégie `Recreate` pour éviter que deux pods se disputent le même volume.
- **Chemin de santé.** La sonde de démarrage est en **TCP** sur `/` (elle réussit dès qu'Apache se lie au port) et la sonde de vivacité est en **HTTP** `GET /` (la page d'accueil de Monica renvoie `200`). Prévoyez une fenêtre généreuse au premier démarrage pour le lancement d'Apache et le `php artisan migrate --force` initial.
- **Mettez à jour `APP_URL` une fois l'adresse IP connue.** L'URL prévue est injectée au moment du plan ; définissez `APP_URL` sur l'URL du LoadBalancer externe ou du domaine personnalisé via `environment_variables` afin que les liens absolus et les redirections soient résolus correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Monica ou notables pour celle-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `monica` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Monica ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Récupère directement l'image officielle `monica` — ne la remplacez pas par `custom`. |
| `container_port` | `80` | L'image Apache de Monica écoute sur le port 80. |
| `cpu_limit` | `1000m` | CPU par pod (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `min_instance_count` | `1` | GKE ne permet pas la mise à l'échelle jusqu'à zéro ; conservez 1 pour un CRM personnel. |
| `max_instance_count` | `1` | Un seul réplica suffit. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy ; `DB_HOST` est redéfini à `127.0.0.1`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut — volume partagé et durable entre les pods pour les téléversements du répertoire `storage/` de Laravel. |
| `nfs_mount_path` | `/var/www/html/storage` | Chemin de montage dans le conteneur — Monica conserve les téléversements et les données d'exécution sous le répertoire `storage/` de Laravel. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `monica-uploads` (issu du module Common) ainsi que les buckets de `storage_buckets`. Définissez `false` pour ignorer toute création de bucket. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires à provisionner — la valeur par défaut crée un second bucket `data` à côté de `monica-uploads`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse facultatifs via le pilote CSI. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` (issu de Common) | Fixé à MySQL 8.0. |
| `application_database_name` | `monica` | Nom de base de la base de données (préfixé par le locataire). Immuable après le premier déploiement. |
| `application_database_user` | `monica` | Nom de base de l'utilisateur de la base de données applicative. Immuable après le premier déploiement. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | À activer pour adosser le cache et les sessions à Redis ; injecte `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

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
| `service_url` | URL permettant d'accéder à Monica. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`monica-uploads` et `data` par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage, des valeurs `quota_memory_*` sous forme d'entiers nus, un workload_type `Deployment` conjointement à `stateful_pvc_enabled`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (généré automatiquement) | Ne jamais en faire la rotation après le premier démarrage | Critique | Sa rotation corrompt définitivement tous les champs chiffrés de la base de données et invalide toutes les sessions. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critique | Monica est une application MySQL ; un moteur autre que MySQL casse le pilote et les migrations. |
| `enable_nfs` | `true` | Élevé | Le désactiver supprime le volume partagé `storage/` — les photos et documents téléversés ne sont pas partagés entre les pods et sont perdus lors de la recréation d'un pod. |
| `container_image_source` | `prebuilt` | Élevé | Définir `custom` amène App_GKE à tenter un build sans Dockerfile. |
| `container_port` | `80` | Élevé | L'image Apache écoute sur 80 ; un port différent fait échouer la sonde de démarrage. |
| `enable_cloudsql_volume` | `true` (GKE) | Élevé | Le sidecar Auth Proxy fournit `127.0.0.1:3306` ; le désactiver casse la connectivité MySQL. |
| `DB_HOST` (défini automatiquement à `127.0.0.1`) | conserver la valeur injectée | Élevé | Sur GKE, le sidecar du proxy est sur la boucle locale ; un autre hôte ne peut pas joindre MySQL. |
| `APP_URL` | URL du LoadBalancer externe ou du domaine | Élevé | Une URL erronée casse les liens absolus et la redirection `/` → configuration/inscription. |
| `min_instance_count` | `1` | Moyen | GKE exige min ≥ 1 ; un seul réplica convient à un CRM personnel. |
| `memory_limit` | `2Gi` | Moyen | Réduire trop fortement la mémoire expose à des OOM PHP pendant les migrations du premier démarrage et sur les pages lourdes. |
| `enable_redis` | désactivé sauf besoin | Faible | Cache et sessions Redis facultatifs ; s'il est activé sans hôte et avec NFS désactivé, le point de terminaison Redis est vide. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Monica partagée avec la variante Cloud Run est décrite dans **[Monica_Common](Monica_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Monica sur GKE Autopilot](../labs/Monica_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Monica sur Google Cloud Run](Monica_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Monica Common — Configuration applicative partagée](Monica_Common.md) — la configuration partagée par les deux cibles de déploiement.
