---
title: "Module Penpot GKE — Guide de configuration"
description: "Référence de configuration pour déployer Penpot sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Penpot_GKE.md @ 3055034 sha256:1d047570614f -->

# Module Penpot GKE — Guide de configuration {#penpot-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Penpot_GKE.png" alt="Module Penpot GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `Penpot_GKE`. `Penpot_GKE` est un **module wrapper** qui associe le module d'infrastructure générique [`App_GKE`](./App_GKE.md) à la configuration applicative partagée [`Penpot_Common`](./Penpot_Common) pour déployer [Penpot](https://penpot.app/) — un outil open source de design et de prototypage — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Penpot GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable se comporte de façon identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **propres à Penpot** sont décrites en détail ici.

> **Remarque :** les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`. Consultez les sections correspondantes du [guide de configuration App_GKE](./App_GKE.md) pour la documentation complète.

| Domaine de configuration | Section de App GKE.md | Remarques propres à Penpot |
|---|---|---|
| Projet et identité | §2 IAM & Access Control | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Penpot ; voir [Groupe 2 : identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | Valeurs par défaut propres à Penpot pour `container_port`, `cpu_limit`, `memory_limit` et `timeout_seconds` ; voir [Groupe 3 : exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Configuration de l'application Penpot | *(propre à Penpot)* | `penpot_flags`, `jvm_max_heap`, `jvm_min_heap`, `public_uri` ; voir [Groupe 5 : configuration de l'application Penpot](#group-5-penpot-application-configuration). |
| Configuration SMTP | *(propre à Penpot)* | Variables SMTP de premier plan pour les e-mails d'invitation ; voir [Groupe 8 : configuration SMTP](#group-8-smtp-configuration). |
| Variables d'environnement et secrets | §3 Core Service Configuration | Un secret généré automatiquement (`PENPOT_SECRET_KEY`) ; voir [Groupe 7 : variables d'environnement et secrets](#group-7-environment-variables--secrets). |
| Réseau et règles réseau | §3.D Networking & Network Policies | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Initialization Jobs & CronJobs | Un job `db-init` par défaut (fourni par `Penpot Common`) crée la base de données et l'utilisateur ; Penpot exécute ensuite ses propres migrations de schéma au démarrage ; voir [Groupe 8 : jobs et tâches planifiées](#group-9-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Additional Services | Le frontend et l'exporter sont provisionnés automatiquement en tant que services supplémentaires ; voir [Relation entre Penpot GKE et App GKE](#how-penpot-gke-relates-to-app-gke). |
| Stockage — NFS | §3.C Storage (NFS / GCS / GCS Fuse) | `enable_nfs` vaut `true` par défaut ; requis lorsqu'aucun `redis_host` explicite n'est fourni ; voir [Groupe 10 : stockage et système de fichiers — NFS](#group-10-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Storage (NFS / GCS / GCS Fuse) | Bucket GCS `assets` (`gcs-<service-name>-assets`) provisionné automatiquement ; accessible via Workload Identity ADC ; voir [Groupe 11 : stockage et système de fichiers — GCS](#group-11-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Database (Cloud SQL) | **PostgreSQL 15 requis** ; voir [Groupe 12 : configuration de la base de données](#group-12-database-configuration). |
| Planification et rétention des sauvegardes | §3.B Database (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Initialization Jobs & CronJobs | Identique. |
| Observabilité et contrôles de santé | §3.A Compute (GKE Autopilot) | Les contrôles de santé ciblent `/api/health` ; voir [Groupe 14 : observabilité et santé](#group-14-observability--health). |
| WAF Cloud Armor | §4.A Cloud Armor WAF | Identique. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identique. |
| Binary Authorization | §4.C Binary Authorization | Identique. |
| VPC Service Controls | §4.D VPC Service Controls | Identique. |
| Secrets Store CSI Driver | §4.E Secrets Store CSI Driver | Toujours activé — aucune configuration requise. |
| Trafic et ingress | §5 Traffic & Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Static IP Reservation | `public_uri` doit être mis à jour pour correspondre au domaine personnalisé ; voir [Groupe 15 : domaine personnalisé et IP statique](#group-15-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Cloud Build Triggers | Identique. |
| Pipeline Cloud Deploy | §6.B Cloud Deploy Pipeline | Identique. |
| Mise en miroir des images | §6.C Image Mirroring | `enable_image_mirroring` vaut `true` par défaut ; les images Penpot sont hébergées sur Docker Hub. |
| Pod Disruption Budgets | §7.A Pod Disruption Budgets | `enable_pod_disruption_budget` vaut `false` par défaut ; voir [Groupe 15 : règles de fiabilité](#group-15-reliability-policies). |
| Contraintes de répartition topologique | §7.B Topology Spread Constraints | Identique. |
| Quotas de ressources | §7.C Resource Quotas | Identique. |
| Rotation automatique des mots de passe | §7.D Auto Password Rotation | Voir [Groupe 12 : configuration de la base de données](#group-12-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` vaut `true` par défaut — Redis est **obligatoire** pour le pub/sub WebSocket ; voir [Groupe 16 : Redis (pub/sub WebSocket)](#group-16-redis-websocket-pubsub). |
| Import de sauvegarde | §8.B Backup Import | Voir [Groupe 6 : sauvegarde et maintenance](#group-6-backup--maintenance). |
| Service mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Multi-Cluster Services | §8.D Multi-Cluster Services (MCS) | `enable_multi_cluster_service` existe sur `App_GKE` mais n'est **pas** reproduite sur `Penpot_GKE` — MCS n'est pas configurable pour ce module. |

---

## Relation entre Penpot GKE et App GKE {#how-penpot-gke-relates-to-app-gke}

`Penpot GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Penpot Common` qui fournit les valeurs par défaut et la configuration applicative propres à Penpot. Les principaux effets sont les suivants :

1. **PostgreSQL 15 est requis.** Le backend Clojure de Penpot ne prend en charge que PostgreSQL. `Penpot Common` code en dur `database_type = "POSTGRES_15"` dans la `config` qu'il assemble — ce choix n'est piloté par aucune variable. `Penpot GKE` déclare bien sa propre variable `database_type` (valeur par défaut `"POSTGRES"`, selon la convention de `App_GKE`), mais elle n'est jamais transmise à `Penpot Common` ni à la configuration appliquée de `App_GKE` ; la définir n'a donc aucun effet.
2. **Trois services coordonnés sont déployés.** Penpot GKE déploie trois services Kubernetes distincts qui fonctionnent de concert :
   - **Backend** (charge de travail principale, port 6060) : l'API HTTP Clojure, le serveur WebSocket et l'ordonnanceur de jobs. Géré par App GKE comme déploiement principal.
   - **Frontend** (service supplémentaire, port de Service `80` → port de conteneur `8080`, car le nginx du frontend Penpot n'écoute pas sur le port 80) : un conteneur nginx qui sert la SPA ClojureScript/React. Il relaie les requêtes `/api` et `/ws` vers le backend via l'adresse de service interne au cluster.
   - **Exporter** (service supplémentaire, port 6061) : un navigateur headless Node.js + Puppeteer/Chromium qui effectue le rendu des pages de design pour l'export en PDF, PNG et SVG. Chromium navigue vers le service frontend pour effectuer le rendu des pages avant la capture.
3. **L'URI de l'exporter est injectée automatiquement.** `PENPOT_EXPORTER_URI` est définie au moment du déploiement sur l'URL interne au cluster du service exporter (`http://<service-name>-exporter.<namespace>.svc.cluster.local:6061`). Vous n'avez pas besoin de la configurer manuellement.
4. **Redis est obligatoire.** Tous les réplicas du backend Penpot partagent l'état des événements WebSocket via le pub/sub Redis (base 0). Sans Redis, la collaboration de design multi-utilisateur en temps réel est immédiatement cassée dès que plusieurs réplicas du backend tournent — les utilisateurs connectés à des réplicas différents ne voient pas les modifications des autres.
5. **Un bucket GCS `assets` est provisionné automatiquement.** `Penpot Common` fournit un bucket (`name_suffix = "assets"`, nom complet `gcs-<service-name>-assets`) pour les ressources de design (polices, images, miniatures, fichiers téléversés). Le backend lit et écrit dans ce bucket via Workload Identity ADC — aucun identifiant explicite n'est requis.
6. **`public_uri` est défini automatiquement sur l'URL de service prévue.** L'URL prévue est transmise à `Penpot Common` en tant que `public_uri`. Pour les déploiements avec domaine personnalisé, vous devez remplacer `public_uri` via `environment_variables` afin qu'elle corresponde à l'URL utilisée par les utilisateurs, de sorte que la SPA du frontend, les liens du backend et la navigation de l'exporter utilisent tous la bonne URL de base.
7. **Un secret applicatif est généré automatiquement.** `Penpot Common` crée `PENPOT_SECRET_KEY` — une valeur aléatoire de 64 caractères stockée dans Secret Manager sous le nom `secret-<prefix>-penpot-key` — la clé de signature JWT partagée utilisée à la fois par le backend et l'exporter. Elle est injectée comme variable d'environnement secrète via `module_secret_env_vars = module.penpot_app.secret_ids`, et l'exporter la référence en plus directement (`secret_env_vars = { PENPOT_SECRET_KEY = "PENPOT_SECRET_KEY" }`), car son schéma de configuration exige `:secret-key`, faute de quoi le conteneur s'arrête au démarrage. Le secret `DB_PASSWORD` est provisionné automatiquement par `App GKE`.
8. **Dimensionnement du heap JVM.** Le backend Clojure s'exécute sur la JVM. `jvm_max_heap` et `jvm_min_heap` contrôlent l'allocation du heap JVM et doivent être dimensionnées par rapport à `memory_limit`.
9. **`timeout_seconds` vaut 3600 secondes par défaut.** Les opérations d'export volumineuses (PDF/PNG de designs complexes) peuvent prendre plusieurs minutes. Le délai maximal de 3600 secondes permet de traiter même les très gros jobs d'export.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#2-iam--access-control).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(obligatoire)* | ID du projet GCP. |
| `region` | `"us-central1"` | Région GCP de déploiement des ressources. Utilisée comme valeur de repli lorsque la découverte réseau ne parvient pas à déterminer la région à partir des sous-réseaux VPC existants. Sert aussi d'emplacement pour le bucket GCS `assets`. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot) pour leurs descriptions.

**Valeurs par défaut propres à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"penpot"` | `"gkeapp"` | Sert de nom de base pour toutes les ressources GCP et Kubernetes. Le service frontend est nommé `<application_name>-frontend` et l'exporter `<application_name>-exporter`. **Ne pas modifier après le déploiement.** |
| `display_name` | `"Penpot - Open Source Design Tool"` | `"App GKE Application"` | Affiché dans l'interface de la plateforme et les tableaux de bord. Peut être modifié librement. |
| `description` | `"Penpot - Open-source design and prototyping tool for teams"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"latest"` | `"1.0.0"` | Tag de version appliqué aux **trois** images de conteneur Penpot (backend, frontend, exporter). Les trois images doivent utiliser le même tag de version pour garantir la compatibilité de l'API — ne mélangez pas les versions entre services. Épinglez une version précise (par ex. `"2.3.0"`) en production. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de façon identique à `App_GKE`. Voir [App_GKE Groupe 3](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut et comportement propres à Penpot :**

> **Remarque :** les variables de mise à l'échelle (`min_instance_count`, `max_instance_count`) et de ressources (`cpu_limit`, `memory_limit`) s'appliquent au service **backend**. Les services frontend et exporter ont leurs propres limites de ressources, définies en interne :
> - Frontend : `1000m` de CPU, `512Mi` de mémoire, mise à l'échelle selon `min_instance_count` / `max_instance_count`
> - Exporter : `2000m` de CPU, `2Gi` de mémoire, 1 réplica au minimum, mise à l'échelle jusqu'à `max_instance_count`

| Variable | Valeur par défaut Penpot GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `6060` | `8080` | Port HTTP + WebSocket du backend Clojure de Penpot. Ne pas modifier — la configuration du proxy nginx du frontend est codée en dur pour se connecter au backend sur ce port via l'adresse de service interne au cluster. |
| `cpu_limit` | `"2000m"` | `"1000m"` | 2 vCPU constituent le minimum pour le backend JVM sous charge collaborative. La JVM elle-même nécessite environ 500m au repos ; les connexions WebSocket simultanées et les opérations sur les fichiers de design exigent une marge supplémentaire. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | La JVM a besoin de plus de marge mémoire que les applications Node.js ou Python classiques. Avec `jvm_max_heap = "1g"`, le conteneur a besoin d'au moins 1.5 Gi pour absorber la surcharge de la JVM, le système d'exploitation et les caches de fichiers en mémoire de Penpot. 2 Gi est le minimum recommandé ; passez à 4 Gi pour les grandes équipes ou les fichiers de design complexes. |
| `min_instance_count` | `1` | `1` | Au moins un pod tourne en permanence. La mise à l'échelle à zéro provoque des déconnexions WebSocket pour les collaborateurs actifs et un délai de démarrage à froid de la JVM de 60 à 120 secondes. |
| `max_instance_count` | `3` | `3` | Nombre maximal de réplicas du backend. Tous les réplicas partagent l'état des designs via Redis — la mise à l'échelle horizontale est sûre. |
| `timeout_seconds` | `3600` | `300` | Délai maximal permettant de traiter les opérations d'export volumineuses (PDF/PNG de designs complexes de plusieurs pages). La valeur maximale autorisée est de 3600 secondes. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy est requis. Le backend Penpot se connecte à PostgreSQL via le socket Unix de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | `true` | Les images Penpot sont hébergées sur Docker Hub. La mise en miroir vers Artifact Registry évite les limites de débit et satisfait les exigences de Binary Authorization. Appliquée à l'image du backend ; les images du frontend et de l'exporter sont également mises en miroir automatiquement. |

Les autres variables d'exécution (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `container_resources`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE Groupe 3](./App_GKE.md#a-compute-gke-autopilot).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#4-advanced-security), [App_GKE](./App_GKE.md#5-traffic--ingress) et [App_GKE](./App_GKE.md#d-networking--network-policies).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés à accéder via IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google autorisés à accéder via IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration d'IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration d'IAP. |
| `enable_custom_domain` | `true` | Configure l'Ingress/la Gateway pour le routage d'un domaine personnalisé avec des certificats SSL gérés. Activé par défaut — une Gateway dotée d'une IP statique est provisionnée automatiquement. Lorsque vous utilisez un domaine personnalisé, mettez à jour `PENPOT_PUBLIC_URI` dans `environment_variables` pour qu'elle corresponde au domaine. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par ex. `["penpot.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. Recommandé lorsque vous utilisez un domaine personnalisé. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; généré automatiquement s'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. Le tag `nfsserver` est requis pour la connectivité NFS. |
| `enable_cloud_armor` | `false` | Active une politique de sécurité WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées à travers Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à associer. |
| `enable_vpc_sc` | `false` | Active l'application d'un périmètre VPC Service Controls. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge. |

---

## Groupe 5 : Configuration de l'application Penpot {#group-5-penpot-application-configuration}

Ces variables sont propres à Penpot et sont transmises directement à `Penpot Common`. Elles contrôlent le comportement d'exécution du backend Clojure et l'allocation des ressources de la JVM.

| Variable | Valeur par défaut | Options / format | Description et implications |
|---|---|---|---|
| `penpot_flags` | `"enable-registration enable-login disable-demo-users"` | Chaînes de flags séparées par des espaces | Flags de fonctionnalités Penpot, séparés par des espaces, qui déterminent les fonctionnalités et méthodes d'authentification actives. La même chaîne de flags est transmise au backend et au conteneur nginx du frontend, afin que le rendu des fonctionnalités de la SPA corresponde aux capacités du backend. Flags principaux : `enable-registration` (autoriser l'inscription libre), `disable-registration` (exiger des invitations créées par un administrateur), `enable-login-with-password` (connexion standard par nom d'utilisateur et mot de passe), `disable-demo-users` (désactiver le compte de démonstration accessible sans inscription), `enable-oidc` (activer un fournisseur OIDC générique), `enable-google-login`, `enable-github-login`. Les flags sont appliqués au démarrage — les modifier nécessite un redémarrage du pod. |
| `jvm_max_heap` | `"1g"` | Taille de heap JVM (par ex. `"1g"`, `"2g"`, `"512m"`) | Taille maximale du heap JVM pour le backend Penpot. Doit être fixée à environ la moitié de `memory_limit` pour laisser de la marge à la surcharge de la JVM, aux buffers hors heap de Netty/HttpKit et au système d'exploitation. Pour un conteneur de 2 Gi, `"1g"` convient. Pour un conteneur de 4 Gi, utilisez `"2g"`. Fixer `jvm_max_heap` près de `memory_limit` expose à des arrêts OOM dus à la croissance de la mémoire hors heap. |
| `jvm_min_heap` | `"512m"` | Taille de heap JVM | Taille initiale du heap JVM. Détermine la quantité de heap que la JVM réserve au démarrage. Un `jvm_min_heap` plus élevé réduit la fréquence des pauses d'extension du heap, mais augmente l'empreinte mémoire de base du pod. Pour les déploiements de production, fixer `jvm_min_heap` égal à `jvm_max_heap` élimine toutes les pauses de redimensionnement du heap, au prix d'une réservation mémoire constante plus élevée. |

### Valider les paramètres du groupe 5 {#validating-group-5-settings}

**Console Google Cloud :**
- **GKE Workloads :** accédez à **Kubernetes Engine → Workloads**, sélectionnez le déploiement du backend Penpot et vérifiez que les variables d'environnement incluent `PENPOT_FLAGS`, `JVM_MAX_HEAP` et `JVM_MIN_HEAP`.

**gcloud CLI / kubectl :**
```bash
# Confirm Penpot feature flags are set in the backend pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep PENPOT_FLAGS

# Check JVM heap settings
kubectl exec -n NAMESPACE POD_NAME -- env | grep JVM

# View backend startup logs to confirm JVM initialisation and flag parsing
kubectl logs -n NAMESPACE POD_NAME --since=5m | grep -i "flags\|heap\|migration\|started"
```

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut propres à Penpot :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez selon votre objectif de point de reprise (RPO). |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez-la pour les déploiements de production ; les fichiers de design et l'historique des projets sont irremplaçables. |

**Import de sauvegarde** — Penpot GKE permet d'importer une sauvegarde de base de données existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'import ponctuel pendant le déploiement pour restaurer la sauvegarde indiquée par `backup_uri`. |
| `backup_source` | `"gcs"` | Système source du fichier de sauvegarde. `"gcs"` importe depuis une URI Cloud Storage ; `"gdrive"` importe depuis un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complète (par ex. `"gs://my-bucket/backups/penpot.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom d'un fichier de sauvegarde déjà déposé dans le bucket de sauvegardes géré par le module. Utilisé uniquement lorsque `enable_backup_import = true`. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

> **Remarque :** un import de sauvegarde restaure uniquement la base de données PostgreSQL. Les fichiers de ressources de design stockés dans le bucket GCS `assets` (`gcs-<service-name>-assets`) doivent être migrés séparément — copiez-les dans le bucket assets une fois la restauration de la base de données terminée.

---

## Groupe 7 : Variables d'environnement et secrets {#group-7-environment-variables--secrets}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#3-core-service-configuration).

**Un secret applicatif est généré automatiquement.** `Penpot Common` crée `PENPOT_SECRET_KEY` (une valeur aléatoire de 64 caractères stockée dans Secret Manager sous le nom `secret-<prefix>-penpot-key`) — la clé de signature JWT partagée utilisée par le backend et l'exporter. Elle est exposée via la sortie `secret_ids` et câblée en tant que `module_secret_env_vars` ; l'exporter la référence en plus directement, car son schéma de configuration exige `:secret-key`. Penpot ne crée par ailleurs ni mot de passe administrateur ni autre secret applicatif. Le mot de passe de la base de données (`DB_PASSWORD`) est provisionné automatiquement par `App GKE`.

**`PENPOT_PUBLIC_URI` est injectée automatiquement** par le module à partir de l'URL de service prévue. Pour la remplacer (par exemple lorsque vous utilisez un domaine personnalisé), définissez-la explicitement dans `environment_variables` :

```
environment_variables = {
  PENPOT_PUBLIC_URI = "https://penpot.example.com"
}
```

**`PENPOT_EXPORTER_URI` est injectée automatiquement** par le bloc local de `penpot.tf`. Elle est définie sur l'URL interne au cluster du service exporter. Ne la remplacez pas, sauf si vous déployez un exporter personnalisé à une autre adresse.

Les variables standard (`environment_variables`, `secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent comme décrit dans [App_GKE](./App_GKE.md#3-core-service-configuration).

---

## Groupe 8 : Configuration SMTP {#group-8-smtp-configuration}

Penpot utilise SMTP pour les e-mails d'invitation (inviter des membres d'équipe dans une organisation Penpot) et les notifications de réinitialisation de mot de passe. SMTP est facultatif — sans lui, Penpot reste entièrement fonctionnel pour les utilisateurs invités et la connexion, mais les e-mails d'invitation et de réinitialisation de mot de passe ne peuvent pas être envoyés.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_enabled` | `false` | Active l'envoi d'e-mails SMTP. Lorsque `false`, tous les e-mails d'invitation et de notification sont ignorés sans avertissement. |
| `smtp_from` | `""` | Adresse e-mail de l'expéditeur affichée dans les e-mails sortants (par ex. `"noreply@example.com"`). |
| `smtp_reply_to` | `""` | Adresse de réponse des e-mails sortants. Laissez vide pour utiliser `smtp_from`. |
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP (par ex. `"smtp.mailgun.org"`, `"smtp.sendgrid.net"`). Obligatoire lorsque `smtp_enabled = true`. |
| `smtp_port` | `587` | Port du serveur SMTP. `587` est le port STARTTLS standard. Utilisez `465` pour SSL/TLS, `25` pour une connexion non chiffrée (déconseillé). |
| `smtp_username` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_use_tls` | `true` | Active la négociation STARTTLS. Recommandé pour le port 587. |
| `smtp_use_ssl` | `false` | Active SSL/TLS direct. À utiliser pour le port 465. Mutuellement exclusif avec `smtp_use_tls`. |

> **Mot de passe SMTP :** le mot de passe SMTP n'est pas une variable de premier niveau. Ajoutez-le via `secret_environment_variables` pour le tenir hors de l'état Terraform :
> ```
> secret_environment_variables = {
>   PENPOT_SMTP_PASSWORD = "your-smtp-password-secret-name"
> }
> ```

### Valider les paramètres SMTP {#validating-smtp-settings}

**gcloud CLI / kubectl :**
```bash
# Confirm SMTP environment variables are set in the backend pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i smtp

# Check backend logs for SMTP configuration confirmation
kubectl logs -n NAMESPACE POD_NAME | grep -i "smtp\|email\|mail"
```

---

## Groupe 9 : Jobs et tâches planifiées {#group-9-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs).

**Job `db-init` par défaut :** lorsque `initialization_jobs` est vide (valeur par défaut), `Penpot Common` fournit un Job Kubernetes `db-init` (image `postgres:15-alpine`, script `scripts/db-init.sh`, `execute_on_apply = true`) qui crée la base de données PostgreSQL et l'utilisateur applicatif. L'application Clojure de Penpot gère ensuite en interne la création et la migration du schéma au démarrage du backend, avant d'accepter les connexions HTTP ou WebSocket. Fournir une liste `initialization_jobs` non vide remplace le job par défaut.

**CronJobs :**

La variable `cron_jobs` est disponible pour des tâches planifiées personnalisées, comme des jobs d'export par lots ou des traitements analytiques. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs) pour la documentation complète du schéma.

> **Remarque :** les CronJobs GKE utilisent les champs `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds` et `suspend`. Les champs de type Cloud Run (`parallelism`, `paused`, `max_retries`, `task_count`) ne sont pas disponibles.

**Services supplémentaires :** le frontend et l'exporter sont provisionnés automatiquement — vous n'avez pas besoin de les ajouter via `additional_services`. La variable `additional_services` est disponible pour tout service supplémentaire au-delà des trois standard (par exemple un processeur de webhooks personnalisé ou un service sidecar d'export de métriques).

---

## Groupe 10 : Stockage et système de fichiers — NFS {#group-10-storage--filesystem--nfs}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Valeurs par défaut propres à Penpot :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_nfs` | `true` | Le stockage NFS est activé par défaut. Lorsque `enable_redis = true` et qu'aucun `redis_host` externe n'est fourni, le module utilise l'IP du serveur NFS comme hôte Redis. Si vous désactivez NFS, vous devez fournir un `redis_host` explicite — sans Redis, la collaboration en temps réel n'est pas disponible. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin de montage du volume NFS dans le conteneur. Penpot n'utilise pas directement NFS pour le stockage applicatif — dans ce module, NFS sert principalement à héberger le processus Redis utilisé pour le pub/sub WebSocket. |

---

## Groupe 11 : Stockage et système de fichiers — GCS {#group-11-storage--filesystem--gcs}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE Groupe 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

**Bucket provisionné automatiquement, propre à Penpot :**

`Penpot Common` provisionne automatiquement un bucket GCS (`name_suffix = "assets"`, nom complet `gcs-<service-name>-assets`) pour le stockage des ressources de design. Contrairement à Paperless-ngx (qui utilise GCS FUSE pour stocker les documents), le backend Clojure de Penpot accède à ce bucket **nativement via Workload Identity ADC** — aucun montage de volume GCS FUSE n'est requis. Le backend utilise le SDK Java GCS pour lire et écrire directement les ressources de design.

| Bucket | `name_suffix` | Méthode d'accès | Usage |
|---|---|---|---|
| Provisionné automatiquement | `assets` | Workload Identity ADC (SDK GCS) | Ressources de design : polices, images, miniatures, fichiers téléversés |

Les variables d'environnement suivantes sont injectées automatiquement par `Penpot Common` :
- `PENPOT_STORAGE_BACKEND=gcs` — indique à Penpot d'utiliser GCS comme backend de stockage des ressources
- `PENPOT_STORAGE_GCS_BUCKET_NAME` — définie sur le nom du bucket provisionné

Vous n'avez pas besoin de configurer manuellement des identifiants GCS. Le Kubernetes Service Account du backend est lié via Workload Identity à un compte de service GCP disposant des autorisations Storage Object Admin sur le bucket assets.

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` se comportent comme décrit dans [App_GKE Groupe 9](./App_GKE.md#c-storage-nfs--gcs--gcs-fuse).

---

## Groupe 12 : Configuration de la base de données {#group-12-database-configuration}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#b-database-cloud-sql).

**Valeurs par défaut et restrictions propres à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `db_name` | `"penpot"` | `"gkeappdb"` | Nom de la base de données PostgreSQL créée pour Penpot. **Immuable après le déploiement** — modifier cette valeur recrée la base de données et détruit l'ensemble des projets, fichiers de design et données d'équipe de Penpot. |
| `db_user` | `"penpot"` | `"gkeappuser"` | Utilisateur PostgreSQL de Penpot. **Immuable après le déploiement.** |
| `database_password_length` | `32` | `32` | Longueur du mot de passe de base de données généré automatiquement. Plage valide : 16 à 64 caractères. |

> **Important :** Penpot exige PostgreSQL. La variable `database_type` déclarée sur `Penpot_GKE` n'existe que pour respecter la convention de reproduction des variables du socle (valeur par défaut `"POSTGRES"`) — elle n'est jamais transmise à `Penpot Common` ni à `App_GKE` ; la définir n'a donc **aucun effet**. Le moteur de base de données réellement provisionné est toujours `POSTGRES_15`, codé en dur dans `Penpot Common`.

**Découverte de l'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou créer une instance intégrée. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement y est ajouté. |

**Rotation automatique du mot de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job automatisé de rotation du mot de passe de la base de données. Lorsque `true`, le mot de passe est renouvelé selon la planification définie par `secret_rotation_period`, et les pods GKE sont redémarrés pour récupérer le nouvel identifiant. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage des pods. |

---

## Groupe 13 : Scripts SQL personnalisés {#group-13-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#e-initialization-jobs--cronjobs).

Variables disponibles : `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

---

## Groupe 14 : Observabilité et santé {#group-14-observability--health}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut propres à Penpot :**

Le backend Clojure de Penpot exécute l'initialisation de la JVM et les migrations PostgreSQL au démarrage. Le premier démarrage après un nouveau déploiement peut prendre 60 à 120 secondes avant que le backend n'accepte les connexions HTTP.

### Routage des sondes de santé {#health-probe-routing}

`Penpot GKE` expose **deux jeux parallèles** de variables de sonde, qui configurent les sondes Kubernetes par des chemins de routage différents :

| Jeu de variables | Transmis à | Configure |
|---|---|---|
| `startup_probe`, `liveness_probe` | Sous-module `Penpot Common` | La spécification de sonde Kubernetes du conteneur applicatif (`initialDelaySeconds`, `path`, `failureThreshold`, etc.) |
| `startup_probe_config`, `health_check_config` | `App GKE` directement | La configuration de sonde standard d'App GKE, utilisée pour les contrôles de santé de l'équilibreur de charge et les sondes d'infrastructure GKE |

Il s'agit de chemins parallèles, et non d'alias. Modifier `startup_probe` n'affecte pas `startup_probe_config`, et inversement.

**Sonde de démarrage** (`startup_probe` → `Penpot Common`) :

| Champ | Valeur par défaut Penpot | Remarques |
|---|---|---|
| `type` | `"TCP"` | Sonde TCP sur le port du backend (6060). Délibérément **pas** une sonde HTTP sur `/api/health` — le backend Penpot n'a pas de point de terminaison `/api/health` (ce chemin renvoie 404 ; le vrai est `/readyz`), si bien qu'une sonde HTTP ferait redémarrer en boucle un backend sain. |
| `path` | `"/api/health"` | Présent dans l'objet mais ignoré pour une sonde TCP. |
| `initial_delay_seconds` | `30` | Laisse 30 secondes avant la première tentative de sonde. La JVM démarre rapidement ; le délai initial absorbe le temps de migration du schéma. |
| `timeout_seconds` | `10` | Délai d'expiration de chaque tentative de sonde. |
| `period_seconds` | `10` | Intervalle entre les sondes. |
| `failure_threshold` | `30` | Jusqu'à 300 secondes (30 × 10s) de marge au démarrage avant le redémarrage du pod. |

**Sonde de vivacité** (`liveness_probe` → `Penpot Common`) :

| Champ | Valeur par défaut Penpot | Remarques |
|---|---|---|
| `type` | `"TCP"` | Sonde TCP sur le port 6060. Délibérément **pas** une sonde HTTP sur `/api/health` (ce chemin renvoie 404 sur le backend Penpot, ce qui ferait redémarrer en boucle un pod sain). |
| `path` | `"/api/health"` | Présent dans l'objet mais ignoré pour une sonde TCP. |
| `initial_delay_seconds` | `60` | Laisse au backend un délai supplémentaire pour se stabiliser avant le début des contrôles de vivacité. |
| `period_seconds` | `30` | Moins fréquente que la sonde de démarrage — adaptée à un service stable en fonctionnement. |
| `failure_threshold` | `3` | Trois échecs consécutifs déclenchent le redémarrage du pod. |

**Sondes standard d'App GKE** (`startup_probe_config`, `health_check_config` → `App GKE`) :

| Variable | Valeur par défaut Penpot | Remarques |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, type = "TCP", timeout_seconds = 240, period_seconds = 240, failure_threshold = 1 }` | Sonde TCP sur `container_port` (6060). Autorise jusqu'à 240 secondes pour le démarrage. |
| `health_check_config` | `{ enabled = true, type = "HTTP", path = "/api/health" }` | Requête HTTP GET sur `/api/health`. Le point de terminaison de santé dédié de Penpot. |

**`uptime_check_config` :** vaut par défaut `{ enabled = false, path = "/api/health" }` — les tests de disponibilité sont désactivés par défaut. Activez-les explicitement pour la surveillance en production. Si le backend Penpot n'est pas accessible publiquement (par ex. derrière IAP), les tests de disponibilité doivent utiliser un point de terminaison joignable par Google ou être configurés via une supervision interne au VPC.

### Valider les sondes de santé {#validating-health-probes}

**gcloud CLI / kubectl :**
```bash
# Check startup probe status from pod events
kubectl describe pod -n NAMESPACE POD_NAME | grep -A5 "Startup Probe"

# Manually test the health endpoint from inside the pod
kubectl exec -n NAMESPACE POD_NAME -- \
  wget -qO- http://localhost:6060/api/health

# Check the frontend service health
kubectl exec -n NAMESPACE FRONTEND_POD_NAME -- \
  wget -qO- http://localhost:80/
```

---

## Groupe 15 : Règles de fiabilité {#group-15-reliability-policies}

Ces variables se comportent de façon identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#7-reliability--scheduling).

**Valeurs par défaut propres à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Remarques |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Le PDB est désactivé par défaut. Activez-le pour les déploiements de production — sans PDB, une maintenance de nœud peut arrêter simultanément tous les réplicas du backend, déconnecter tous les collaborateurs actifs et potentiellement corrompre les modifications de design en cours. |
| `pdb_min_available` | `1` | Au moins un pod backend doit rester disponible pendant les interruptions volontaires. Nécessite au moins 2 réplicas (`min_instance_count >= 2`) pour être efficace. |

Variables disponibles : `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Groupe 15 : Domaine personnalisé et IP statique {#group-15-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#5-traffic--ingress).

> **`public_uri` et domaines personnalisés :** Penpot doit connaître son URL publique au démarrage. `PENPOT_PUBLIC_URI` est injectée automatiquement à partir de l'URL de service prévue. Lorsque vous utilisez un domaine personnalisé, définissez explicitement `PENPOT_PUBLIC_URI` via `environment_variables` pour qu'elle corresponde au domaine indiqué dans `application_domains`. Penpot utilise `public_uri` pour :
> - Générer les liens d'invitation envoyés dans les notifications par e-mail
> - Configurer l'URL de base de l'API backend utilisée par la SPA du frontend
> - Fournir la bonne URL au Chromium headless de l'exporter pour le rendu des pages
>
> Une `public_uri` incorrecte casse les e-mails d'invitation, le rendu des exports et toutes les URL absolues intégrées aux fichiers de design.

---

## Groupe 16 : Redis (pub/sub WebSocket) {#group-16-redis-websocket-pubsub}

Ces variables configurent l'intégration Redis de Penpot. La prise en charge de l'infrastructure Redis sous-jacente est fournie par `App_GKE` (voir [App_GKE](./App_GKE.md#a-redis--memorystore)). Redis est **obligatoire** pour Penpot — c'est le bus d'événements pub/sub WebSocket qui synchronise en temps réel les modifications de design entre tous les utilisateurs connectés, sur tous les réplicas du backend.

> **Remarque :** dans `Penpot GKE`, les variables Redis se trouvent dans le **groupe 21**.

| Variable | Valeur par défaut | Options / format | Description et implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Active Redis comme bus d'événements pub/sub WebSocket de Penpot. **Doit rester à `true` pour que la collaboration en temps réel fonctionne.** Lorsque `true` et que `redis_host` est vide, le module utilise par défaut l'IP du serveur NFS comme hôte Redis. Sans Redis, tout déploiement comptant plus d'un réplica du backend présente un comportement de split-brain — les utilisateurs connectés à des réplicas différents ne voient pas les modifications de design des autres. Avec un seul réplica, le bus d'événements en processus de Penpot est utilisé, mais il ne survit à aucun redémarrage de pod ni à aucune mise à jour progressive. |
| `redis_host` | `""` *(par défaut, l'IP du serveur NFS)* | Nom d'hôte ou adresse IP | Nom d'hôte ou adresse IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS découverte automatiquement. Remplacez-la par une IP ou un nom d'hôte explicite lorsque vous utilisez une instance Redis dédiée — comme Google Cloud Memorystore for Redis — pour une disponibilité et un débit supérieurs. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Numéro de port sous forme de chaîne | Port TCP sur lequel écoute le serveur Redis. La valeur par défaut `6379` est le port Redis standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification du serveur Redis. Laissez vide si l'instance Redis ne requiert pas d'authentification. Pour Google Cloud Memorystore avec AUTH activé, indiquez la chaîne AUTH de l'instance. Cette valeur est traitée comme sensible. |

### Valider les paramètres Redis {#validating-redis-settings}

**Console Google Cloud :**
- **Instance Memorystore (si utilisée) :** accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et l'état d'AUTH.
- **Environnement des pods GKE :** accédez à **Kubernetes Engine → Workloads**, sélectionnez le déploiement du backend Penpot et vérifiez la présence de `PENPOT_REDIS_URI` dans les variables d'environnement du pod.

**gcloud CLI / kubectl :**
```bash
# List Memorystore Redis instances in the project (if using Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm the Redis URI is set in the Penpot backend pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep PENPOT_REDIS

# Test Redis connectivity from inside the Penpot backend pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379

# Check Penpot backend logs for Redis connection confirmation
kubectl logs -n NAMESPACE POD_NAME | grep -i "redis\|connected\|pub/sub"
```

---

## Groupe 17 : Configuration du backend GKE {#group-17-gke-backend-configuration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

**Valeurs par défaut propres à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Remarques |
|---|---|---|
| `session_affinity` | `"ClientIP"` | Recommandé pour la stabilité des WebSocket. Avec `"None"`, les requêtes de mise à niveau WebSocket et les trames WebSocket suivantes peuvent être routées vers des réplicas différents du backend — ce qui peut interrompre les sessions de collaboration actives. `"ClientIP"` garantit que la connexion WebSocket d'un utilisateur atteint toujours le même pod backend. |
| `service_type` | `"LoadBalancer"` | Expose le backend Penpot via un équilibreur de charge Google Cloud. Le service frontend (`ingress = "INGRESS_TRAFFIC_ALL"`) est lui aussi exposé à l'extérieur et reçoit directement le trafic des navigateurs des utilisateurs. Le service exporter (`ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"`) est uniquement interne au cluster. |
| `termination_grace_period_seconds` | `60` | Laisse le temps aux sessions WebSocket et aux opérations d'export en cours de se terminer avant l'arrêt du pod. Envisagez de passer à 120 secondes ou plus pour les équipes qui utilisent fréquemment l'export PDF/PNG. |

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `network_name`, `prereq_subnet_cidr_override`. (`enable_multi_cluster_service` et `gke_cluster_selection_mode` existent sur `App_GKE` mais ne sont pas reproduites sur `Penpot_GKE`.)

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#a-compute-gke-autopilot).

Définir `stateful_pvc_enabled = true` sélectionne automatiquement `workload_type = "StatefulSet"`. Le stockage des ressources de design de Penpot repose sur GCS ; un PVC par pod n'est donc pas nécessaire pour la durabilité des données de design. Un StatefulSet avec PVC peut être utile pour conserver des dumps de heap JVM locaux ou des caches internes persistants de Penpot entre les redémarrages.

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez-la sur `true` pour activer un StatefulSet avec un PVC par pod. |
| `stateful_pvc_size` | `"10Gi"` | Taille initiale du PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin du conteneur où le PVC propre au pod est monté. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | StorageClass du PVC. |
| `stateful_headless_service` | `null` | Crée un service headless pour des identités DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `"OrderedReady"` ou `"Parallel"`. |
| `stateful_update_strategy` | `null` | `"RollingUpdate"` ou `"OnDelete"`. |
| `stateful_fs_group` | `null` | GID du fsGroup au niveau du pod dans le contexte de sécurité. |

---

## Sorties du module {#module-outputs}

`Penpot GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes principal (backend) |
| `service_cluster_ip` | ClusterIP interne au cluster du service Kubernetes principal |
| `frontend_url` | URL externe du frontend Penpot |
| `backend_cluster_url` | URL interne au cluster du service backend Penpot |
| `exporter_cluster_url` | URL interne au cluster du service exporter Penpot |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID de déploiement |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données de l'application |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés (y compris le bucket assets provisionné automatiquement) |
| `container_image` | Image de conteneur du backend utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est joignable et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — relancez l'apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation importante) — **Moyen** (fonctionnement dégradé ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | *(obligatoire)* | **Critique** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `enable_redis` | `true` | **Critique** | Redis est le bus pub/sub WebSocket. Le désactiver casse immédiatement la collaboration en temps réel dès qu'il y a plus d'un réplica du backend. Split-brain : les utilisateurs connectés à des réplicas différents ne voient pas les modifications de design des autres. |
| `redis_host` | `""` | **Élevé** | Se résout automatiquement en IP NFS. Si NFS est désactivé et qu'aucun hôte explicite n'est fourni, la connexion Redis de Penpot échoue au démarrage et le backend refuse de démarrer. |
| `enable_nfs` | `true` | **Élevé** | Requis lorsque `redis_host` est vide. Désactiver NFS sans fournir d'hôte Redis explicite fait échouer le démarrage du backend. |
| `container_port` | `6060` | **Critique** | Le backend Penpot écoute sur le port 6060. Modifier cette valeur sans qu'elle corresponde au port réellement lié par le conteneur fait échouer immédiatement toutes les sondes de santé et le proxy nginx du frontend. |
| `memory_limit` | `"2Gi"` | **Élevé** | La JVM a besoin d'une marge au-delà de `jvm_max_heap`. Fixer `memory_limit` égal à `jvm_max_heap` ne laisse aucune place à la mémoire hors heap (buffers Netty, surcharge du GC) et provoque des arrêts OOM. Fixez toujours `memory_limit` à au moins 1,5× `jvm_max_heap`. |
| `jvm_max_heap` | `"1g"` | **Élevé** | Fixer `jvm_max_heap` au-dessus de `memory_limit` provoque un arrêt OOM immédiat au démarrage de la JVM. Une valeur trop basse entraîne un ramasse-miettes excessif sous charge, ce qui réduit la réactivité et le débit des WebSocket. |
| `timeout_seconds` | `3600` | **Moyen** | Les exports PDF/PNG volumineux de designs complexes de plusieurs pages peuvent prendre plusieurs minutes. Descendre sous 120 secondes fait expirer les jobs d'export, qui renvoient une erreur à l'utilisateur. |
| `session_affinity` | `"ClientIP"` | **Élevé** | Sans affinité de session, les requêtes de mise à niveau WebSocket et leurs trames suivantes peuvent être routées vers des réplicas différents du backend. Les sessions de collaboration actives subissent des déconnexions et des pertes d'événements. |
| `penpot_flags` | `"enable-registration enable-login disable-demo-users"` | **Moyen** | Des flags incorrects peuvent désactiver complètement la connexion (par ex. en retirant `enable-login-with-password` sans configurer OIDC) ou ouvrir l'inscription au public de façon inattendue (en retirant `disable-registration` sur un déploiement exposé à Internet). |
| `public_uri` (via `environment_variables`) | *(prévue automatiquement)* | **Élevé** | Doit correspondre à l'URL réellement utilisée pour accéder à Penpot. Une `public_uri` incorrecte casse les liens des e-mails d'invitation, les redirections OIDC et la navigation du Chromium headless de l'exporter — les PDF et PNG exportés seront vides ou échoueront. |
| `db_name` | `"penpot"` | **Critique** | Immuable après le déploiement — la modifier recrée la base de données et détruit l'ensemble des projets, fichiers de design, composants et données d'équipe de Penpot. |
| `db_user` | `"penpot"` | **Critique** | Immuable après le déploiement — la modifier recrée l'utilisateur, invalide les identifiants et casse la connexion de Penpot à la base de données. |
| `application_version` | `"latest"` | **Élevé** | Les trois images de service (backend, frontend, exporter) doivent utiliser le même tag de version. Des versions différentes entre backend et frontend peuvent provoquer des incompatibilités d'API qui cassent l'interface web. Épinglez une version précise en production. |
| `backup_retention_days` | `7` | **Moyen** | Insuffisant pour les équipes de design soumises à des exigences strictes de récupération des données. Passez à 30 jours ou plus pour les déploiements de production comportant un travail de design actif impossible à recréer. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (propre à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'elles sont définies. Les entiers nus sont interprétés comme des octets et empêchent la planification de tous les pods — ce qui touche simultanément les trois services Penpot. |
| `enable_pod_disruption_budget` | `false` | **Élevé** | Sans PDB, une maintenance de nœud peut arrêter simultanément tous les réplicas du backend, déconnecter tous les collaborateurs actifs et potentiellement faire perdre des modifications de design non enregistrées. Activez-le pour tout déploiement de production comptant des utilisateurs actifs. |
| `smtp_enabled` | `false` | **Moyen** | Sans SMTP, les e-mails d'invitation ne peuvent pas être envoyés. L'intégration des membres de l'équipe nécessite alors de partager manuellement les identifiants de connexion ou d'utiliser un fournisseur OIDC. La réinitialisation du mot de passe est également indisponible sans SMTP. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Penpot sur GKE Autopilot](../labs/Penpot_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Penpot sur Google Cloud Run](Penpot_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée Penpot Common](Penpot_Common.md) — la configuration partagée par les deux cibles de déploiement.
