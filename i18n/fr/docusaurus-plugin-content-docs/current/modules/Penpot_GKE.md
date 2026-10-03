---
title: "Module Penpot GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Penpot sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Penpot_GKE.md @ df67eef sha256:b5d0f400acae -->

# Module Penpot GKE — Guide de configuration {#penpot-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Penpot_GKE.png" alt="Module Penpot GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit toutes les variables de configuration disponibles dans le module `Penpot_GKE`. `Penpot_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Penpot_Common`](./Penpot_Common) pour déployer [Penpot](https://penpot.app/) — un outil de conception et de prototypage open-source — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Penpot GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Penpot** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Penpot |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Valeurs par défaut spécifiques à Penpot ; voir [Groupe 2 : Identité de l'application](#group-2-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | Valeurs par défaut spécifiques à Penpot pour `container_port`, `cpu_limit`, `memory_limit` et `timeout_seconds` ; voir [Groupe 3 : Exécution et mise à l'échelle](#group-3-runtime--scaling). |
| Configuration de l'application Penpot | *(Spécifique à Penpot)* | `penpot_flags`, `jvm_max_heap`, `jvm_min_heap`, `public_uri` ; voir [Groupe 5 : Configuration de l'application Penpot](#group-5-penpot-application-configuration). |
| Configuration SMTP | *(Spécifique à Penpot)* | Variables SMTP de premier niveau pour les e-mails d'invitation ; voir [Groupe 8 : Configuration SMTP](#group-8-smtp-configuration). |
| Variables d'environnement et secrets | §3 Configuration du service principal | Un secret auto-généré (`PENPOT_SECRET_KEY`) ; voir [Groupe 7 : Variables d'environnement et secrets](#group-7-environment-variables--secrets). |
| Réseau et politiques réseau | §3.D Réseau et politiques réseau | Identique. |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Un job `db-init` par défaut (de `Penpot Common`) crée la base de données et l'utilisateur ; Penpot exécute ensuite ses propres migrations de schéma au démarrage ; voir [Groupe 9 : Jobs et tâches planifiées](#group-9-jobs--scheduled-tasks). |
| Services supplémentaires | §3.F Services supplémentaires | Le frontend et l'exportateur sont provisionnés automatiquement comme services supplémentaires ; voir [Comment Penpot GKE est lié à App GKE](#how-penpot-gke-relates-to-app-gke). |
| Stockage — NFS | §3.C Stockage (NFS / GCS / GCS Fuse) | `enable_nfs` utilise par défaut `true` ; requis lorsqu'aucun `redis_host` explicite n'est fourni ; voir [Groupe 10 : Stockage et système de fichiers — NFS](#group-10-storage--filesystem--nfs). |
| Stockage — GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Bucket GCS `assets` (`gcs-<service-name>-assets`) provisionné automatiquement ; accessible via Workload Identity ADC ; voir [Groupe 11 : Stockage et système de fichiers — GCS](#group-11-storage--filesystem--gcs). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **PostgreSQL 15 requis** ; voir [Groupe 12 : Configuration de la base de données](#group-12-database-configuration). |
| Plan de sauvegarde et rétention | §3.B Base de données (Cloud SQL) | Identique. |
| Scripts SQL personnalisés | §3.E Jobs d'initialisation et CronJobs | Identique. |
| Observabilité et vérifications de santé | §3.A Compute (GKE Autopilot) | Les vérifications de santé ciblent `/api/health` ; voir [Groupe 14 : Observabilité et santé](#group-14-observability--health). |
| Cloud Armor WAF | §4.A Cloud Armor WAF | Identique. |
| Identity-Aware Proxy | §4.B Identity-Aware Proxy (IAP) | Identique. |
| Autorisation binaire | §4.C Autorisation binaire | Identique. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |
| Pilote CSI du magasin de secrets | §4.E Pilote CSI du magasin de secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | §5 Trafic et Ingress | Identique. |
| CDN | §5.B CDN | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | `public_uri` doit être mis à jour pour correspondre au domaine personnalisé ; voir [Groupe 15 : Domaine personnalisé et IP statique](#group-15-custom-domain--static-ip). |
| Déclencheurs Cloud Build | §6.A Déclencheurs Cloud Build | Identique. |
| Pipeline Cloud Deploy | §6.B Pipeline Cloud Deploy | Identique. |
| Mise en miroir des images | §6.C Mise en miroir des images | `enable_image_mirroring` utilise par défaut `true` ; les images Penpot sont hébergées sur Docker Hub. |
| Budgets d'interruption de pod | §7.A Budgets d'interruption de pod | `enable_pod_disruption_budget` utilise par défaut `false` ; voir [Groupe 15 : Politiques de fiabilité](#group-15-reliability-policies). |
| Contraintes de répartition de topologie | §7.B Contraintes de répartition de topologie | Identique. |
| Quotas de ressources | §7.C Quotas de ressources | Identique. |
| Rotation automatique des mots de passe | §7.D Rotation automatique des mots de passe | Voir [Groupe 12 : Configuration de la base de données](#group-12-database-configuration). |
| Cache Redis | §8.A Redis / Memorystore | `enable_redis` utilise par défaut `true` — Redis est **obligatoire** pour le pub/sub WebSocket ; voir [Groupe 16 : Redis (Pub/Sub WebSocket)](#group-16-redis-websocket-pubsub). |
| Importation de sauvegarde | §8.B Importation de sauvegarde | Voir [Groupe 6 : Sauvegarde et maintenance](#group-6-backup--maintenance). |
| Service Mesh (ASM) | §8.C Service Mesh (ASM via Fleet) | Identique. |
| Services multi-clusters | §8.D Services multi-clusters (MCS) | `enable_multi_cluster_service` existe sur `App_GKE` mais n'est **pas** mis en miroir sur `Penpot_GKE` — MCS n'est pas configurable pour ce module. |

---

## Comment Penpot GKE est lié à App GKE {#how-penpot-gke-relates-to-app-gke}

`Penpot GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `Penpot Common` qui fournit des valeurs par défaut et une configuration d'application spécifiques à Penpot. Les principaux effets sont les suivants :

1.  **PostgreSQL 15 est requis.** Le backend Clojure de Penpot ne prend en charge que PostgreSQL. `Penpot Common` code en dur `database_type = "POSTGRES_15"` dans le `config` qu'il assemble — ce n'est pas piloté par une variable. `Penpot GKE` déclare sa propre variable `database_type` (par défaut `"POSTGRES"`, reflétant la convention de `App_GKE`), mais elle n'est jamais transmise à `Penpot Common` ou à la configuration appliquée de `App_GKE`, donc la définir n'a aucun effet.
2.  **Trois services coordonnés sont déployés.** Penpot GKE déploie trois services Kubernetes distincts fonctionnant de concert :
    -   **Backend** (charge de travail principale, port 6060) : L'API HTTP Clojure, le serveur WebSocket et l'ordonnanceur de jobs. Géré par App GKE comme déploiement principal.
    -   **Frontend** (service supplémentaire, port de service `80` → port de conteneur `8080`, le nginx frontend de Penpot n'écoute pas sur 80) : Un conteneur nginx servant le SPA ClojureScript/React. Proxy les requêtes `/api` et `/ws` vers le backend via son adresse de service interne au cluster.
    -   **Exportateur** (service supplémentaire, port 6061) : Un navigateur headless Node.js + Puppeteer/Chromium qui rend les pages de conception pour l'exportation vers PDF, PNG et SVG. Chromium navigue vers le service frontend pour rendre les pages avant la capture.
3.  **L'URI de l'exportateur est injecté automatiquement.** `PENPOT_EXPORTER_URI` est défini sur l'URL interne au cluster du service d'exportation (`http://<service-name>-exporter.<namespace>.svc.cluster.local:6061`) au moment du déploiement. Vous n'avez pas besoin de configurer cela manuellement.
4.  **Redis est obligatoire.** Toutes les répliques du backend Penpot partagent l'état des événements WebSocket via Redis pub/sub (base de données 0). Sans Redis, la collaboration de conception multijoueur en temps réel se brise immédiatement lorsque plus d'une réplique de backend est en cours d'exécution — les utilisateurs sur différentes répliques ne peuvent pas voir les changements des autres.
5.  **Un bucket GCS `assets` est provisionné automatiquement.** `Penpot Common` fournit un bucket (`name_suffix = "assets"`, nom complet `gcs-<service-name>-assets`) pour les actifs de conception (polices, images, vignettes, téléchargements de fichiers). Le backend lit et écrit dans ce bucket en utilisant Workload Identity ADC — aucune crédentiel explicite n'est requise.
6.  **`public_uri` est automatiquement défini sur l'URL de service prédite.** L'URL prédite est transmise à `Penpot Common` comme `public_uri`. Pour les déploiements de domaines personnalisés, vous devez remplacer `public_uri` via `environment_variables` pour qu'il corresponde à l'URL à laquelle les utilisateurs accèdent, afin que le SPA frontend, les liens backend et la navigation de l'exportateur utilisent tous la bonne URL de base.
7.  **Un secret au niveau de l'application est auto-généré.** `Penpot Common` crée `PENPOT_SECRET_KEY` — une valeur aléatoire de 64 caractères stockée dans Secret Manager sous le nom `secret-<prefix>-penpot-key` — la clé de signature JWT partagée utilisée par le backend et l'exportateur. Elle est injectée comme variable d'environnement secrète via `module_secret_env_vars = module.penpot_app.secret_ids`, et l'exportateur la référence en outre directement (`secret_env_vars = { PENPOT_SECRET_KEY = "PENPOT_SECRET_KEY" }`) car son schéma de configuration nécessite `:secret-key` ou le conteneur se termine au démarrage. Le secret `DB_PASSWORD` est provisionné automatiquement par `App GKE`.
8.  **Dimensionnement du tas JVM.** Le backend Clojure s'exécute sur la JVM. `jvm_max_heap` et `jvm_min_heap` contrôlent l'allocation du tas JVM et doivent être dimensionnés par rapport à `memory_limit`.
9.  **`timeout_seconds` utilise par défaut 3600 secondes.** Les opérations d'exportation importantes (PDF/PNG de conceptions complexes) peuvent prendre plusieurs minutes. Le délai d'attente maximal de 3600 secondes permet de gérer même les très grands jobs d'exportation.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(requis)* | ID du projet GCP. |
| `region` | `"us-central1"` | Région GCP pour le déploiement des ressources. Utilisé comme solution de repli lorsque la découverte réseau ne peut pas déterminer la région à partir des sous-réseaux VPC existants. Également utilisé comme emplacement pour le bucket GCS `assets`. |

---

## Groupe 2 : Identité de l'application {#group-2-application-identity}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-3--application-identity) pour les descriptions.

**Valeurs par défaut spécifiques à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"penpot"` | `"gkeapp"` | Utilisé comme nom de base pour toutes les ressources GCP et Kubernetes. Le service frontend est nommé `<application_name>-frontend` et l'exportateur `<application_name>-exporter`. **Ne pas modifier après le déploiement.** |
| `display_name` | `"Penpot - Open Source Design Tool"` | `"App GKE Application"` | Affiché dans l'interface utilisateur et les tableaux de bord de la plateforme. Peut être modifié librement. |
| `description` | `"Penpot - Open-source design and prototyping tool for teams"` | `"App GKE Custom Application…"` | Libellé descriptif. Peut être modifié librement. |
| `application_version` | `"latest"` | `"1.0.0"` | Tag de version appliqué aux **trois** images de conteneur Penpot (backend, frontend, exportateur). Les trois images doivent utiliser le même tag de version pour assurer la compatibilité de l'API — ne pas mélanger les versions entre les services. Épingler à une version spécifique (par exemple, `"2.3.0"`) pour la production. |

---

## Groupe 3 : Exécution et mise à l'échelle {#group-3-runtime--scaling}

La plupart des variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

**Valeurs par défaut et comportement spécifiques à Penpot :**

> **Note :** Les variables de mise à l'échelle (`min_instance_count`, `max_instance_count`) et les variables de ressources (`cpu_limit`, `memory_limit`) s'appliquent au service **backend**. Les services frontend et exportateur ont leurs propres limites de ressources définies en interne :
> - Frontend : `1000m` CPU, `512Mi` mémoire, s'adapte avec `min_instance_count` / `max_instance_count`
> - Exportateur : `2000m` CPU, `2Gi` mémoire, minimum 1 réplique, s'adapte à `max_instance_count`

| Variable | Valeur par défaut Penpot GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `6060` | `8080` | Port HTTP + WebSocket Clojure du backend Penpot. Ne pas modifier — la configuration du proxy nginx frontend est codée en dur pour se connecter au backend sur ce port via l'adresse de service interne au cluster. |
| `cpu_limit` | `"2000m"` | `"1000m"` | 2 vCPU est le minimum pour le backend JVM sous charge collaborative. La JVM elle-même nécessite environ 500m au repos ; les connexions WebSocket concurrentes et les opérations de fichiers de conception nécessitent une marge supplémentaire. |
| `memory_limit` | `"2Gi"` | `"512Mi"` | La JVM nécessite plus de mémoire que les applications Node.js ou Python typiques. Avec `jvm_max_heap = "1g"`, le conteneur a besoin d'au moins 1,5 Gi pour accueillir la surcharge JVM, l'OS et les caches de fichiers en mémoire de Penpot. 2 Gi est le minimum recommandé ; augmenter à 4 Gi pour les grandes équipes ou les fichiers de conception complexes. |
| `min_instance_count` | `1` | `1` | Toujours au moins un pod en cours d'exécution. La mise à l'échelle à zéro provoque des déconnexions WebSocket pour les collaborateurs actifs et un délai de démarrage à froid de la JVM de 60 à 120 secondes. |
| `max_instance_count` | `3` | `3` | Nombre maximal de répliques de backend. Toutes les répliques partagent l'état de conception via Redis — la mise à l'échelle horizontale est sûre. |
| `timeout_seconds` | `3600` | `300` | Délai d'attente maximal pour les opérations d'exportation importantes (PDF/PNG de conceptions complexes multipages). La valeur maximale autorisée est de 3600 secondes. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy est requis. Le backend Penpot se connecte à PostgreSQL via le socket Unix de l'Auth Proxy. |
| `enable_image_mirroring` | `true` | `true` | Les images Penpot sont hébergées sur Docker Hub. La mise en miroir vers Artifact Registry évite les limites de débit et satisfait aux exigences d'autorisation binaire. Appliqué à l'image du backend ; les images du frontend et de l'exportateur sont également mises en miroir automatiquement. |

Les variables d'exécution restantes (`deploy_application`, `container_image`, `container_build_config`, `enable_vertical_pod_autoscaling`, `container_protocol`, `container_resources`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE Groupe 4](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 4 : Accès et réseau {#group-4-access--networking}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy), [App_GKE](./App_GKE.md#group-19--access--networking) et [App_GKE](./App_GKE.md#group-21--cloud-armor--cdn).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active l'authentification Identity-Aware Proxy sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service autorisés à accéder à l'IAP. |
| `iap_authorized_groups` | `[]` | Groupes Google autorisés à accéder à l'IAP. |
| `iap_oauth_client_id` | `""` | ID client OAuth pour la configuration IAP. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth pour la configuration IAP. |
| `enable_custom_domain` | `true` | Configure Ingress/Gateway pour le routage de domaine personnalisé avec des certificats SSL gérés. Activé par défaut — une Gateway avec une IP statique est provisionnée automatiquement. Lors de l'utilisation d'un domaine personnalisé, mettez à jour `PENPOT_PUBLIC_URI` dans `environment_variables` pour qu'il corresponde au domaine. |
| `application_domains` | `[]` | Noms de domaine personnalisés (par exemple `["penpot.example.com"]`). |
| `reserve_static_ip` | `true` | Réserve une IP statique globale pour l'équilibreur de charge. Recommandé lors de l'utilisation d'un domaine personnalisé. |
| `static_ip_name` | `""` | Nom de l'IP réservée ; auto-généré si vide. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu appliqués aux nœuds du cluster GKE. Le tag `nfsserver` est requis pour la connectivité NFS. |
| `enable_cloud_armor` | `false` | Active une politique de sécurité Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR d'administration autorisées via Cloud Armor. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_vpc_sc` | `false` | Active l'application du périmètre des contrôles de service VPC. |
| `enable_cdn` | `false` | Active Cloud CDN sur l'équilibreur de charge. |

---

## Groupe 5 : Configuration de l'application Penpot {#group-5-penpot-application-configuration}

Ces variables sont spécifiques à Penpot et sont transmises directement à `Penpot Common`. Elles contrôlent le comportement d'exécution du backend Clojure et l'allocation des ressources JVM.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `penpot_flags` | `"enable-registration enable-login disable-demo-users"` | Chaînes de drapeaux séparées par des espaces | Drapeaux de fonctionnalités Penpot séparés par des espaces qui contrôlent les fonctionnalités et les méthodes d'authentification actives. La même chaîne de drapeaux est transmise au backend et au conteneur nginx frontend afin que le rendu des fonctionnalités du SPA corresponde aux capacités du backend. Drapeaux clés : `enable-registration` (autoriser l'auto-inscription), `disable-registration` (exiger des invitations créées par l'administrateur), `enable-login-with-password` (connexion standard nom d'utilisateur/mot de passe), `disable-demo-users` (désactiver le compte de démonstration accessible sans inscription), `enable-oidc` (activer le fournisseur OIDC générique), `enable-google-login`, `enable-github-login`. Les drapeaux sont appliqués au démarrage — leur modification nécessite un redémarrage du pod. |
| `jvm_max_heap` | `"1g"` | Chaîne de taille de tas JVM (par exemple `"1g"`, `"2g"`, `"512m"`) | Taille maximale du tas JVM pour le backend Penpot. Doit être définie à environ la moitié de `memory_limit` pour laisser de la marge pour la surcharge JVM, les tampons hors tas Netty/HttpKit et l'OS. Pour un conteneur de 2 Gi, `"1g"` est approprié. Pour un conteneur de 4 Gi, utilisez `"2g"`. Définir `jvm_max_heap` près de `memory_limit` risque des OOM kills dus à la croissance de la mémoire hors tas. |
| `jvm_min_heap` | `"512m"` | Chaîne de taille de tas JVM | Taille initiale du tas JVM. Contrôle la quantité de tas que la JVM réserve au démarrage. Un `jvm_min_heap` plus élevé réduit la fréquence des pauses d'expansion du tas JVM mais augmente l'empreinte mémoire de base du pod. Pour les déploiements de production, définir `jvm_min_heap` égal à `jvm_max_heap` élimine toutes les pauses de redimensionnement du tas au prix d'une réservation de mémoire constante plus élevée. |

### Validation des paramètres du groupe 5 {#validating-group-5-settings}

**Console Google Cloud :**
- **Charges de travail GKE :** Accédez à **Kubernetes Engine → Charges de travail**, sélectionnez le déploiement du backend Penpot et vérifiez que les variables d'environnement incluent `PENPOT_FLAGS`, `JVM_MAX_HEAP` et `JVM_MIN_HEAP`.

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

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-17--backup--maintenance).

**Valeurs par défaut spécifiques à Penpot :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajustez pour correspondre à votre objectif de point de récupération. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez pour les déploiements de production ; les fichiers de conception et l'historique du projet sont irremplaçables. |

**Importation de sauvegarde** — Penpot GKE prend en charge l'importation d'une sauvegarde de base de données existante lors du premier déploiement :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job d'importation unique pendant le déploiement pour restaurer la sauvegarde spécifiée par `backup_uri`. |
| `backup_source` | `"gcs"` | Système source pour le fichier de sauvegarde. `"gcs"` importe à partir d'une URI Cloud Storage ; `"gdrive"` importe à partir d'un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complète (par exemple `"gs://my-bucket/backups/penpot.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom de fichier d'une sauvegarde déjà placée dans le bucket de sauvegardes géré par le module. Utilisé uniquement lorsque `enable_backup_import = true`. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde. Valeurs prises en charge : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

> **Note :** Une importation de sauvegarde ne restaure que la base de données PostgreSQL. Les fichiers d'actifs de conception stockés dans le bucket GCS `assets` (`gcs-<service-name>-assets`) doivent être migrés séparément — copiez-les dans le bucket d'actifs une fois la restauration de la base de données terminée.

---

## Groupe 7 : Variables d'environnement et secrets {#group-7-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Un secret au niveau de l'application est auto-généré.** `Penpot Common` crée `PENPOT_SECRET_KEY` (une valeur aléatoire de 64 caractères stockée dans Secret Manager sous le nom `secret-<prefix>-penpot-key`) — la clé de signature JWT partagée utilisée par le backend et l'exportateur. Elle est exposée via la sortie `secret_ids` et câblée comme `module_secret_env_vars` ; l'exportateur la référence en outre directement car son schéma de configuration nécessite `:secret-key`. Penpot ne crée pas d'autres mots de passe d'administrateur ou d'autres secrets d'application. Le mot de passe de la base de données (`DB_PASSWORD`) est provisionné automatiquement par `App GKE`.

**`PENPOT_PUBLIC_URI` est injecté automatiquement** par le module en utilisant l'URL de service prédite. Pour le remplacer (par exemple, lors de l'utilisation d'un domaine personnalisé), définissez-le explicitement dans `environment_variables` :

```
environment_variables = {
  PENPOT_PUBLIC_URI = "https://penpot.example.com"
}
```

**`PENPOT_EXPORTER_URI` est injecté automatiquement** par le bloc local `penpot.tf`. Il est défini sur l'URL interne au cluster du service d'exportation. Ne le remplacez pas, sauf si vous déployez un exportateur personnalisé à une adresse différente.

Les variables standard (`environment_variables`, `secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay`, `manage_storage_kms_iam`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 8 : Configuration SMTP {#group-8-smtp-configuration}

Penpot utilise le SMTP pour les e-mails d'invitation (inviter des membres d'équipe à une organisation Penpot) et les notifications de réinitialisation de mot de passe. Le SMTP est facultatif — sans lui, Penpot fonctionne toujours pleinement pour les utilisateurs invités et la connexion, mais les e-mails d'invitation et les e-mails de réinitialisation de mot de passe ne peuvent pas être envoyés.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_enabled` | `false` | Active l'envoi d'e-mails SMTP. Lorsque `false`, tous les e-mails d'invitation et de notification sont silencieusement ignorés. |
| `smtp_from` | `""` | Adresse e-mail de l'expéditeur affichée dans les e-mails sortants (par exemple `"noreply@example.com"`). |
| `smtp_reply_to` | `""` | Adresse e-mail de réponse pour les e-mails sortants. Laissez vide pour utiliser `smtp_from`. |
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP (par exemple `"smtp.mailgun.org"`, `"smtp.sendgrid.net"`). Requis lorsque `smtp_enabled = true`. |
| `smtp_port` | `587` | Port du serveur SMTP. `587` est le port STARTTLS standard. Utilisez `465` pour SSL/TLS, `25` pour non chiffré (non recommandé). |
| `smtp_username` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_use_tls` | `true` | Active la négociation STARTTLS. Recommandé pour le port 587. |
| `smtp_use_ssl` | `false` | Active SSL/TLS direct. Utilisez pour le port 465. Mutuellement exclusif avec `smtp_use_tls`. |

> **Mot de passe SMTP :** Le mot de passe SMTP n'est pas une variable de premier niveau. Ajoutez-le via `secret_environment_variables` pour le garder hors de l'état Terraform :
> ```
> secret_environment_variables = {
>   PENPOT_SMTP_PASSWORD = "your-smtp-password-secret-name"
> }
> ```

### Validation des paramètres SMTP {#validating-smtp-settings}

**gcloud CLI / kubectl :**
```bash
# Confirm SMTP environment variables are set in the backend pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -i smtp

# Check backend logs for SMTP configuration confirmation
kubectl logs -n NAMESPACE POD_NAME | grep -i "smtp\|email\|mail"
```

---

## Groupe 9 : Jobs et tâches planifiées {#group-9-jobs--scheduled-tasks}

Ces variables se comportent comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation).

**Job `db-init` par défaut :** Lorsque `initialization_jobs` est vide (la valeur par défaut), `Penpot Common` fournit un Job Kubernetes `db-init` (image `postgres:15-alpine`, script `scripts/db-init.sh`, `execute_on_apply = true`) qui crée la base de données PostgreSQL et l'utilisateur de l'application. L'application Clojure de Penpot gère ensuite la création et la migration du schéma en interne au démarrage du backend, avant d'accepter les connexions HTTP ou WebSocket. Fournir une liste `initialization_jobs` non vide remplace le job par défaut.

**CronJobs :**

La variable `cron_jobs` est disponible pour les tâches planifiées personnalisées telles que les jobs d'exportation par lots ou le traitement d'analyses. Voir [App_GKE](./App_GKE.md#group-11--workload-automation) pour la documentation complète du schéma.

> **Note :** Les CronJobs GKE utilisent les champs `restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds` et `suspend`. Les champs de style Cloud Run (`parallelism`, `paused`, `max_retries`, `task_count`) ne sont pas disponibles.

**Services supplémentaires :** Le frontend et l'exportateur sont provisionnés automatiquement — vous n'avez pas besoin de les ajouter via `additional_services`. La variable `additional_services` est disponible pour tout service supplémentaire au-delà des trois standards (par exemple, un processeur de webhook personnalisé ou un service sidecar d'exportateur de métriques).

---

## Groupe 10 : Stockage et système de fichiers — NFS {#group-10-storage--filesystem--nfs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-13--nfs-storage).

**Valeurs par défaut spécifiques à Penpot :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Le stockage NFS est activé par défaut. Lorsque `enable_redis = true` et qu'aucun `redis_host` externe n'est fourni, le module utilise l'IP du serveur NFS comme hôte Redis. Si vous désactivez NFS, vous devez fournir un `redis_host` explicite — sans Redis, la collaboration en temps réel n'est pas disponible. |
| `nfs_mount_path` | `"/mnt/nfs"` | Le chemin où le volume NFS est monté à l'intérieur du conteneur. Penpot n'utilise pas NFS pour le stockage d'applications directement — NFS dans ce module héberge principalement le processus Redis utilisé pour le pub/sub WebSocket. |

---

## Groupe 11 : Stockage et système de fichiers — GCS {#group-11-storage--filesystem--gcs}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

**Bucket auto-provisionné spécifique à Penpot :**

`Penpot Common` provisionne automatiquement un bucket GCS (`name_suffix = "assets"`, nom complet `gcs-<service-name>-assets`) pour le stockage des actifs de conception. Contrairement à Paperless-ngx (qui utilise GCS FUSE pour le stockage de documents), le backend Clojure de Penpot accède à ce bucket **nativement via Workload Identity ADC** — aucun montage de volume GCS FUSE n'est requis. Le backend utilise le SDK Java GCS pour lire et écrire directement les actifs de conception.

| Bucket | `name_suffix` | Méthode d'accès | Objectif |
|---|---|---|---|
| Auto-provisionné | `assets` | Workload Identity ADC (SDK GCS) | Actifs de conception : polices, images, vignettes, téléchargements de fichiers |

Les variables d'environnement suivantes sont injectées automatiquement par `Penpot Common` :
- `PENPOT_STORAGE_BACKEND=gcs` — indique à Penpot d'utiliser GCS comme backend de stockage d'actifs
- `PENPOT_STORAGE_GCS_BUCKET_NAME` — défini sur le nom du bucket provisionné

Vous n'avez pas besoin de configurer manuellement les identifiants GCS. Le compte de service Kubernetes du backend est lié à un compte de service GCP avec des autorisations d'administrateur d'objets de stockage sur le bucket d'actifs via Workload Identity.

Les variables `create_cloud_storage`, `storage_buckets`, `gcs_volumes`, `manage_storage_kms_iam`, `enable_artifact_registry_cmek`, `max_images_to_retain`, `delete_untagged_images` et `image_retention_days` se comportent comme décrit dans [App_GKE Groupe 14](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 12 : Configuration de la base de données {#group-12-database-configuration}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-16--database-configuration).

**Valeurs par défaut et restrictions spécifiques à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `db_name` | `"penpot"` | `"gkeappdb"` | Nom de la base de données PostgreSQL créée pour Penpot. **Immuable après le déploiement** — la modification de cette valeur recrée la base de données et détruit tous les projets Penpot, les fichiers de conception et les données d'équipe. |
| `db_user` | `"penpot"` | `"gkeappuser"` | Utilisateur PostgreSQL pour Penpot. **Immuable après le déploiement.** |
| `database_password_length` | `32` | `32` | Longueur du mot de passe de la base de données auto-généré. Plage valide : 16 à 64 caractères. |

> **Important :** Penpot nécessite PostgreSQL. La variable `database_type` déclarée sur `Penpot_GKE` est présente uniquement pour la convention de mise en miroir des variables Foundation (par défaut `"POSTGRES"`) — elle n'est jamais transmise à `Penpot Common` ou `App_GKE`, donc la définir n'a **aucun effet**. Le moteur de base de données réellement provisionné est toujours `POSTGRES_15`, codé en dur à l'intérieur de `Penpot Common`.

**Découverte d'instances Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante à utiliser. Laissez vide pour découvrir automatiquement une instance gérée par Services GCP ou créer une instance intégrée. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base pour l'instance Cloud SQL intégrée lorsqu'aucune instance existante n'est trouvée. L'ID de déploiement est ajouté. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un job de rotation automatique des mots de passe de la base de données. Lorsque `true`, le mot de passe de la base de données est tourné selon le calendrier défini par `secret_rotation_period` et les pods GKE sont redémarrés pour prendre en compte le nouveau identifiant. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

---

## Groupe 13 : Scripts SQL personnalisés {#group-13-custom-sql-scripts}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-18--custom-sql-scripts).

Variables disponibles : `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

---

## Groupe 14 : Observabilité et santé {#group-14-observability--health}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-10--observability).

**Valeurs par défaut spécifiques à Penpot :**

Le backend Clojure de Penpot exécute l'initialisation JVM et les migrations PostgreSQL au démarrage. Le premier démarrage après un déploiement frais peut prendre 60 à 120 secondes avant que le backend n'accepte les connexions HTTP.

### Routage des sondes de santé {#health-probe-routing}

`Penpot GKE` expose **deux ensembles parallèles** de variables de sonde qui configurent les sondes Kubernetes via différents chemins de routage :

| Ensemble de variables | Transmis à | Configure |
|---|---|---|
| `startup_probe`, `liveness_probe` | Sous-module `Penpot Common` | La spécification de sonde Kubernetes du conteneur d'application (`initialDelaySeconds`, `path`, `failureThreshold`, etc.) |
| `startup_probe_config`, `health_check_config` | `App GKE` directement | La configuration de sonde standard App GKE utilisée pour les vérifications de santé de l'équilibreur de charge et les sondes d'infrastructure GKE |

Ce sont des chemins parallèles, pas des alias. La modification de `startup_probe` n'affecte pas `startup_probe_config`, et vice versa.

**Sonde de démarrage** (`startup_probe` → `Penpot Common`) :

| Champ | Valeur par défaut Penpot | Notes |
|---|---|---|
| `type` | `"TCP"` | Sonde TCP sur le port du backend (6060). Délibérément **pas** HTTP `/api/health` — le backend Penpot n'a pas de point de terminaison `/api/health` (ce chemin renvoie 404 ; le vrai est `/readyz`), donc une sonde HTTP redémarrerait en boucle un backend sain. |
| `path` | `"/api/health"` | Présent dans l'objet mais ignoré pour une sonde TCP. |
| `initial_delay_seconds` | `30` | Permet 30 secondes avant la première tentative de sonde. La JVM démarre rapidement ; le délai initial tient compte du temps de migration du schéma. |
| `timeout_seconds` | `10` | Délai d'attente de la sonde par tentative. |
| `period_seconds` | `10` | Intervalle de la sonde. |
| `failure_threshold` | `30` | Jusqu'à 300 secondes (30 × 10s) de temps de démarrage autorisé avant le redémarrage du pod. |

**Sonde de vivacité** (`liveness_probe` → `Penpot Common`) :

| Champ | Valeur par défaut Penpot | Notes |
|---|---|---|
| `type` | `"TCP"` | Sonde TCP sur le port 6060. Délibérément **pas** HTTP `/api/health` (ce chemin renvoie 404 sur le backend Penpot, ce qui redémarrerait en boucle un pod sain). |
| `path` | `"/api/health"` | Présent dans l'objet mais ignoré pour une sonde TCP. |
| `initial_delay_seconds` | `60` | Donne au backend un temps supplémentaire pour se stabiliser avant le début des vérifications de vivacité. |
| `period_seconds` | `30` | Moins fréquent que la sonde de démarrage — approprié pour un service stable en cours d'exécution. |
| `failure_threshold` | `3` | Trois échecs consécutifs déclenchent un redémarrage du pod. |

**Sondes standard App GKE** (`startup_probe_config`, `health_check_config` → `App GKE`) :

| Variable | Valeur par défaut Penpot | Notes |
|---|---|---|
| `startup_probe_config` | `{ enabled = true, type = "TCP", timeout_seconds = 240, period_seconds = 240, failure_threshold = 1 }` | Sonde TCP sur `container_port` (6060). Permet jusqu'à 240 secondes pour le démarrage. |
| `health_check_config` | `{ enabled = true, type = "HTTP", path = "/api/health" }` | Requête HTTP GET vers `/api/health`. Point de terminaison de santé dédié de Penpot. |

**`uptime_check_config` :** Utilise par défaut `{ enabled = false, path = "/api/health" }` — les vérifications de disponibilité sont désactivées par défaut. Activez-les explicitement pour la surveillance de production. Si le backend Penpot n'est pas accessible publiquement (par exemple, derrière IAP), les vérifications de disponibilité doivent utiliser un point de terminaison accessible par Google ou être configurées via la surveillance interne au VPC.

### Validation des sondes de santé {#validating-health-probes}

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

## Groupe 15 : Politiques de fiabilité {#group-15-reliability-policies}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-9--reliability).

**Valeurs par défaut spécifiques à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Le PDB est désactivé par défaut. Activez-le pour les déploiements de production — sans PDB, la maintenance des nœuds peut arrêter simultanément tous les réplicas du backend, déconnectant tous les collaborateurs actifs et pouvant corrompre les modifications de conception en cours. |
| `pdb_min_available` | `1` | Au moins un pod backend doit rester disponible pendant les perturbations volontaires. Nécessite au moins 2 réplicas (`min_instance_count >= 2`) pour être efficace. |

Variables disponibles : `enable_pod_disruption_budget`, `pdb_min_available`, `enable_topology_spread`, `topology_spread_strict`.

---

## Groupe 15 : Domaine personnalisé et IP statique {#group-15-custom-domain--static-ip}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking).

> **`public_uri` et les domaines personnalisés :** Penpot doit connaître son URL publique au démarrage. `PENPOT_PUBLIC_URI` est injecté automatiquement en utilisant l'URL de service prédite. Lors de l'utilisation d'un domaine personnalisé, définissez `PENPOT_PUBLIC_URI` explicitement via `environment_variables` pour qu'il corresponde au domaine dans `application_domains`. Penpot utilise `public_uri` pour :
> - Générer les liens d'invitation envoyés dans les notifications par e-mail
> - Configurer l'URL de base de l'API backend de la SPA frontend
> - Fournir l'URL correcte au Chromium sans tête de l'exportateur pour le rendu des pages
>
> Un `public_uri` incorrect rompt les e-mails d'invitation, le rendu des exportations et toutes les URL absolues intégrées dans les fichiers de conception.

---

## Groupe 16 : Redis (WebSocket Pub/Sub) {#group-16-redis-websocket-pubsub}

Ces variables configurent l'intégration de Redis à Penpot. Le support de l'infrastructure Redis sous-jacente est fourni par `App_GKE` (voir [App_GKE](./App_GKE.md#group-15--redis-cache)). Redis est **obligatoire** pour Penpot — c'est le bus d'événements pub/sub WebSocket qui synchronise les modifications de conception en temps réel entre tous les utilisateurs connectés sur tous les réplicas du backend.

> **Note :** Dans `Penpot GKE`, les variables Redis se trouvent dans le **groupe 21**.

| Variable | Valeur par défaut | Options / Format | Description et implications |
|---|---|---|---|
| `enable_redis` | `true` | `true` / `false` | Active Redis comme bus d'événements pub/sub WebSocket de Penpot. **Doit rester `true` pour que la collaboration en temps réel fonctionne.** Lorsque `true` et `redis_host` est vide, le module utilise par défaut l'adresse IP du serveur NFS comme hôte Redis. Sans Redis, tout déploiement avec plus d'un réplica backend présentera un comportement de "split-brain" — les utilisateurs sur différents réplicas ne peuvent pas voir les modifications de conception des autres. Avec un seul réplica, le bus d'événements interne de Penpot est utilisé, mais cela se rompt à chaque redémarrage de pod ou mise à jour progressive. |
| `redis_host` | `""` *(par défaut l'IP du serveur NFS)* | Nom d'hôte ou adresse IP | Le nom d'hôte ou l'adresse IP du serveur Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS découverte automatiquement. Remplacez par une IP ou un nom d'hôte explicite lors de l'utilisation d'une instance Redis dédiée — telle que Google Cloud Memorystore pour Redis — pour une disponibilité et un débit plus élevés. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Chaîne de numéro de port | Le port TCP sur lequel le serveur Redis écoute. Le port par défaut `6379` est le port Redis standard. |
| `redis_auth` | `""` | Chaîne *(sensible)* | Mot de passe d'authentification pour le serveur Redis. Laissez vide si l'instance Redis ne nécessite pas d'authentification. Pour Google Cloud Memorystore avec AUTH activé, définissez-le sur la chaîne AUTH de l'instance. Cette valeur est traitée comme sensible. |

### Validation des paramètres Redis {#validating-redis-settings}

**Console Google Cloud :**
- **Instance Memorystore (si utilisée) :** Accédez à **Memorystore → Redis** pour confirmer l'existence de l'instance, son adresse IP, son port et son statut AUTH.
- **Environnement de pod GKE :** Accédez à **Kubernetes Engine → Charges de travail**, sélectionnez le déploiement du backend Penpot et vérifiez les variables d'environnement du pod pour `PENPOT_REDIS_URI`.

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

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-6--gke-backend-config).

**Valeurs par défaut spécifiques à Penpot :**

| Variable | Valeur par défaut Penpot GKE | Notes |
|---|---|---|
| `session_affinity` | `"ClientIP"` | Recommandé pour la stabilité de WebSocket. Avec `"None"`, les requêtes de mise à niveau WebSocket et les trames WebSocket ultérieures peuvent être acheminées vers différents réplicas backend — cela peut interrompre les sessions de collaboration actives. `"ClientIP"` garantit qu'une connexion WebSocket d'un utilisateur atteint toujours le même pod backend. |
| `service_type` | `"LoadBalancer"` | Expose le backend Penpot via un équilibreur de charge Google Cloud. Le service frontend (`ingress = "INGRESS_TRAFFIC_ALL"`) est également exposé en externe et reçoit directement le trafic du navigateur de l'utilisateur. Le service d'exportation (`ingress = "INGRESS_TRAFFIC_INTERNAL_ONLY"`) est uniquement interne au cluster. |
| `termination_grace_period_seconds` | `60` | Permet aux sessions WebSocket en cours et aux opérations d'exportation de se vider avant la terminaison du pod. Envisagez d'augmenter à 120 secondes et plus pour les équipes qui utilisent fréquemment la fonction d'exportation PDF/PNG. |

Variables disponibles : `gke_cluster_name`, `namespace_name`, `workload_type`, `service_type`, `session_affinity`, `configure_service_mesh`, `enable_network_segmentation`, `termination_grace_period_seconds`, `deployment_timeout`, `network_name`, `prereq_subnet_cidr_override`. (`enable_multi_cluster_service` et `gke_cluster_selection_mode` existent sur `App_GKE` mais ne sont pas reflétés sur `Penpot_GKE`.)

---

## Groupe 18 : Charges de travail avec état {#group-18-stateful-workloads}

Identique à `App_GKE`. Voir la configuration StatefulSet décrite dans [App_GKE](./App_GKE.md#group-7--statefulset--pvc).

La définition de `stateful_pvc_enabled = true` sélectionne automatiquement `workload_type = "StatefulSet"`. Le stockage des actifs de conception de Penpot est sauvegardé par GCS, de sorte qu'un PVC par pod n'est pas requis pour la durabilité des données de conception. Un StatefulSet avec PVC peut être utile pour stocker des dumps de tas JVM locaux ou des caches internes persistants de Penpot entre les redémarrages.

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez sur `true` pour activer StatefulSet avec PVC par pod. |
| `stateful_pvc_size` | `"10Gi"` | Taille initiale du PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin du conteneur où le PVC par pod est monté. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | StorageClass pour le PVC. |
| `stateful_headless_service` | `null` | Créez un service sans tête pour des identités DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | `"OrderedReady"` ou `"Parallel"`. |
| `stateful_update_strategy` | `null` | `"RollingUpdate"` ou `"OnDelete"`. |
| `stateful_fs_group` | `null` | GID pour le fsGroup au niveau du pod dans le contexte de sécurité. |

---

## Sorties du module {#module-outputs}

`Penpot GKE` expose les sorties Terraform suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes principal (backend) |
| `service_cluster_ip` | ClusterIP interne au cluster du service Kubernetes principal |
| `frontend_url` | URL externe du frontend Penpot |
| `backend_cluster_url` | URL interne au cluster du service backend Penpot |
| `exporter_cluster_url` | URL interne au cluster du service d'exportation Penpot |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge |
| `project_id` | ID du projet GCP |
| `deployment_id` | Suffixe de l'ID de déploiement |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` | Nom de la base de données de l'application |
| `database_user` | Nom de l'utilisateur de la base de données de l'application |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données |
| `storage_buckets` | Buckets de stockage GCS créés (inclut le bucket d'actifs auto-provisionné) |
| `container_image` | Image du conteneur backend utilisée pour le déploiement |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources de charge de travail Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster inline — réexécutez apply pour terminer le déploiement. |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | *(obligatoire)* | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `enable_redis` | `true` | **Critique** | Redis est le bus pub/sub WebSocket. Le désactiver entraîne une rupture immédiate de la collaboration en temps réel avec plus d'un réplica backend. Split-brain : les utilisateurs sur différents réplicas ne peuvent pas voir les modifications de conception des autres. |
| `redis_host` | `""` | **Élevé** | Se résout automatiquement en IP NFS. Si NFS est désactivé et qu'aucun hôte explicite n'est donné, la connexion Redis de Penpot échoue au démarrage et le backend refuse de démarrer. |
| `enable_nfs` | `true` | **Élevé** | Requis lorsque `redis_host` est vide. La désactivation de NFS sans fournir d'hôte Redis explicite entraîne l'échec du démarrage du backend. |
| `container_port` | `6060` | **Critique** | Le backend Penpot écoute sur 6060. Changer cela sans faire correspondre le port lié du conteneur entraîne l'échec immédiat de toutes les sondes de santé et du proxy nginx frontend. |
| `memory_limit` | `"2Gi"` | **Élevé** | La JVM nécessite une marge au-delà de `jvm_max_heap`. Définir `memory_limit` égal à `jvm_max_heap` ne laisse aucune place à la mémoire hors tas (tampons Netty, surcharge GC) et provoque des arrêts OOM. Définissez toujours `memory_limit` à au moins 1,5 × `jvm_max_heap`. |
| `jvm_max_heap` | `"1g"` | **Élevé** | Définir `jvm_max_heap` au-dessus de `memory_limit` provoque un arrêt OOM immédiat au démarrage de la JVM. Le définir trop bas provoque une collecte de déchets excessive sous charge, réduisant la réactivité et le débit de WebSocket. |
| `timeout_seconds` | `3600` | **Moyen** | Les exportations PDF/PNG volumineuses de conceptions complexes de plusieurs pages peuvent prendre plusieurs minutes. Réduire cela en dessous de 120 secondes entraîne l'expiration des jobs d'exportation et le renvoi d'une erreur à l'utilisateur. |
| `session_affinity` | `"ClientIP"` | **Élevé** | Sans affinité de session, les requêtes de mise à niveau WebSocket et leurs trames ultérieures peuvent être acheminées vers différents réplicas backend. Les sessions de collaboration actives subissent des déconnexions et des pertes d'événements. |
| `penpot_flags` | `"enable-registration enable-login disable-demo-users"` | **Moyen** | Des drapeaux incorrects peuvent désactiver complètement la connexion (par exemple, supprimer `enable-login-with-password` sans configurer OIDC) ou ouvrir l'enregistrement au public de manière inattendue (supprimer `disable-registration` sur un déploiement accessible via Internet). |
| `public_uri` (via `environment_variables`) | *(prédit automatiquement)* | **Élevé** | Doit correspondre à l'URL réelle que les utilisateurs utilisent pour accéder à Penpot. Un `public_uri` incorrect rompt les liens d'e-mail d'invitation, les redirections OIDC et la navigation Chromium sans tête de l'exportateur — les PDF et PNG exportés seront vides ou échoueront. |
| `db_name` | `"penpot"` | **Critique** | Immuable après le déploiement — le modifier recrée la base de données et détruit tous les projets Penpot, fichiers de conception, composants et données d'équipe. |
| `db_user` | `"penpot"` | **Critique** | Immuable après le déploiement — le modifier recrée l'utilisateur, invalide les identifiants et rompt la connexion à la base de données de Penpot. |
| `application_version` | `"latest"` | **Élevé** | Les trois images de service (backend, frontend, exportateur) doivent utiliser la même balise de version. Des versions incompatibles entre le backend et le frontend peuvent entraîner des incompatibilités d'API qui rompent l'interface utilisateur web. Épinglez à une version spécifique pour la production. |
| `backup_retention_days` | `7` | **Moyen** | Insuffisant pour les équipes de conception ayant des exigences strictes en matière de récupération de données. Augmentez à 30 jours et plus pour les déploiements de production avec un travail de conception actif qui ne peut pas être recréé. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers nus sont traités comme des octets et empêchent la planification de tous les pods — cela affecte simultanément les trois services Penpot. |
| `enable_pod_disruption_budget` | `false` | **Élevé** | Sans PDB, la maintenance des nœuds peut arrêter simultanément tous les réplicas backend, déconnectant tous les collaborateurs actifs et pouvant entraîner la perte de modifications de conception non enregistrées. Activez-le pour tout déploiement de production avec des utilisateurs actifs. |
| `smtp_enabled` | `false` | **Moyen** | Sans SMTP, les e-mails d'invitation ne peuvent pas être envoyés. L'intégration des équipes nécessite le partage manuel des identifiants de connexion ou l'utilisation d'un fournisseur OIDC. La réinitialisation du mot de passe est également indisponible sans SMTP. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Penpot sur GKE Autopilot](../labs/Penpot_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Penpot sur Google Cloud Run](Penpot_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune de Penpot](Penpot_Common.md) — la configuration partagée par les deux cibles de déploiement.
