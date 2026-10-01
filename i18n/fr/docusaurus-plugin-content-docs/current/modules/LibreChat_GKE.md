---
title: "LibreChat sur GKE Autopilot"
description: "Référence de configuration pour déployer LibreChat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LibreChat_GKE.md @ 3055034 sha256:1132cf0443d3 -->

# LibreChat sur GKE Autopilot {#librechat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LibreChat_GKE.png" alt="LibreChat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LibreChat est une interface de chat IA open source, forte de plus de 20 000 étoiles sur GitHub, qui reproduit et
enrichit l'expérience ChatGPT avec plus de 20 fournisseurs de LLM (OpenAI, Anthropic, Google Gemini,
Mistral, Groq, Ollama et bien d'autres). Ce module déploie LibreChat sur **GKE Autopilot**
en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par LibreChat et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LibreChat s'exécute comme une charge de travail web Node.js. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | MongoDB (service auxiliaire `mongo:7` dans l'espace de noms par défaut) | Cloud SQL n'est pas utilisé ; la compatibilité MongoDB de Firestore est une alternative à activer explicitement |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux fichiers téléversés, plus des buckets supplémentaires facultatifs |
| Secrets | Secret Manager | Clés JWT, clés de chiffrement des identifiants et URI MongoDB générés automatiquement |
| Cache et sessions | Redis (facultatif) | Requis pour les déploiements multi-réplicas afin de garantir la cohérence des sessions |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** LibreChat utilise MongoDB. `mongodb_uri` vaut `""` par défaut, mais `main.tf`
  le remplace par l'URI calculée d'un service auxiliaire `mongo:7` dans l'espace de noms
  (`mongodb://<service>-mongo.<namespace>.svc.cluster.local:27017/LibreChat`) avant même
  d'appeler `LibreChat_Common` — ce **service auxiliaire MongoDB dans l'espace de noms est la base de données par défaut**,
  à l'image du sidecar dans le pod de `LibreChat_CloudRun`. Firestore ENTERPRISE avec compatibilité
  MongoDB est une **alternative à activer explicitement** : le provisionnement automatique propre à `LibreChat_Common` ne
  se déclenche que lorsqu'il reçoit un `mongodb_uri` réellement vide et un `firestore_mongodb_host` vide,
  une combinaison que la configuration par défaut de ce module ne produit jamais. Définissez `mongodb_uri`
  explicitement (vers une base MongoDB externe, Atlas ou un hôte Firestore) pour abandonner le service auxiliaire par défaut.
- **Le service auxiliaire MongoDB par défaut nécessite NFS.** Son répertoire de données `/data/db` est monté depuis
  le volume Filestore (NFS) partagé, mais `enable_nfs` vaut `false` par défaut sur GKE (contrairement à
  `LibreChat_CloudRun`, où l'exigence NFS du sidecar équivalent vaut `true` par défaut).
  Définissez `enable_nfs = true`, sauf si vous remplacez `mongodb_uri` par une base MongoDB externe.
- **Une base de données Firestore (lorsqu'elle est choisie) n'est jamais supprimée lors de la destruction.** La base de données est
  conservée pour éviter toute perte de données ; supprimez-la manuellement si vous n'en avez plus besoin.
- **Les secrets JWT et d'identifiants sont générés automatiquement** au premier déploiement et stockés dans Secret Manager.
  La rotation de `CREDS_KEY` ou de `CREDS_IV` après que des utilisateurs ont enregistré des identifiants de fournisseurs d'IA rend tous
  les identifiants stockés indéchiffrables.
- **Redis est désactivé par défaut.** Activez-le pour tout déploiement de plus d'un réplica —
  sans Redis, l'état des sessions est isolé par pod et les utilisateurs perdent leur session lors des redémarrages de pods.
- **L'affinité de session est `ClientIP`.** LibreChat utilise des connexions WebSocket ; le routage persistant maintient
  le trafic d'un utilisateur sur le même pod.
- **Le délai d'expiration est de 600 secondes par défaut.** Les réponses d'IA longues diffusées en streaming SSE nécessitent un
  délai généreux.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants
figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LibreChat {#a-gke-autopilot--the-librechat-workload}

Les pods LibreChat sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et le nombre maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail LibreChat pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Service auxiliaire MongoDB dans l'espace de noms — la base de données LibreChat {#b-in-namespace-mongodb-helper--the-librechat-database}

LibreChat stocke tout l'historique des conversations, les comptes utilisateurs et la configuration dans MongoDB. Par défaut,
le bloc `librechat_additional_services` de `main.tf` exécute l'image officielle `mongo:7` sous la forme d'un
`Deployment`+`Service` auxiliaire unique (`min=max=1`) dans l'espace de noms, joignable via le DNS du cluster
à l'adresse `<service>-mongo.<namespace>.svc.cluster.local:27017`. Cela reproduit le sidecar `mongo:7` dans le pod
de `LibreChat_CloudRun`, mais sur GKE le service auxiliaire est une charge de travail distincte plutôt qu'un
conteneur du même pod — parce que LibreChat est conçu autour de MongoDB standard et que l'API compatible Mongo
de Firestore ignore les commandes de démarrage de LibreChat. Le répertoire de données du service auxiliaire
(`/data/db`) est monté depuis le volume Filestore (NFS) partagé ; le nombre de réplicas limité à un
évite les problèmes de verrouillage de fichiers en écriture multiple que MongoDB rencontre sur NFS. `mongodb_uri` (par défaut `""`)
est résolu automatiquement vers l'URI de ce service auxiliaire — définissez-le explicitement pour le remplacer par MongoDB
Atlas ou toute instance MongoDB auto-hébergée accessible depuis le VPC.

Vous pouvez aussi vider la configuration effective pour opter pour une **base de données Firestore ENTERPRISE
compatible MongoDB** — cela ne se produit que lorsque `LibreChat_Common` lui-même reçoit un
`mongodb_uri` vide et un `firestore_mongodb_host` vide, ce qui exige de remplacer le câblage par défaut de ce
module (le `librechat.tf` de la surcouche substitue toujours l'URI du service auxiliaire lorsque
`var.mongodb_uri == ""`).

- **Console :** Kubernetes Engine → Workloads → le Deployment `<service>-mongo` affiche le pod,
  les journaux et les événements du service auxiliaire. Firestore → sélectionnez la base de données (uniquement en mode
  Firestore ; l'ID correspond à `firestore_mongodb_database`, par défaut : `LibreChat`).
- **CLI :**
  ```bash
  # Inspect the default MongoDB helper and its NFS-backed data directory:
  kubectl get pods,svc -n "$NAMESPACE" -l component=mongo
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-mongo --tail=100

  # If using Firestore mode instead (opt-in only):
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Récupérez l'URI MongoDB résolue depuis Secret Manager pour vérifier la connectivité :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — fichiers téléversés {#c-cloud-storage--file-uploads}

`LibreChat_Common` provisionne un bucket Cloud Storage dédié **`librechat-uploads`** pour les fichiers
que les utilisateurs partagent dans le chat (images, documents). Le compte de service de la charge de travail reçoit l'accès
automatiquement.

- **Console :** Cloud Storage → Buckets → repérez le bucket portant le suffixe `uploads`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  # Confirm the GCS Fuse mount is active inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Secret Manager — secrets applicatifs générés automatiquement {#d-secret-manager--auto-generated-application-secrets}

LibreChat nécessite plusieurs secrets cryptographiques qui sont générés automatiquement au premier déploiement
et ne sont jamais exposés en clair.

| Suffixe du secret | Variable d'environnement | Rôle |
|---|---|---|
| `creds-key` | `CREDS_KEY` | Clé AES-GCM hexadécimale de 32 octets pour les identifiants de fournisseurs enregistrés |
| `creds-iv` | `CREDS_IV` | IV AES-GCM hexadécimal de 16 octets — associé à `CREDS_KEY` |
| `jwt-secret` | `JWT_SECRET` | Signe les jetons d'accès des utilisateurs |
| `jwt-refresh-secret` | `JWT_REFRESH_SECRET` | Signe les jetons d'actualisation de longue durée |
| `mongo-uri` | `MONGO_URI` | Chaîne de connexion MongoDB |

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Cache Redis (facultatif) {#e-redis-cache-optional}

Redis prend en charge la gestion des sessions de LibreChat et la mise en file d'attente des messages en temps réel. Il est requis lorsque
plus d'un réplica de pod est en cours d'exécution — sans lui, chaque pod dispose d'un état de session en mémoire isolé
et les utilisateurs perdent leur session lorsque les requêtes sont acheminées vers un autre pod.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # From inside the cluster:
  kubectl run redis-check --rm -it --image=redis --restart=Never -- redis-cli -h <redis-host> ping
  ```

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing. Un domaine personnalisé
avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur
l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE vers Cloud Monitoring. Des tests de disponibilité
et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LibreChat {#3-librechat-application-behaviour}

- **Aucune tâche de migration de la base de données.** LibreChat migre automatiquement son schéma MongoDB au premier démarrage ;
  aucun job d'initialisation distinct n'est nécessaire.
- **Service auxiliaire `mongo:7` dans l'espace de noms par défaut, et non Firestore.** `mongodb_uri` vaut `""` par défaut,
  mais `main.tf` le remplace par l'URI calculée d'un service auxiliaire `mongo:7` dans l'espace de noms avant même
  d'appeler `LibreChat_Common` — voir §1 et §2.B. Le provisionnement automatique de Firestore ENTERPRISE (découverte
  ou création, plus provisionnement automatique d'un utilisateur SCRAM) est une alternative à activer explicitement, atteinte uniquement lorsque
  le `mongodb_uri` effectif transmis à `LibreChat_Common` est vide, ce qui exige de
  remplacer le câblage par défaut de ce module. En mode Firestore, la base de données n'est jamais
  détruite avec le module.
- **Clés d'API des fournisseurs d'IA.** LibreChat se connecte lui-même aux API des fournisseurs d'IA au moment de la requête.
  Injectez les clés des fournisseurs (OpenAI, Anthropic, etc.) via `secret_environment_variables`, qui
  référence des secrets Secret Manager existants. Ne transmettez pas les clés en tant que simples `environment_variables`
  — elles apparaîtraient dans les spécifications des pods, visibles via `kubectl describe pod`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `/` (la racine de LibreChat), qui
  renvoie HTTP 200 une fois l'application entièrement initialisée et connectée à MongoDB. La
  sonde de démarrage dispose d'un seuil d'échec généreux pour laisser le temps d'établir la connexion à MongoDB au
  premier démarrage.
- **Continuité WebSocket et SSE.** LibreChat utilise les Server-Sent Events (SSE) pour diffuser en streaming les réponses
  de l'IA et WebSocket pour les mises à jour en temps réel. L'affinité de session (`ClientIP`) maintient la
  connexion d'un utilisateur sur le même pod. Veillez à ce que `timeout_seconds` soit suffisamment élevé (600 s par défaut) pour
  éviter de tronquer les longues réponses de l'IA en cours de diffusion.
- **Inscription des utilisateurs.** L'auto-inscription est activée par défaut. Définissez `allow_registration = false`
  après avoir créé le compte administrateur initial pour empêcher les inscriptions non autorisées sur les déploiements publics.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres
à LibreChat ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `firestore_mongodb_host` | `""` | Hôte du point de terminaison MongoDB de Firestore (remplacement manuel). Laissez vide pour la découverte automatique. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `librechat` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `LibreChat AI Chat` | Nom convivial affiché dans la console. |
| `application_description` | _(définie)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de version de l'image LibreChat — **figez-le sur une version précise en production**. |
| `mongodb_uri` | `""` | URI de connexion MongoDB (sensible). Conservez la valeur par défaut `""` pour utiliser le service auxiliaire `mongo:7` dans l'espace de noms que `main.tf` calcule automatiquement — le provisionnement automatique de Firestore est un chemin distinct à activer explicitement (voir §2.B), et non ce que déclenche à lui seul le fait de laisser ce champ vide. |
| `app_title` | `LibreChat` | Titre affiché dans l'en-tête de l'interface LibreChat et dans l'onglet du navigateur. |
| `allow_registration` | `true` | Autorise les nouveaux utilisateurs à s'inscrire eux-mêmes. **Définissez `false` après la création du compte administrateur initial.** |
| `allow_social_login` | `false` | Active les fournisseurs de connexion sociale OAuth. Nécessite la configuration d'une application OAuth dans `librechat.yaml`. |
| `allow_social_registration` | `null` | Autorise la création de compte via la connexion sociale. Prend par défaut la valeur de `allow_social_login`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | `prebuilt` (GHCR) ou `custom` (Cloud Build). |
| `container_image` | `ghcr.io/danny-avila/librechat` | URI de l'image de conteneur. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | CPU et mémoire par pod ; 2 vCPU / 2 GiB au minimum. |
| `container_port` | `3080` | Port HTTP natif de LibreChat. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid et les flux SSE interrompus. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond du HPA). |
| `timeout_seconds` | `600` | Délai d'expiration des requêtes ; augmentez-le pour des backends LLM lents ou de longues réponses d'IA. |
| `enable_cloudsql_volume` | `false` | **Doit rester à `false`.** LibreChat n'utilise pas Cloud SQL. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_image_mirroring` | `true` | Met en miroir l'image GHCR dans Artifact Registry — évite les limites de débit. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables principales de LibreChat sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. **Utilisez-la pour les clés d'API des fournisseurs d'IA.** |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `ClientIP` | Routage persistant pour la continuité WebSocket et SSE. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque le stockage par pod est activé. |
| `network_tags` | `['nfsserver']` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant l'arrêt forcé ; augmentez cette valeur pour les requêtes d'IA en cours. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active un PVC par pod. Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage de chaque PVC. |
| `stateful_pvc_mount_path` | `/data` | Chemin du PVC dans le conteneur. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — des entiers nus sont interprétés en octets et bloquent toute planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `false` | Crée un PodDisruptionBudget (désactivé par défaut car le nombre maximal de réplicas vaut 1 pod par défaut). |
| `pdb_min_available` | `1` | Portez `min_instance_count` au-dessus de 1 si vous avez besoin de marge pour les évictions. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ path="/", initial_delay_seconds=30, failure_threshold=12 }` | Sonde HTTP laissant le temps d'établir la connexion à MongoDB et de charger les ressources. |
| `health_check_config` | `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | Sonde de vivacité ciblant le chemin racine de LibreChat. |
| `uptime_check_config` | désactivé, `/` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide — LibreChat migre automatiquement MongoDB au démarrage. Ajoutez des tâches de configuration personnalisées si nécessaire. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiées pour les tâches périodiques (nettoyage des données, préchauffage du cache, etc.). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne un volume NFS Filestore partagé entre tous les réplicas. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS supplémentaires. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires en plus du bucket de téléversements provisionné automatiquement. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis pour la gestion des sessions. **Requis pour les déploiements multi-réplicas.** |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Base de données / MongoDB {#group-16--database--mongodb}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Imposé — ne pas modifier.** LibreChat n'utilise pas Cloud SQL. |
| `firestore_mongodb_database` | `LibreChat` | ID de la base de données Firestore / nom de la base de données MongoDB. |
| `firestore_mongodb_username` | `""` | Nom d'utilisateur SCRAM pour l'authentification Firestore. |
| `firestore_mongodb_password` | `""` | Mot de passe SCRAM (sensible). Généré automatiquement s'il n'est pas défini. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde NFS automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Sans objet — LibreChat n'utilise pas Cloud SQL. Consultez [App_GKE](App_GKE.md) pour
les mécanismes partagés.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway Kubernetes pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant LibreChat. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affichée sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape (Cloud Deploy). |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à LibreChat. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de téléversements). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration exécutées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. Vaut false lors du premier apply d'un nouveau cluster créé en mode intégré (inline) — relancez l'apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CREDS_KEY` / `CREDS_IV` (générés automatiquement) | définis une seule fois | Critical | Clés AES-GCM des identifiants de fournisseurs d'IA enregistrés. Leur rotation après que des utilisateurs ont enregistré des clés détruit tous les identifiants stockés — chaque utilisateur doit saisir à nouveau ses clés d'API. |
| `mongodb_uri` | conserver la valeur par défaut (service auxiliaire `mongo:7` dans l'espace de noms) ou la définir explicitement | Critical | LibreChat nécessite MongoDB. Le service auxiliaire `mongo:7` dans l'espace de noms par défaut a besoin de `enable_nfs = true` pour son répertoire de données ; remplacer `mongodb_uri` par `""` dans l'appel à `LibreChat_Common` (en contournant le câblage par défaut de ce module) avec une configuration Firestore/Atlas défaillante fait planter le pod au démarrage, qui ne sert alors aucun trafic. |
| `enable_cloudsql_volume` | `false` | Critical | Doit rester à `false`. L'activer injecte un sidecar Cloud SQL Auth Proxy qui entre en conflit avec le routage des connexions exclusivement MongoDB. |
| `database_type` | `NONE` | Critical | Le définir sur un moteur SQL provisionne une instance Cloud SQL inutilisée, à un coût supplémentaire, sans aucun bénéfice pour LibreChat. |
| `secret_environment_variables` (clés d'IA) | utiliser des secrets | Critical | Les clés des fournisseurs d'IA transmises en simples `environment_variables` sont visibles dans `kubectl describe pod` et dans les journaux d'audit GCP. Utilisez toujours des références Secret Manager. |
| `iap_oauth_client_id` / `_secret` | à définir lorsque IAP est activé | Critical | Obligatoires lorsque `enable_iap = true`. S'ils ne sont pas fournis, la passerelle IAP ne parvient pas à s'initialiser et le service devient injoignable. |
| `quota_memory_requests` / `_limits` | unités binaires | Critical | Des entiers nus sont interprétés en octets et bloquent toute planification. |
| `allow_registration` | `false` après la configuration | High | Une inscription ouverte sur un déploiement exposé par LoadBalancer permet à n'importe qui de créer un compte. Désactivez-la après la création de l'administrateur ou restreignez l'accès avec IAP. |
| `enable_redis` | `true` en multi-réplicas | High | Sans Redis, les redémarrages et replanifications de pods interrompent toutes les sessions actives et tous les flux SSE acheminés vers ce pod. |
| `redis_host` | point de terminaison explicite | High | Requis lorsque `enable_redis = true`. S'il est vide, LibreChat ne parvient pas à se connecter à Redis au démarrage. |
| `timeout_seconds` | `600` | High | Le streaming SSE de longues réponses d'IA peut dépasser plusieurs minutes. Un délai insuffisant tronque les réponses en cours de diffusion. |
| `min_instance_count` | `1` | High | La mise à l'échelle à zéro interrompt tous les flux SSE en cours et provoque une latence de démarrage à froid au réveil. |
| `JWT_SECRET` (généré automatiquement) | défini une seule fois | High | Sa rotation invalide simultanément toutes les sessions actives. Planifiez la rotation pendant une fenêtre de maintenance. |
| `enable_nfs` | `true` avec le service auxiliaire MongoDB par défaut | High | Vaut `false` par défaut. Le service auxiliaire `mongo:7` dans l'espace de noms (le backend de base de données par défaut) monte son répertoire de données (`/data/db`) depuis le volume NFS — laisser `enable_nfs` à sa valeur par défaut avec le service auxiliaire actif signifie qu'il n'a aucun volume à monter. Également nécessaire pour les déploiements multi-réplicas afin que les fichiers téléversés ne restent pas locaux au pod. |
| `backup_schedule` | à définir en production | High | Sans sauvegardes, l'historique des conversations et les données utilisateurs dans MongoDB/Firestore ne disposent d'aucun instantané au niveau GCS. |
| `application_version` | version figée | Medium | `latest` peut introduire des changements incompatibles du schéma MongoDB ou des incompatibilités d'API lors de montées de version non planifiées. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Medium | Sinon, LibreChat est directement joignable depuis l'internet public, protégé uniquement par la connexion au niveau de l'application. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Medium | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, mise à l'échelle automatique,
entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à LibreChat
partagée avec la variante Cloud Run est décrite dans **[LibreChat_Common](LibreChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LibreChat sur GKE Autopilot](../labs/LibreChat_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LibreChat sur Google Cloud Run](LibreChat_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LibreChat Common — Configuration applicative partagée](LibreChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
