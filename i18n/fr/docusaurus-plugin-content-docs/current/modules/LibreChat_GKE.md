---
title: "LibreChat sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de LibreChat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LibreChat_GKE.md @ 15fd4c7 sha256:24e57f7d3aae -->

# LibreChat sur GKE Autopilot {#librechat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LibreChat_GKE.png" alt="LibreChat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LibreChat est une interface de chat IA open source avec plus de 20 000 étoiles GitHub qui
réplique et étend l'expérience ChatGPT sur plus de 20 fournisseurs LLM (OpenAI, Anthropic,
Google Gemini, Mistral, Groq, Ollama, et bien d'autres). Ce module déploie LibreChat sur
**GKE Autopilot** sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par LibreChat et sur la manière de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle
de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LibreChat fonctionne comme une charge de travail web Node.js. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | MongoDB (service d'aide `mongo:7` dans l'espace de noms par défaut) | Cloud SQL n'est pas utilisé ; la compatibilité Firestore MongoDB est une alternative optionnelle |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux téléchargements de fichiers, plus des buckets supplémentaires optionnels |
| Secrets | Secret Manager | Clés JWT, clés de chiffrement des identifiants et URI MongoDB auto-générés |
| Cache et sessions | Redis (optionnel) | Requis pour les déploiements multi-réplicas afin de maintenir la cohérence des sessions |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de Cloud SQL.** LibreChat utilise MongoDB. `mongodb_uri` utilise par défaut `""`, mais `main.tf`
  substitue un URI de service d'aide `mongo:7` calculé dans l'espace de noms
  (`mongodb://<service>-mongo.<namespace>.svc.cluster.local:27017/LibreChat`) avant d'appeler `LibreChat_Common` — ce **service d'aide MongoDB dans l'espace de noms est la
  base de données par défaut**, reflétant le sidecar `LibreChat_CloudRun` de `LibreChat_Common`. Firestore ENTERPRISE
  avec compatibilité MongoDB est une **alternative optionnelle** : l'auto-provisionnement
  de `mongodb_uri` ne se déclenche que lorsqu'il reçoit un `firestore_mongodb_host` et un `mongodb_uri`
  véritablement vides, une combinaison que la configuration par défaut de ce module ne produit
  jamais. Définissez `/data/db` explicitement (vers un MongoDB externe, Atlas ou un hôte Firestore)
  pour quitter l'aide par défaut.
- **L'aide MongoDB par défaut nécessite NFS.** Son répertoire de données `enable_nfs` est monté
  à partir du volume Filestore (NFS) partagé, donc `true` est par défaut à `mongodb_uri`.
  Gardez-le activé à moins que vous ne remplaciez `CREDS_KEY` par un MongoDB externe — avec NFS
  désactivé, l'aide n'a pas de volume à monter et LibreChat boucle en crash.
- **Une base de données Firestore (lorsqu'elle est choisie) n'est jamais supprimée lors de la
  destruction.** La base de données est conservée pour éviter la perte de données ; supprimez-la
  manuellement si elle n'est plus nécessaire.
- **Les secrets JWT et d'identifiants sont auto-générés** lors du premier déploiement et
  stockés dans Secret Manager. La rotation de `CREDS_IV` ou `ClientIP` après que les
  utilisateurs ont enregistré des identifiants de fournisseur IA rend tous les identifiants
  stockés indéchiffrables.
- **Redis est désactivé par défaut.** Activez-le pour tout déploiement avec plus d'un réplica
  — sans Redis, l'état de session est isolé par pod et les utilisateurs perdent leurs sessions
  lors des redémarrages de pod.
- **L'affinité de session est `gcloud container clusters get-credentials <cluster> --region <region> --project <project>`.** LibreChat utilise des connexions WebSocket ; le
  routage persistant maintient le trafic d'un utilisateur sur le même pod.
- **Le délai d'attente est par défaut de 600 secondes.** Les réponses IA de longue durée via
  le streaming SSE nécessitent un délai d'attente généreux.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`PROJECT`
et que `REGION`, `NAMESPACE` et `main.tf` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LibreChat {#a-gke-autopilot--the-librechat-workload}

Les pods LibreChat sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail
  LibreChat pour voir les pods, les révisions et les événements. Kubernetes Engine → Services
  et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de
charge de travail (Déploiement vs StatefulSet).

### B. Aide MongoDB dans l'espace de noms — la base de données LibreChat {#b-in-namespace-mongodb-helper--the-librechat-database}

LibreChat stocke tout l'historique des chats, les comptes d'utilisateurs et la configuration
dans MongoDB. Par défaut, le bloc `librechat_additional_services` de `mongo:7` exécute l'image officielle `min=max=1`
en tant que service d'aide singleton (`Deployment`) dans l'espace de noms `Service`+`<service>-mongo.<namespace>.svc.cluster.local:27017`,
accessible via le DNS du cluster à l'adresse `LibreChat_CloudRun`. Cela reflète le sidecar `mongo:7`
de `/data/db` dans le pod, mais sur GKE, l'aide est une charge de travail distincte plutôt qu'un
conteneur du même pod — car LibreChat est construit autour de MongoDB standard et l'API
compatible Mongo de Firestore supprime les commandes de démarrage de LibreChat. Le répertoire
de données de l'aide (`mongodb_uri`) est monté à partir du volume Filestore (NFS) partagé ; le
nombre de réplicas singleton évite les problèmes de verrouillage de fichiers multi-écrivains
que MongoDB a sur NFS. `""` (par défaut `LibreChat_Common`) est résolu automatiquement à l'URI
de cette aide — définissez-le explicitement pour le remplacer par MongoDB Atlas ou toute
instance MongoDB auto-hébergée accessible depuis le VPC.

Alternativement, effacez la configuration effective pour opter pour une **base de données
Firestore ENTERPRISE avec compatibilité MongoDB** — cela ne se produit que lorsque `mongodb_uri`
lui-même reçoit un `firestore_mongodb_host` et un `librechat.tf` vides, ce qui nécessite de
remplacer le câblage par défaut de ce module (le `var.mongodb_uri == ""` du wrapper substitue toujours
l'URI de l'aide lorsque `<service>-mongo`).

- **Console :** Kubernetes Engine → Charges de travail → le déploiement `firestore_mongodb_database` affiche le
  pod, les journaux et les événements de l'aide. Firestore → sélectionnez la base de données
  (uniquement lorsque le mode Firestore est utilisé ; l'ID correspond à `LibreChat`, par défaut :
  `LibreChat_Common`).
- **CLI :**
  ```bash
  # Inspect the default MongoDB helper and its NFS-backed data directory:
  kubectl get pods,svc -n "$NAMESPACE" -l component=mongo
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-mongo --tail=100

  # If using Firestore mode instead (opt-in only):
  gcloud firestore databases list --project "$PROJECT"
  gcloud firestore databases describe LibreChat --project "$PROJECT"
  ```

Récupérez l'URI MongoDB résolu depuis Secret Manager pour vérifier la connectivité :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~mongo-uri"
gcloud secrets versions access latest --secret=<mongo-uri-secret> --project "$PROJECT"
```

### C. Cloud Storage — téléchargements de fichiers {#c-cloud-storage--file-uploads}

`librechat-uploads` provisionne un bucket Cloud Storage dédié **`uploads`** pour les
téléchargements de fichiers utilisateur partagés dans le chat (images, documents). Le compte de
service de la charge de travail est automatiquement autorisé à y accéder.

- **Console :** Cloud Storage → Buckets → recherchez le bucket avec le suffixe `creds-key`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/
  # Confirm the GCS Fuse mount is active inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h | grep -i fuse
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, GCS Fuse et les options CMEK.

### D. Secret Manager — secrets d'application auto-générés {#d-secret-manager--auto-generated-application-secrets}

LibreChat nécessite plusieurs secrets cryptographiques qui sont générés automatiquement lors
du premier déploiement et ne sont jamais exposés en texte clair.

| Suffixe du secret | Variable d'environnement | Objectif |
|---|---|---|
| `CREDS_KEY` | `creds-iv` | Clé AES-GCM hexadécimale de 32 octets pour les identifiants de fournisseur enregistrés |
| `CREDS_IV` | `CREDS_KEY` | IV AES-GCM hexadécimal de 16 octets — associé à `jwt-secret` |
| `JWT_SECRET` | `jwt-refresh-secret` | Signe les jetons d'accès utilisateur |
| `JWT_REFRESH_SECRET` | `mongo-uri` | Signe les jetons de rafraîchissement de longue durée |
| `MONGO_URI` | `mongo:7` | Chaîne de connexion MongoDB |

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Cache Redis (optionnel) {#e-redis-cache-optional}

Redis prend en charge la gestion des sessions de LibreChat et la mise en file d'attente des
messages en temps réel. Il est requis lorsque plus d'un réplica de pod est en cours d'exécution
— sans lui, chaque pod a un état de session en mémoire isolé et les utilisateurs perdent leurs
sessions lorsque les requêtes sont acheminées vers un pod différent.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # From inside the cluster:
  kubectl run redis-check --rm -it --image=redis --restart=Never -- redis-cli -h <redis-host> ping
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les
adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LibreChat {#3-librechat-application-behaviour}

- **Pas de job de migration de base de données.** LibreChat migre automatiquement son schéma
  MongoDB au premier démarrage ; aucun job d'initialisation séparé n'est nécessaire.
- **Aide `mongodb_uri` dans l'espace de noms par défaut, pas Firestore.** `""` est par défaut
  à `main.tf`, mais `mongo:7` substitue un URI de service d'aide `LibreChat_Common` calculé dans
  l'espace de noms avant d'appeler `mongodb_uri` — voir §1 et §2.B. L'auto-provisionnement
  Firestore ENTERPRISE (découverte ou création, plus provisionnement automatique d'utilisateur
  SCRAM) est une alternative optionnelle atteinte uniquement lorsque le `LibreChat_Common` effectif
  passé à `secret_environment_variables` est vide, ce qui nécessite de remplacer le câblage par défaut de ce
  module. Lorsque le mode Firestore est utilisé, la base de données n'est jamais détruite avec
  le module.
- **Clés API du fournisseur IA.** LibreChat se connecte aux API du fournisseur IA au moment de
  la requête. Injectez les clés du fournisseur (OpenAI, Anthropic, etc.) via `environment_variables`,
  qui fait référence à des secrets Secret Manager préexistants. Ne passez pas les clés en
  clair `kubectl describe pod` — elles apparaîtraient dans les spécifications de pod visibles via `/`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `ClientIP`
  (la racine de LibreChat), qui renvoie HTTP 200 une fois que l'application est entièrement
  initialisée et connectée à MongoDB. La sonde de démarrage a un seuil d'échec généreux pour
  permettre l'établissement de la connexion MongoDB au premier démarrage.
- **Continuité WebSocket et SSE.** LibreChat utilise les Server-Sent Events (SSE) pour le
  streaming des réponses IA et WebSocket pour les mises à jour en temps réel. L'affinité de
  session (`timeout_seconds`) maintient la connexion d'un utilisateur sur le même pod. Assurez-vous que
  `allow_registration = false` est suffisamment élevé (600 s par défaut) pour éviter de tronquer les longues
  réponses IA en cours de flux.
- **Inscription des utilisateurs.** L'auto-inscription est activée par défaut. Définissez
  `project_id` après avoir créé le compte administrateur initial pour empêcher les
  inscriptions non autorisées sur les déploiements publics.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour LibreChat sont listés ;
toute autre entrée est héritée de [App_GKE](App_GKE.md) avec son comportement et ses
valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `region` | _(requis)_ | Projet Google Cloud cible. |
| `us-central1` | `firestore_mongodb_host` | Région pour la charge de travail et les ressources régionales. |
| `""` | `tenant_id` | Hôte du point de terminaison MongoDB Firestore (remplacement manuel). Laissez vide pour la découverte automatique. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `demo` | `support_users` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `[]` | `resource_labels` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `{}` | `application_name` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `librechat` | `application_display_name` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `LibreChat AI Chat` | `application_description` | Nom convivial affiché dans la console. |
| `application_version` | _(défini)_ | Annotation de description de la charge de travail. |
| `latest` | `mongodb_uri` | Tag de version de l'image LibreChat — **épingler à une version spécifique en production**. |
| `""` | `""` | URI de connexion MongoDB (sensible). Laissez la valeur par défaut `mongo:7` pour utiliser le service d'aide `main.tf` dans l'espace de noms que `app_title` calcule automatiquement — l'auto-provisionnement Firestore est un chemin d'accès optionnel distinct (voir §2.B), ce n'est pas ce que laisser ce champ vide déclenche seul. |
| `LibreChat` | `allow_registration` | Titre affiché dans l'en-tête de l'interface utilisateur LibreChat et l'onglet du navigateur. |
| `true` | `false` | Autoriser les nouveaux utilisateurs à s'auto-enregistrer. **Définissez `allow_social_login` après la création du compte administrateur initial.** |
| `false` | `librechat.yaml` | Activer les fournisseurs de connexion sociale OAuth. Nécessite une configuration d'application OAuth dans `allow_social_registration`. |
| `null` | `allow_social_login` | Autoriser la création de compte via la connexion sociale. Par défaut à la valeur de `deploy_application`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `true` | `false` | Définissez `container_image_source` pour provisionner uniquement l'infrastructure. |
| `prebuilt` | `prebuilt` | `custom` (GHCR) ou `container_image` (Cloud Build). |
| `ghcr.io/danny-avila/librechat` | `container_resources` | URI de l'image du conteneur. |
| `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | `container_port` | CPU et mémoire par pod ; 2 vCPU / 2 GiB minimum. |
| `3080` | `min_instance_count` | Port HTTP natif de LibreChat. |
| `1` | `max_instance_count` | Réplicas minimum. Gardez ≥ 1 pour éviter les démarrages à froid et les flux SSE interrompus. |
| `5` | `timeout_seconds` | Réplicas maximum (plafond HPA). |
| `600` | `enable_cloudsql_volume` | Délai d'attente de la requête ; augmentez-le pour les backends LLM lents ou les longues réponses IA. |
| `false` | `false` | **Doit rester `enable_vertical_pod_autoscaling`.** LibreChat n'utilise pas Cloud SQL. |
| `false` | `enable_image_mirroring` | Laissez Autopilot ajuster automatiquement les demandes de ressources. |
| `true` | `environment_variables` | Mettre en miroir l'image GHCR vers Artifact Registry — évite les limites de débit. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `{}` | `secret_environment_variables` | Paramètres non secrets supplémentaires. Les variables principales de LibreChat sont définies automatiquement. |
| `{}` | `secret_propagation_delay` | Mappage de variable d'environnement → nom de secret Secret Manager. **Utilisez ceci pour les clés API du fournisseur IA.** |
| `30` | `secret_rotation_period` | Secondes à attendre après la création du secret avant de continuer. |
| `2592000s` | `service_type` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `LoadBalancer` | `session_affinity` | Comment le service Kubernetes est exposé. |
| `ClientIP` | `workload_type` | Routage persistant pour la continuité WebSocket et SSE. |
| `null` | `StatefulSet` | Se résout automatiquement en `network_tags` lorsque le stockage par pod est activé. |
| `['nfsserver']` | `nfsserver` | Tags de nœud/pod ; `termination_grace_period_seconds` est requis pour la connectivité NFS. |
| `60` | `stateful_pvc_enabled` | Secondes à attendre après SIGTERM avant de terminer de force ; augmentez pour les requêtes IA en cours. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `null` | `StatefulSet` | Activer le PVC par pod. Sélectionne automatiquement `stateful_pvc_size`. |
| `10Gi` | `stateful_pvc_mount_path` | Taille de stockage pour chaque PVC. |
| `/data` | `stateful_pvc_storage_class` | Chemin du conteneur pour le PVC. |
| `standard-rwo` | `enable_resource_quota` | Kubernetes StorageClass pour les PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `false` | `quota_memory_requests` | Plafonner les comptes de CPU/mémoire/objets de l'espace de noms. |
| `quota_memory_limits` / `""` | `4Gi` | **Doit utiliser des unités binaires (`8192Mi`, `enable_pod_disruption_budget`)** — les entiers bruts sont lus comme des octets et bloquent toute planification. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `false` | `pdb_min_available` | Créer un PodDisruptionBudget (désactivé par défaut car le nombre maximal de réplicas est de 1 pod). |
| `1` | `min_instance_count` | Augmentez `startup_probe_config` au-dessus de 1 si vous avez besoin d'une marge d'éviction. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `{ path="/", initial_delay_seconds=30, failure_threshold=12 }` | `health_check_config` | Sonde HTTP permettant le temps de connexion MongoDB et de chargement des actifs. |
| `{ path="/", initial_delay_seconds=60, failure_threshold=3 }` | `uptime_check_config` | Sonde de vivacité ciblant le chemin racine de LibreChat. |
| `/` | désactivé, `alert_policies` | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `[]` | `initialization_jobs` | Politiques d'alerte métrique optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `[]` | `cron_jobs` | Laissez vide — LibreChat migre automatiquement MongoDB au démarrage. Ajoutez des tâches de configuration personnalisées si nécessaire. |
| `[]` | `enable_cicd_trigger` | CronJobs Kubernetes planifiés pour les tâches périodiques (nettoyage des données, préchauffage du cache, etc.). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard App_GKE Cloud Build / Cloud Deploy — voir
[App_GKE](App_GKE.md). Entrées clés : `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_nfs`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `true` | `nfs_mount_path` | Provisionner un volume Filestore NFS partagé entre tous les réplicas. Requis par l'aide MongoDB par défaut. |
| `/mnt/nfs` | `create_cloud_storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `true` | `storage_buckets` | Provisionner des buckets GCS supplémentaires. |
| `[{ name_suffix = "data" }]` | `gcs_volumes` | Buckets supplémentaires au-delà du bucket de téléchargements auto-provisionné. |
| `[]` | `manage_storage_kms_iam` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `enable_artifact_registry_cmek` / `false` | `max_images_to_retain` | Options CMEK. |
| `delete_untagged_images` / `image_retention_days` / `enable_redis` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `false` | `redis_host` | Activer Redis pour la gestion des sessions. **Requis pour les déploiements multi-réplicas.** |
| `""` | `enable_redis = true` | Point de terminaison Redis. Requis lorsque `redis_port`. |
| `6379` | `redis_auth` | Port Redis. |
| `""` | `database_type` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 16 — Base de données / MongoDB {#group-16--database--mongodb}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `NONE` | `firestore_mongodb_database` | **Fixe — ne pas modifier.** LibreChat n'utilise pas Cloud SQL. |
| `LibreChat` | `firestore_mongodb_username` | ID de base de données Firestore / Nom de base de données MongoDB. |
| `""` | `firestore_mongodb_password` | Nom d'utilisateur SCRAM pour l'authentification Firestore. |
| `""` | `backup_schedule` | Mot de passe SCRAM (sensible). Auto-généré lorsqu'il n'est pas défini. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `0 2 * * *` | `backup_retention_days` | Cron de sauvegarde NFS automatisée (UTC). |
| `7` | `enable_custom_domain` | Rétention ; augmentez à 30-90 pour la production/conformité. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Non applicable — LibreChat n'utilise pas Cloud SQL. Voir [App_GKE](App_GKE.md) pour
les mécanismes partagés.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `true` | `application_domains` | Provisionner Kubernetes Gateway pour les noms d'hôtes personnalisés + certificat géré. |
| `[]` | `reserve_static_ip` | Noms d'hôtes à servir. |
| `true` | `enable_iap` | IP externe stable sur les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `false` | `iap_authorized_users` | Exiger la connexion Google devant LibreChat. |
| `iap_authorized_groups` / `[]` | `iap_oauth_client_id` | Qui peut accéder. |
| `iap_oauth_client_secret` / `""` | `iap_support_email` | Requis lorsque IAP est activé (sensible). |
| `""` | `enable_cloud_armor` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `false` | `admin_ip_ranges` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `[]` | `cloud_armor_policy_name` | CIDR autorisés à un accès privilégié. |
| `default-waf-policy` | `enable_vpc_sc` | Nom de la politique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `false` | `organization_id` | Appliquer un périmètre VPC-SC (nécessite `vpc_cidr_ranges`). |
| `vpc_sc_dry_run` / `enable_audit_logging` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `false` | `service_name` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide
de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `namespace` | Nom du service Kubernetes. |
| `service_cluster_ip` | Espace de noms dans lequel la charge de travail s'exécute. |
| `stage_service_cluster_ips` | ClusterIP intra-cluster. |
| `service_external_ip` | Mappage des ClusterIP pour les services spécifiques à l'étape (Cloud Deploy). |
| `service_url` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `storage_buckets` | URL pour atteindre LibreChat. |
| `network_name` | Buckets Cloud Storage créés (inclut le bucket de téléchargements). |
| `network_exists` / `regions` / `container_image` | Réseau VPC, présence, régions disponibles. |
| `container_registry` / `monitoring_enabled` | Image déployée et dépôt Artifact Registry. |
| `monitoring_notification_channels` / `initialization_jobs` | État et canaux de surveillance. |
| `deployment_id` | Noms des jobs de configuration qui ont été exécutés. |
| `tenant_id` / `resource_prefix` / `project_id` | Identifiants de nommage. |
| `project_number` / `cicd_enabled` | Identifiants de projet. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` / `artifact_registry_repository` | État et détails CI/CD. |
| `cloudbuild_trigger_name` / `cloudbuild_trigger_id` / `kubernetes_ready` | Registre et déclencheur de build. |
| `vpc_sc_enabled` | Indique si le cluster et la charge de travail sont prêts. Faux lors de la première application d'un nouveau cluster inline — réexécutez l'application pour terminer. |
| `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` / `audit_logging_enabled` | État VPC-SC. |
| `artifact_registry_cmek_enabled` / `CREDS_KEY` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `CREDS_IV` / `mongodb_uri` (auto-généré) | défini une fois | Critique | Clés AES-GCM pour les identifiants de fournisseur IA enregistrés. La rotation après que les utilisateurs ont enregistré des clés détruit tous les identifiants stockés — chaque utilisateur doit ressaisir ses clés API. |
| `mongo:7` | laisser par défaut (aide `mongo:7` dans l'espace de noms) ou définir explicitement | Critique | LibreChat nécessite MongoDB. L'aide `enable_nfs = true` par défaut dans l'espace de noms a besoin de `mongodb_uri` pour son répertoire de données ; remplacer `""` par `LibreChat_Common` lors de l'appel `enable_cloudsql_volume` (en contournant le câblage par défaut de ce module) avec une configuration Firestore/Atlas cassée fait planter le pod au démarrage et ne sert aucun trafic. |
| `false` | `false` | Critique | Doit rester `database_type`. L'activation injecte un sidecar Cloud SQL Auth Proxy qui entre en conflit avec le routage de connexion uniquement MongoDB. |
| `NONE` | `secret_environment_variables` | Critique | La définition d'un moteur SQL provisionne une instance Cloud SQL inutilisée à un coût supplémentaire sans bénéficier à LibreChat. |
| `environment_variables` (clés IA) | utiliser des secrets | Critique | Les clés de fournisseur IA passées en clair `kubectl describe pod` sont visibles dans `iap_oauth_client_id` et les journaux d'audit GCP. Utilisez toujours les références Secret Manager. |
| `_secret` / `enable_iap = true` | défini lorsque IAP est activé | Critique | Requis lorsque `quota_memory_requests`. S'il n'est pas fourni, la passerelle IAP ne parvient pas à s'initialiser et le service devient inaccessible. |
| `_limits` / `allow_registration` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification. |
| `false` | `enable_redis` après la configuration | Élevé | L'enregistrement ouvert sur un déploiement exposé par LoadBalancer permet à quiconque de créer un compte. Désactivez-le après la création de l'administrateur ou restreignez-le avec IAP. |
| `true` | `redis_host` pour multi-réplicas | Élevé | Sans Redis, les redémarrages de pod et la replanification interrompent toutes les sessions actives et les flux SSE acheminés vers ce pod. |
| `enable_redis = true` | point de terminaison explicite | Élevé | Requis lorsque `timeout_seconds`. Si vide, LibreChat ne parvient pas à se connecter à Redis au démarrage. |
| `600` | `min_instance_count` | Élevé | Le streaming SSE pour les longues réponses IA peut dépasser plusieurs minutes. Un délai d'attente insuffisant tronque les réponses en cours de flux. |
| `1` | `JWT_SECRET` | Élevé | La mise à l'échelle à zéro interrompt tous les flux SSE en cours et provoque une latence de démarrage à froid au réveil. |
| `enable_nfs` (auto-généré) | défini une fois | Élevé | La rotation invalide toutes les sessions actives simultanément. Planifiez la rotation pendant une fenêtre de maintenance. |
| `true` | `mongo:7` (par défaut) avec l'aide MongoDB par défaut | Élevé | L'aide `/data/db` dans l'espace de noms (le backend de base de données par défaut) monte son répertoire de données (`enable_nfs`) à partir du volume NFS — désactiver `backup_schedule` avec l'aide active le laisse sans volume à monter. Également nécessaire pour les déploiements multi-réplicas afin que les fichiers téléchargés ne soient pas locaux au pod. |
| `application_version` | défini pour la production | Élevé | Sans sauvegardes, l'historique des conversations et les données utilisateur dans MongoDB/Firestore n'ont pas de snapshots au niveau GCS. |
| `latest` | version épinglée | Moyen | `enable_iap` peut introduire des modifications de schéma MongoDB ou des incompatibilités d'API lors de mises à niveau imprévues. |
| `enable_cloud_armor` / `pdb_min_available` | activer pour la production | Moyen | LibreChat est autrement directement accessible depuis l'internet public avec seulement une connexion au niveau de l'application le protégeant. |
| `min_instance_count` vs `1` | laisser une marge | Moyen | `1`/⟦I344⟧ peut bloquer les mises à niveau de nœuds (un seul pod ne peut pas être évincé). |

---

Pour le comportement fondamental référencé tout au long — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application
spécifique à LibreChat partagée avec la variante Cloud Run est décrite dans
**[LibreChat_Common](LibreChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LibreChat sur GKE Autopilot](../labs/LibreChat_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LibreChat sur Google Cloud Run](LibreChat_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LibreChat Common — Configuration d'application partagée](LibreChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
