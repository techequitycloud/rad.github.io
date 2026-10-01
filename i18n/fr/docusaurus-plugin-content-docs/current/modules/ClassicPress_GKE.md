---
title: "ClassicPress sur GKE Autopilot"
description: "Référence de configuration pour déployer ClassicPress sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ClassicPress_GKE.md @ 3055034 sha256:992b2bf047b3 -->

# ClassicPress sur GKE Autopilot {#classicpress-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ClassicPress_GKE.png" alt="ClassicPress sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ClassicPress est un CMS gratuit, open source et orienté entreprise — un fork léger de
WordPress 4.9.x qui préserve l'expérience d'édition classique (antérieure à Gutenberg), avec
extensions, thèmes, médiathèque et API REST. Ce module déploie ClassicPress sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par ClassicPress et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ClassicPress s'exécute sous la forme d'une unique charge de travail web PHP/Apache, construite à partir d'une image personnalisée légère
`FROM classicpress/classicpress`. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut |
| Forme de la charge de travail | **StatefulSet** Kubernetes + PVC en mode bloc | `stateful_pvc_enabled = true` résout automatiquement `workload_type` en `StatefulSet` ; un PVC `standard-rwo` (SSD) de 10Gi est monté sur `/var/www/html` — toute l'installation ClassicPress (code, extensions, thèmes, `wp-content`/uploads) réside sur ce volume propre à chaque pod |
| Base de données | Cloud SQL pour MySQL 8.0 | Fixe — `ClassicPress_Common` code en dur `database_type = "MYSQL_8_0"` |
| Persistance des fichiers (secondaire) | Cloud Filestore (NFS) | Monté sur `/var/www/html/wp-content` par défaut (`enable_nfs = true`) — un sous-chemin du PVC du StatefulSet ci-dessous ; c'est le mécanisme confirmé de persistance des uploads/extensions/thèmes (voir la [section 3](#3-classicpress-application-behaviour)) |
| Stockage d'objets | Cloud Storage | Un bucket `classicpress-uploads` est provisionné automatiquement mais **n'est pas** monté dans le pod par défaut |
| Secrets | Secret Manager | `CLASSICPRESS_SALT_SEED` généré automatiquement (dont dérivent les 8 clés/sels d'authentification de type WordPress) ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré activés par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire et codé en dur.** Le `config` de `ClassicPress_Common`
  définit directement `database_type = "MYSQL_8_0"` ; la variable `database_type` de la variante
  (par défaut `null`) ne prend effet que si elle est explicitement surchargée, et le faire casse
  le job `db-init` et le point d'entrée propres à MySQL. Laissez-la à `null`.
- **Build personnalisé, pas d'image préconstruite.** `container_image_source` vaut par défaut `"custom"` —
  Cloud Build produit une image légère `FROM classicpress/classicpress` qui greffe une
  cale (shim) de point d'entrée faisant correspondre les variables `DB_*` injectées par le socle aux
  `CLASSICPRESS_DB_*` de ClassicPress et dérivant des sels d'authentification stables. L'image amont standard n'est
  jamais déployée directement.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface loopback.** La variante définit
  `DB_HOST = 127.0.0.1` ; un sidecar cloud-sql-proxy (`enable_cloudsql_volume = true`)
  écoute sur `127.0.0.1:3306`, et le point d'entrée fait correspondre les valeurs `DB_*` injectées
  à `CLASSICPRESS_DB_*` (TCP, aucun SSL nécessaire pour MySQL).
- **Un seul réplica, StatefulSet par défaut.** `min_instance_count = 1`,
  `max_instance_count = 1`. Chaque pod obtient son propre PVC via `stateful_pvc_enabled = true`
  (par défaut) ; dépasser 1 réplica donnerait donc à chaque pod une copie *distincte* et non synchronisée
  de l'installation plutôt qu'une copie partagée.
- **NFS est également activé par défaut** (`enable_nfs = true`, monté sur
  `/var/www/html/wp-content` — un sous-répertoire du point de montage du PVC du StatefulSet ci-dessous).
  ClassicPress lit et écrit les médias téléversés, les extensions et les thèmes sous `wp-content`,
  et la logique de copie au premier démarrage du point d'entrée amont ignore explicitement un répertoire
  `wp-content` existant ; ce montage est donc un véritable chemin de persistance confirmé pour
  ces données — et non un stockage superflu ou inutilisé. Voir le tableau des pièges.
- **Pas d'installation automatique — la première connexion est manuelle.** `ClassicPress_Common` ne génère aucun
  secret de mot de passe administrateur et ne définit aucun indicateur d'installation automatique. ClassicPress crée son
  schéma et son compte administrateur via son propre installateur web de premier lancement, une fois que `db-init`
  a provisionné la base de données vide.
- **`CLASSICPRESS_SALT_SEED` est généré automatiquement** et stocké dans Secret
  Manager ; le point d'entrée en dérive de façon déterministe les 8 valeurs `AUTH_KEY`/`SALT` de type WordPress,
  si bien que les cookies et les sessions survivent aux redémarrages de pod.
- **La sonde de démarrage est généreuse (TCP, 20 tentatives)** pour laisser au point d'entrée propre à
  l'image amont le temps de remplir le PVC `/var/www/html` vide au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ClassicPress {#a-gke-autopilot--the-classicpress-workload}

ClassicPress s'exécute en tant que **StatefulSet** (sélectionné automatiquement parce que `stateful_pvc_enabled`
vaut `true` par défaut), planifié sur Autopilot, qui facture le CPU et la mémoire que le pod
demande réellement. L'unique réplica possède un PVC `standard-rwo` (SSD) dédié.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail ClassicPress pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE" --selector 'app~classicpress' 2>/dev/null || \
    kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment ou StatefulSet) sont gérés, et le groupe 7 pour les mécanismes StatefulSet/PVC.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

ClassicPress stocke toutes les données applicatives (articles, pages, utilisateurs, options, paramètres
des extensions/thèmes) dans une instance gérée Cloud SQL pour MySQL 8.0. Les pods y accèdent via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Au
premier déploiement, le job `db-init` crée la base de données applicative, l'utilisateur et les droits,
vérifie que l'utilisateur applicatif peut se connecter, puis arrête le sidecar.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [Outputs](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe.

### C. Stockage — PVC du StatefulSet, NFS et Cloud Storage {#c-storage--statefulset-pvc-nfs-and-cloud-storage}

Trois mécanismes de stockage distincts sont présents. Le **PVC du StatefulSet** (10Gi,
`standard-rwo`, monté sur `/var/www/html`) contient toute l'installation ClassicPress,
y compris les médias téléversés — la persistance de toute la racine web tant que le pod
conserve son PVC. **NFS (Cloud Filestore)** est monté séparément sur
`/var/www/html/wp-content` (`enable_nfs = true`), un sous-répertoire du point de montage du PVC
ci-dessus ; la logique de copie du point d'entrée amont ignore explicitement un répertoire `wp-content`
existant, il s'agit donc d'un véritable chemin de persistance confirmé, spécifiquement pour les uploads/extensions/thèmes
— et non d'un montage inutilisé (voir le tableau des pièges). Un bucket **Cloud Storage**
(suffixe `classicpress-uploads`) est également provisionné, mais il n'est pas relié au pod
comme montage `gcs_volumes` par défaut ; ajoutez une entrée à `gcs_volumes` pour l'utiliser.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims ; Filestore →
  Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT" --filter="name~classicpress-uploads"
  ```

Consultez les groupes 7, 13 et 14 d'[App_GKE](App_GKE.md) pour le cycle de vie des PVC, la découverte NFS et
les mécanismes de montage GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret propre à ClassicPress est généré automatiquement et stocké dans Secret
Manager : `CLASSICPRESS_SALT_SEED`, une graine aléatoire de 64 caractères dont le
point d'entrée dérive les 8 valeurs de type WordPress `AUTH_KEY`/`SECURE_AUTH_KEY`/
`LOGGED_IN_KEY`/`NONCE_KEY` et leurs valeurs `SALT` correspondantes (SHA-256 de la graine
plus un suffixe fixe propre à chaque clé). Le mot de passe de la base de données est géré séparément par le
socle. Sur GKE, les secrets sont projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~classicpress"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux
redéploiements), et `enable_custom_domain = true` provisionne une ressource Ingress prête
pour un certificat géré par Google dès que `application_domains` est renseigné.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ClassicPress {#3-classicpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` avec
  `mysql:8.0-debian`. Il attend la connectivité TCP (ou un socket Cloud SQL),
  crée de manière idempotente la base de données applicative, l'utilisateur et les droits, vérifie que l'utilisateur
  applicatif peut se connecter, puis arrête proprement le sidecar Cloud SQL Auth Proxy
  (`POST /quitquitquit`, avec repli sur `SIGKILL`). Le job peut être réexécuté sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration distinct — installation manuelle au premier lancement.** Il n'existe aucun
  indicateur d'installation automatique pour ClassicPress. Une fois que `db-init` a provisionné la base de données
  vide, ClassicPress crée son propre schéma et son compte administrateur via
  l'installateur web de premier lancement (`/wp-admin/install.php` dans l'image amont). Ouvrez
  l'URL du service après le premier déploiement et terminez l'installateur pour définir le nom d'utilisateur, le mot de passe
  et l'adresse e-mail de l'administrateur — il n'existe aucun secret de mot de passe administrateur généré.
- **Correspondance des variables d'environnement de base de données sur loopback.** Le socle injecte `DB_HOST = 127.0.0.1`
  (le sidecar proxy), `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; ClassicPress
  lit `CLASSICPRESS_DB_*`. Le `entrypoint.sh` greffé construit
  `CLASSICPRESS_DB_HOST` sous la forme `host:port` (ou `localhost:<socket>` si un répertoire de
  socket Cloud SQL est trouvé) et fait correspondre le reste, avant de passer la main au
  `docker-entrypoint.sh` amont.
- **Les clés et sels d'authentification sont dérivés, pas stockés individuellement.** `CLASSICPRESS_SALT_SEED`
  est le seul secret généré ; le point d'entrée calcule les 8 valeurs
  `CLASSICPRESS_AUTH_KEY` / `..._SALT` sous la forme
  `sha256(seed-<key-name>)`, si bien que chaque redémarrage et chaque pod (si vous montez un jour en charge horizontalement)
  s'accordent sur les mêmes valeurs sans persister l'état de `wp-config.php`.
- **L'installation elle-même réside sur le PVC du StatefulSet.** Le
  `docker-entrypoint.sh` amont écrit `wp-config.php` et copie l'application
  ClassicPress dans `/var/www/html` au premier démarrage — qui, dans ce module, est un PVC en mode bloc
  `standard-rwo` de 10Gi et non un stockage de conteneur éphémère ; l'installation (extensions,
  thèmes et `wp-content/uploads`) survit donc aux redémarrages et aux replanifications de pod.
- **Le chemin de montage NFS est le mécanisme de persistance confirmé pour `wp-content`.**
  `enable_nfs = true` monte Filestore sur `/var/www/html/wp-content` par défaut — un
  sous-répertoire du PVC du StatefulSet monté sur `/var/www/html`. ClassicPress (un
  fork de WordPress) lit et écrit les médias téléversés, les extensions et les thèmes sous
  `wp-content`, et la logique de copie au premier démarrage du point d'entrée amont ignore explicitement
  un répertoire `wp-content` existant ; y monter NFS est donc sûr et efficace.
  Dans ce module, le PVC persiste déjà toute la racine web pour chaque pod ; le montage NFS
  est donc surtout utile si `stateful_pvc_enabled` est un jour désactivé ou si une future
  mise à l'échelle multi-réplicas doit partager `wp-content` entre les pods (le PVC est
  propre à chaque pod, NFS est partagé).
- **Redis est facultatif et désactivé par défaut.** Lorsque `enable_redis = true`, laisser
  `redis_host` vide permet à l'injection `REDIS_HOST` propre au socle (l'IP Redis de la VM
  NFS partagée lorsque `enable_nfs = true`) de s'appliquer ; définir `redis_host`
  explicitement fait pointer ClassicPress vers une instance Redis/Memorystore externe.
- **Chemins de santé.** La sonde de démarrage est **TCP** sur le port 80 avec un
  `failure_threshold = 20` généreux (le premier démarrage copie toute l'application sur le PVC
  vide, ce qui peut prendre du temps) ; la sonde de vivacité est **HTTP** `GET /` avec un délai
  initial de 300 secondes — un 200 (site installé) comme une redirection 302 vers l'installateur (site
  neuf) sont considérés comme sains.
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep CLASSICPRESS_DB
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement (selon leur
balise `{{UIMeta group=N}}`, et non selon les commentaires de section du fichier `.tf`, qui sont
parfois désynchronisés des balises). Seuls les paramètres propres à ClassicPress ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `classicpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Correspond au tag de l'image `classicpress/classicpress`. Les tags sont qualifiés par la version de PHP (`php8.3-apache`, `php8.4-apache`), et non par la version de l'application ; `latest` est résolu en un tag épinglé qualifié par PHP au moment du build via l'argument de build propre à l'application `CLASSICPRESS_VERSION` (l'argument de build générique `APP_VERSION` injecté par le socle l'écraserait sinon silencieusement avec le tag littéral et inexistant `"latest"`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit l'image légère `FROM classicpress/classicpress` avec la cale de point d'entrée greffée ; obligatoire — l'image standard ne peut pas faire correspondre `DB_*` d'elle-même. |
| `cpu_limit` | `1000m` | Limite de CPU du conteneur ClassicPress. À augmenter pour les sites à fort trafic ou les extensions lourdes. |
| `memory_limit` | `2Gi` | Limite de mémoire. Les applications de la famille WordPress nécessitent généralement ≥512Mi ; davantage pour les grandes médiathèques. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Gardez les deux à 1 — le PVC du StatefulSet est propre à chaque pod et non partagé. |
| `container_port` | `80` | ClassicPress s'exécute sur Apache, port 80. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; doit être ≤ `memory_limit`. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale d'upload / de POST ; gardez `post_max_size ≥ upload_max_filesize`. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — obligatoire sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface ClassicPress. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement parce que `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | ClassicPress stocke toute son installation sous `/var/www/html` ; l'activer résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod. À augmenter pour les grandes médiathèques. |
| `stateful_pvc_mount_path` | `/var/www/html` | Emplacement de l'installation ClassicPress (code + `wp-content`/uploads). |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD sur SSD ; consomme le quota régional `SSD_TOTAL_GB`. Surchargez avec `standard` (HDD) si le quota est limité. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | `{ type: TCP, path: "/", failure_threshold: 20, period_seconds: 15 }` | Seuil généreux — le premier démarrage remplit le PVC vide avec l'application complète. |
| `liveness_probe` | `{ type: HTTP, path: "/", initial_delay_seconds: 300 }` | Un 200 comme un 302 vers l'installateur sont considérés comme sains. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un stockage partagé adossé à Filestore, monté sur `nfs_mount_path` — le mécanisme de persistance confirmé pour les uploads/extensions/thèmes ; voir la [section 3](#3-classicpress-application-behaviour). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage du partage NFS dans le conteneur, un sous-répertoire du PVC du StatefulSet. La logique de copie du point d'entrée amont ignore un répertoire `wp-content` existant ; y monter le partage est donc sûr. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active le backend de cache d'objets de type WordPress de ClassicPress. |
| `redis_host` | `""` | Laissez vide pour vous rabattre sur le `REDIS_HOST` propre au socle (l'IP Redis de la VM NFS lorsque `enable_nfs = true`) ; définissez-le explicitement pour utiliser une instance Redis/Memorystore externe. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Codé en dur dans `ClassicPress_Common` ; laissez `null`. Le surcharger casse le job `db-init` et le point d'entrée propres à MySQL. |
| `application_database_name` | `classicpress` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `classicpress` | Utilisateur de la base de données applicative ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress prêt pour un certificat géré dès que `application_domains` est défini. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés — vide par défaut ; ajoutez-en un pour activer le certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à ClassicPress. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `classicpress-uploads`). |
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

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé en même temps qu'un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution. ClassicPress exécute également ses propres préconditions (`validation.tf`) pour `upload_max_filesize ≤ post_max_size`, `min_instance_count ≤ max_instance_count`, Redis sans source d'hôte, IAP sans identifiants OAuth, et `enable_cloudsql_volume` avec `database_type = "NONE"`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Le job `db-init` et le point d'entrée de `ClassicPress_Common` sont propres à MySQL ; les surcharger avec un moteur Postgres/SQL Server casse les deux. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelines toutes les données. |
| `CLASSICPRESS_SALT_SEED` (généré automatiquement) | Ne jamais modifier | Critical | Modifier la graine après le premier démarrage invalide tous les cookies signés et toutes les sessions connectées. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` | `10Gi` / `/var/www/html` | Critical | Ce PVC contient toute l'installation (code + uploads) — le réduire ou perdre le PVC détruit le site ; le chemin de montage doit correspondre à l'emplacement où écrit le point d'entrée de ClassicPress. |
| `max_instance_count` | `1` | High | Chaque pod du StatefulSet obtient son propre PVC ; dépasser 1 donne à chaque réplica une copie distincte et divergente du site plutôt qu'une copie partagée. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:3306` est nécessaire à la connectivité à la base de données sur GKE. |
| `enable_nfs` | `true` | Low | Provisionne et facture une instance Filestore montée sur `/var/www/html/wp-content` — le mécanisme confirmé de persistance des uploads/extensions/thèmes (voir la [section 3](#3-classicpress-application-behaviour)), en plus de la persistance par pod du PVC du StatefulSet pour le reste de la racine web. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Consomme le quota régional serré `SSD_TOTAL_GB`. Surchargez avec `standard` (HDD `pd-standard`) sur les projets dont le quota est limité — suffisant pour une charge de travail PHP/MySQL à faible IOPS. |
| Configuration de l'administrateur au premier lancement | Terminer `/wp-admin/install.php` rapidement après le déploiement | Medium | Tant que l'installateur n'a pas été exécuté, le site n'a ni schéma ni compte administrateur — il n'existe aucun secret de mot de passe administrateur généré permettant de récupérer l'accès. |
| `memory_limit` | `2Gi` | Medium | En dessous d'environ 512Mi, le pod PHP/Apache risque un OOM sous charge ou avec des extensions plus lourdes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et toute URL de site codée en dur. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et réplication d'images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à ClassicPress, partagée avec la variante Cloud Run, est
décrite dans le module `ClassicPress_Common` (aucun guide autonome `ClassicPress_Common.md`
n'existe encore dans cette documentation).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ClassicPress sur GKE Autopilot](../labs/ClassicPress_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ClassicPress sur Google Cloud Run](ClassicPress_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ClassicPress Common — Configuration applicative partagée](ClassicPress_Common.md) — la configuration partagée par les deux cibles de déploiement.
