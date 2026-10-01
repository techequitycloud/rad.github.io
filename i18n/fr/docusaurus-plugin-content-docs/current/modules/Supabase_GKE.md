---
title: "Supabase sur GKE Autopilot"
description: "Référence de configuration pour déployer Supabase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Supabase_GKE.md @ 3055034 sha256:1a2563d39759 -->

# Supabase sur GKE Autopilot {#supabase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Supabase_GKE.png" alt="Supabase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Supabase est une alternative open source à Firebase — un backend-as-a-service complet
construit sur PostgreSQL. Il fournit une base de données PostgreSQL 15 avec
l'extension pgvector, des abonnements en temps réel, l'authentification GoTrue, des
API REST PostgREST, un service de stockage compatible S3 et un tableau de bord
d'administration Studio, le tout derrière une **passerelle d'API Kong**. Ce module
déploie Supabase sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

> **GKE uniquement.** Supabase n'est disponible que dans la variante GKE. Son
> architecture multiservice (passerelle Kong, GoTrue, PostgREST, Realtime, Storage,
> Studio) requiert des connexions persistantes et des primitives Kubernetes que Cloud
> Run ne prend pas en charge.

Ce guide se concentre sur les services cloud utilisés par Supabase et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Le déploiement Supabase exécute une passerelle d'API Kong comme charge de travail GKE
principale, placée devant un ensemble de microservices Supabase. Il assemble les
services Google Cloud suivants :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Passerelle d'API (calcul) | GKE Autopilot | Pods de la passerelle Kong, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Microservices | GKE Autopilot (services supplémentaires) | Authentification GoTrue, PostgREST, Realtime, API Storage, Studio — chacun dans un Deployment distinct |
| Base de données | GKE Autopilot (`supabase/postgres` dans l'espace de noms) | Obligatoire — Supabase est natif PostgreSQL. Pas Cloud SQL : `main.tf` définit `database_type = "NONE"` sur le socle et exécute `supabase/postgres` comme service supplémentaire |
| Stockage d'objets | Cloud Storage | Un bucket dédié avec le suffixe `storage` pour les téléversements de fichiers |
| Secrets | Secret Manager | Secret de signature JWT (généré automatiquement), anon key, service role key, publishable key, secret key et secret_key_base |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé ; tout
  autre moteur empêche le démarrage.
- **Kong fonctionne en mode déclaratif (sans base de données).** Le routage est défini
  dans `/home/kong/kong.yml`, intégré à l'image du conteneur — aucune base de données
  Kong n'est nécessaire.
- **Les identifiants JWT sont générés automatiquement ou provisoires.** Le secret de
  signature JWT est généré automatiquement (32 caractères aléatoires). L'anon key et
  la service role key sont stockées sous forme de valeurs provisoires et **doivent
  être remplacées par des JWT signés valides** avant une utilisation en production.
- **Le mot de passe du superutilisateur Postgres de l'espace de noms est généré
  automatiquement.** Comme `SECRET_KEY_BASE`/`DB_ENC_KEY` de Realtime, c'est un
  `random_password` sans variable d'entrée correspondante — il n'est pas fourni par
  l'utilisateur et reste interne (ClusterIP, jamais exposé).
- **pgvector est fourni avec l'image de la base de données.** `pgcrypto`,
  `uuid-ossp` et `pgvector` sont inclus dans `supabase/postgres`, si bien que les
  fonctionnalités d'IA/embeddings de Supabase fonctionnent d'emblée ; les tâches
  d'extensions propres au socle sont désactivées (`enable_postgres_extensions` est
  remplacé par `false` dans `main.tf`) car elles ciblent Cloud SQL.
- **La mise en miroir des images est toujours active.** Les images de Kong et des
  sidecars sont mises en miroir dans Artifact Registry à chaque apply pour éviter les
  limites de débit de Docker Hub.
- **L'affinité de session vaut `None`.** Kong est sans état ; le routage persistant
  n'est pas nécessaire au niveau de la passerelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — passerelle Kong et microservices Supabase {#a-gke-autopilot--kong-gateway-and-supabase-microservices}

La charge de travail GKE principale exécute la passerelle d'API Kong sur le port 8000.
Kong achemine toutes les requêtes entrantes vers les microservices Supabase selon le
préfixe de chemin :

| Préfixe de chemin | Service cible | Port |
|---|---|---|
| `/auth/v1/*` | GoTrue (authentification) | 9999 |
| `/rest/v1/*` | PostgREST (API REST) | 3000 |
| `/realtime/v1/*` | Realtime (WebSocket) | 4000 |
| `/storage/v1/*` | API Storage | 5000 |

Les services Supabase supplémentaires (GoTrue, PostgREST, Realtime, Storage, Studio)
sont déployés comme Deployments Kubernetes distincts dans le même espace de noms via
`additional_services`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez une charge de
  travail pour voir les pods, les événements et les métriques. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. PostgreSQL 15 — `supabase/postgres` dans l'espace de noms {#b-postgresql-15--in-namespace-supabasepostgres}

Supabase stocke toutes les données applicatives dans un Deployment
`supabase/postgres` exécuté dans le même espace de noms (un service ClusterIP, jamais
exposé à l'extérieur) — **pas** dans Cloud SQL, et sans Auth Proxy. Lors du premier
déploiement, la tâche `db-init` s'y connecte en tant que `supabase_admin`, définit les
mots de passe des rôles de service, crée les schémas Supabase et applique les droits
du schéma `public`.

> **Les données sont éphémères.** Le pod postgres écrit sur le disque local du pod
> (`ephemeral_storage_limit = "4Gi"`), si bien que les données sont réinitialisées
> au redémarrage du pod — acceptable pour un déploiement de lab ou de test ; un
> déploiement de production nécessite un PVC bloc par pod.

- **Console :** Kubernetes Engine → Workloads → le Deployment `postgres`.
- **CLI :**
  ```bash
  kubectl get deploy,svc -n "$NAMESPACE" | grep postgres
  kubectl exec -n "$NAMESPACE" deploy/<postgres-workload> -- \
    psql -U supabase_admin -d postgres -c '\dn'
  ```

Pour le modèle de connexion Cloud SQL propre au socle (non utilisé ici), les
sauvegardes et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (déclaré avec `name_suffix = "storage"`) est
provisionné pour les téléversements de fichiers Supabase. L'accès est accordé
automatiquement au compte de service de la charge de travail. La prévention de
l'accès public est définie sur `inherited` afin que des ACL au niveau du bucket
puissent être utilisées pour servir les objets.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager — identifiants et clés JWT {#d-secret-manager--jwt-credentials-and-keys}

L'authentification Supabase repose sur des JWT. Six secrets sont stockés dans Secret
Manager :

| Suffixe du secret | Contenu | Remarques |
|---|---|---|
| `-jwt-secret` | Secret de signature JWT de 32 caractères | Généré automatiquement si `jwt_secret` est vide |
| `-anon-key` | JWT anonyme public | **Valeur provisoire par défaut — doit être remplacée** |
| `-service-role-key` | JWT du rôle de service | **Valeur provisoire par défaut — doit être remplacée** |
| `-publishable-key` | Clé d'API opaque publishable (anon) | Valeur provisoire si non fournie |
| `-secret-key` | Clé d'API opaque côté serveur | Valeur provisoire si non fournie |
| `-key-base` | `secret_key_base` de 64 caractères pour Realtime/Supavisor | Généré automatiquement si `secret_key_base` est vide |

Le mot de passe de la base de données est généré et géré séparément par le socle ; le
nom de son secret est indiqué dans les Sorties (`database_password_secret`).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the JWT signing secret:
  gcloud secrets versions access latest --secret=<prefix>-jwt-secret --project "$PROJECT"
  # Update the anon key after generating a signed JWT:
  echo -n "<signed-anon-jwt>" | gcloud secrets versions add <prefix>-anon-key \
    --data-file=- --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la passerelle Kong est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés et les détails de
l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Supabase {#3-supabase-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche `db-init`
  se connecte au service `supabase/postgres` de l'espace de noms en tant que
  `supabase_admin` et, de manière idempotente, définit des mots de passe LOGIN sur les
  rôles de service que l'image laisse sans mot de passe (`authenticator`,
  `supabase_auth_admin`, `supabase_storage_admin`), crée les schémas `auth`,
  `storage`, `_realtime` et `realtime` avec leurs droits, et définit les GUC de base
  de données `app.settings.jwt_secret`/`jwt_exp`. Elle s'exécute de manière non
  bloquante (`execute_on_apply = false`) avec sa propre boucle d'attente
  `pg_isready`, car le socle crée les jobs d'initialisation avant les services
  supplémentaires. Elle peut être relancée sans risque.
- **Remplacement des JWT provisoires.** Après le premier déploiement, les secrets de
  l'anon key et de la service role key contiennent des chaînes provisoires. Ils
  **doivent être remplacés** par des JWT valides signés avec le `jwt_secret` généré
  automatiquement avant que les clients Supabase puissent s'authentifier :
  1. Récupérez le secret JWT : `gcloud secrets versions access latest --secret=<prefix>-jwt-secret`
  2. Générez un JWT anon (`role: anon`) et un JWT service_role (`role: service_role`)
     avec [jwt.io](https://jwt.io) ou le
     [générateur de JWT de Supabase](https://supabase.com/docs/guides/self-hosting/docker#generate-api-keys).
  3. Téléversez chaque JWT : `echo -n "<jwt>" | gcloud secrets versions add <secret-name> --data-file=-`
  4. Redémarrez le pod Kong pour qu'il prenne en compte les secrets mis à jour :
     `kubectl rollout restart deploy/<kong-workload> -n "$NAMESPACE"`
- **Les identifiants JWT sont immuables en tant qu'ensemble.** `jwt_secret`,
  `anon_key` et `service_role_key` doivent toujours être régénérés ensemble. Modifier
  le secret JWT sans changer les clés dérivées invalide immédiatement tous les jetons
  émis.
- **Kong est sans état.** La passerelle lit le routage depuis le fichier déclaratif
  `kong.yml` intégré à l'image. Aucune base de données Kong n'est utilisée.
- **Les sondes de santé sont TCP, et non HTTP `/health`.** Les variables
  `startup_probe`/`liveness_probe` (et `startup_probe_config`/`health_check_config`)
  déclarent toutes une valeur par défaut HTTP `GET /health`, mais la configuration
  déclarative DB-less de `kong.yml` ne définit aucune route `/health` (uniquement
  `/rest/v1`, `/auth/v1`, `/realtime/v1`, `/storage/v1`, `/pg` et `/` pour Studio) —
  une sonde HTTP sur ce chemin renverrait une 404. `main.tf` remplace
  inconditionnellement les sondes de démarrage et de vivacité du conteneur Kong
  déployé par des sondes **TCP** sur le port du conteneur, quelle que soit la valeur
  de ces variables. La sonde de démarrage laisse toujours ~5 minutes
  (`15 s initial delay × 30
  failures × 10 s period`) pour que la configuration de la base de données au premier
  démarrage se termine.
- **Realtime utilise PostgreSQL LISTEN/NOTIFY.** Aucun Redis n'est requis pour la pile
  Supabase de base ; `enable_redis` vaut `false` par défaut.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Supabase ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `supabase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Supabase` | Nom lisible affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `2.8.1` | Tag de version de l'image de la passerelle Kong. Figez-le sur une version testée ; évitez `latest` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `1000m` / `2Gi` | Limite CPU et limite mémoire du conteneur de la passerelle Kong. Portez le CPU à `2000m` pour le trafic de production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods Kong. Gardez ≥ 1 — les démarrages à froid perturbent les flux de redirection OAuth. |
| `max_instance_count` | `3` | Nombre maximal de réplicas de pods Kong (plafond de l'autoscaler). |
| `container_port` | `8000` | Port du proxy HTTP de Kong. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. Non utilisé par Supabase — chaque service se connecte directement au `supabase/postgres` de l'espace de noms. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les requêtes de ressources. |
| `container_image_source` | `custom` | Mode de source de l'image. `custom` construit via Cloud Build à partir de `Supabase_Common/scripts/Dockerfile`. |
| `enable_image_mirroring` | `true` | Toujours activé — Kong est mis en miroir depuis Docker Hub dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales de Kong/Supabase sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées comme variables d'environnement. |
| `jwt_secret` | `""` | Secret de signature JWT. Laissez vide pour générer automatiquement 32 caractères aléatoires. **À considérer comme définitivement immuable après le premier déploiement.** |
| `anon_key` | `""` | JWT anonyme public. Laissez vide ; une valeur provisoire est stockée — remplacez-la après le déploiement. |
| `service_role_key` | `""` | JWT du rôle de service (accès complet à la base de données). Laissez vide ; remplacez-le après le déploiement. **Ne jamais l'exposer dans le code client.** |
| `publishable_key` | `""` | Clé d'API opaque publishable (anon) pour les clients Supabase récents. Valeur provisoire si vide. |
| `supabase_secret_key` | `""` | Clé d'API opaque côté serveur pour les clients Supabase récents. Valeur provisoire si vide. |
| `secret_key_base` | `""` | Secret de chiffrement interne de 64 caractères pour Realtime/Supavisor. Généré automatiquement si vide. |
| `site_url` | `http://localhost:3000` | URL de base des redirections d'authentification GoTrue. Définissez votre domaine public. |
| `api_external_url` | `http://localhost:8000` | URL externe de l'API Supabase pour la construction des redirections OAuth. |
| `supabase_public_url` | `http://localhost:8000` | URL de base publique du tableau de bord et de l'API REST. |
| `jwt_expiry` | `3600` | Durée d'expiration en secondes des jetons émis par GoTrue. |
| `pgrst_db_schemas` | `public,storage,graphql_public` | Schémas PostgreSQL exposés par PostgREST. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition externe du Service Kong. |
| `session_affinity` | `None` | Kong est sans état ; le routage persistant n'est pas nécessaire. |
| `workload_type` | `null` | Vaut `Deployment` par défaut. |
| `gke_cluster_name` | `""` | Nom du cluster GKE. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour le générer automatiquement. |
| `termination_grace_period_seconds` | `60` | Secondes avant SIGKILL après SIGTERM. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans le StatefulSet. Laissez non défini — l'état de Supabase réside dans Cloud SQL et GCS, pas dans le stockage local des pods. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod (si les PVC du StatefulSet sont activés). |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent toute planification de pods. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité lors des mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai initial de 30 s, 18 échecs | **Ignorée.** `main.tf` code en dur la sonde de démarrage Kong déployée en TCP ; voir §3. |
| `health_check_config` | HTTP `/health`, délai initial de 60 s, 3 échecs | **Ignorée.** `main.tf` code en dur la sonde de vivacité Kong déployée en TCP ; voir §3. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |
| `cron_jobs` | `[]` | Tâches planifiées du cluster (par ex. routines de nettoyage de la base de données). |
| `additional_services` | `[]` | **Microservices Supabase** (GoTrue, PostgREST, Realtime, API Storage, Studio) déployés comme Deployments Kubernetes supplémentaires dans le même espace de noms. Chaque entrée précise `name`, `image`, `port`, les limites de ressources, les variables d'environnement et la configuration des sondes. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS n'est pas nécessaire pour Supabase ; le stockage est assuré par GCS. L'activer ajoute un coût inutile. |
| `nfs_mount_path` | `/var/lib/storage` | Chemin de montage si NFS est activé. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket avec le suffixe `storage`. |
| `storage_buckets` / `gcs_volumes` | _(défini par Common)_ | Buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Inerte — `main.tf` remplace la valeur réellement reçue par le socle par `"NONE"`, car PostgreSQL s'exécute dans l'espace de noms plutôt que sur Cloud SQL. |
| `application_database_name` | `postgres` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `supabase_admin` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `enable_postgres_extensions` | `true` | Installe `pgcrypto`, `uuid-ossp` et `pgvector`. Obligatoire. |
| `postgres_extensions` | `["pgcrypto","uuid-ossp","pgvector"]` | Liste des extensions. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `[]` | Tags réseau appliqués aux nœuds et aux pods GKE. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant la passerelle Kong. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes (passerelle Kong). |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à l'API Supabase via la passerelle Kong. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (`postgres`). |
| `database_user` | Utilisateur de la base de données de l'application (`supabase_admin`). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image Kong déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Pipeline de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `jwt_secret` | généré automatiquement ou fixé au premier déploiement | Critique | Le modifier après le déploiement invalide tous les JWT émis ; toutes les connexions clientes cessent de fonctionner. `anon_key` et `service_role_key` doivent être régénérées ensemble. |
| `anon_key` / `service_role_key` | JWT signés (remplacer les valeurs provisoires) | Critique | Les valeurs provisoires font renvoyer une 401 à chaque appel d'API Supabase. Les trois identifiants JWT doivent être régénérés comme un ensemble atomique. |
| `enable_cloudsql_volume` | `true` | Faible | Inerte pour Supabase — GoTrue, PostgREST, Realtime et Storage se connectent tous au `supabase/postgres` de l'espace de noms via leurs propres URL `postgres://`, et non via l'Auth Proxy. |
| `database_type` | `POSTGRES_15` | Faible | Inerte — `main.tf` transmet quoi qu'il arrive `"NONE"` au socle, car PostgreSQL 15 s'exécute comme service `supabase/postgres` dans l'espace de noms. |
| `application_database_name` / `_user` | définis une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods. |
| `enable_postgres_extensions` | `true` | Faible | Remplacé par `false` dans `main.tf` (les tâches d'extensions du socle ciblent Cloud SQL, que ce module n'utilise pas) ; les extensions sont fournies dans l'image `supabase/postgres`. |
| `min_instance_count` | `1` | Élevé | Une valeur de `0` autorise la mise à l'échelle à zéro ; les démarrages à froid de Kong prennent 15–30 s et perturbent les flux de redirection OAuth. |
| `container_resources` CPU | `2000m` en production | Élevé | Un CPU insuffisant provoque une latence élevée et des délais d'attente 504 sous charge. |
| `container_resources` mémoire | `2Gi` minimum | Élevé | Une mémoire insuffisante provoque des arrêts OOM sous charge concurrente. |
| `startup_probe_config` / `startup_probe` | inertes — `main.tf` code en dur la sonde déployée en TCP (`failure_threshold=30`, `period_seconds=10`, ~5 min) | Élevé | Définir ces variables n'a aucun effet sur le conteneur Kong déployé ; ne comptez pas sur elles pour allonger la tolérance au premier démarrage — voir §3. |
| `site_url` / `api_external_url` / `supabase_public_url` | vraies URL publiques | Élevé | Les valeurs par défaut localhost empêchent les flux OAuth et la construction des redirections de fonctionner en dehors du cluster. |
| `application_version` | figée (pas `latest`) | Moyen | Récupérer `latest` expose à des versions de Kong incompatibles avec la configuration déclarative fournie. |
| `enable_nfs` | `false` | Faible | NFS est inutile pour Supabase ; l'activer ajoute un coût Filestore et une dépendance susceptible de retarder le provisionnement. |
| `enable_redis` | `false` | Moyen | Redis est facultatif. S'il vaut `true`, `redis_host` doit pointer vers un point de terminaison joignable ; un hôte injoignable provoque des délais d'attente au démarrage de Kong. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Supabase,
partagée entre les secrets, le build de l'image Kong et le job d'initialisation de
la base de données, est décrite dans **[Supabase_Common](Supabase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Supabase sur GKE Autopilot](../labs/Supabase_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Supabase Common — Configuration applicative partagée](Supabase_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Hasura sur Google Cloud Run](Hasura_CloudRun.md), [Directus sur Cloud Run](Directus_CloudRun.md), [Meilisearch sur GKE Autopilot](Meilisearch_GKE.md) dans la solution **Application Backend Services**.
