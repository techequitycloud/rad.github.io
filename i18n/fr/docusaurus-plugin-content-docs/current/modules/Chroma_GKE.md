---
title: "Chroma sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Chroma sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Chroma_GKE.md @ 15fd4c7 sha256:fe2de1acb744 -->

# Chroma sur GKE Autopilot {#chroma-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chroma_GKE.png" alt="Chroma sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chroma est une base de données vectorielle open source native de l'IA, conçue
spécifiquement pour les embeddings et la recherche de similarité. Elle alimente les
pipelines RAG, la recherche sémantique et les workflows LangChain/LlamaIndex. Ce
module déploie Chroma sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Chroma et sur la manière
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous
référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chroma s'exécute comme une charge de travail de base de données vectorielle
conteneurisée. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods StatefulSet ou Deployment, 1 vCPU / 1 GiB par défaut |
| Persistance des données | StatefulSet PVC (par défaut) ou GCS FUSE | Par défaut, adossé à un PVC ; GCS FUSE uniquement lorsque `stateful_pvc_enabled = false` |
| Stockage d'objets | Cloud Storage | Bucket `<prefix>-data` auto-provisionné ; utilisé comme stockage principal lorsque le PVC n'est pas activé |
| Jeton d'authentification | Secret Manager | Jeton d'API optionnel — `CHROMA_SERVER_AUTHN_CREDENTIALS` injecté à l'exécution |
| Ingress | Cloud Load Balancing | `ClusterIP` par défaut (accès interne au cluster) ; `LoadBalancer` optionnel avec IAP ou jeton d'authentification |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données SQL et pas de Redis.** Chroma gère son propre stockage
  embarqué. Aucune instance Cloud SQL n'est créée et aucune connexion Redis n'est
  configurée.
- **`ClusterIP` par défaut.** Le service n'est accessible qu'à l'intérieur du
  cluster ; la sortie `endpoint_url` n'est pas accessible depuis l'extérieur du
  cluster avec cette valeur par défaut. Ne définissez `service_type = "LoadBalancer"` que si un
  accès externe est nécessaire, et activez `enable_auth_token` ou IAP en même temps.
- **Instance unique recommandée.** `max_instance_count = 1` est la valeur par défaut.
  Plusieurs pods Chroma partageant un seul PVC ne sont pas pris en charge — les
  écritures concurrentes corrompraient les collections.
- **PVC StatefulSet par défaut.** `stateful_pvc_enabled = true` (la valeur par défaut) résout
  automatiquement le type de charge de travail en `StatefulSet` et désactive le
  volume GCS FUSE à `/data` pour éviter un conflit de double montage.
- **Le jeton d'authentification est facultatif mais recommandé** pour tout
  déploiement accessible en dehors de l'espace de noms du pod. Lorsqu'il est activé,
  le jeton est stocké dans Secret Manager et doit être transmis comme `Authorization: Bearer <token>`
  dans chaque appel d'API.
- **Les sondes de santé sont fixées à `/api/v2/heartbeat`.** C'est le seul point
  d'accès de santé exposé par Chroma.
- **La télémétrie anonymisée est toujours désactivée.** `ANONYMIZED_TELEMETRY=false` est
  injecté automatiquement.
- **De nombreuses entrées de base de données/Redis/configuration de build sont
  inertes.** `Chroma_GKE` déclare la surface complète des variables App_GKE
  (base de données, Redis, build de conteneur, quota et autres entrées miroir de la
  fondation) pour la parité `check_conventions.py`, mais la plupart d'entre elles sont
  codées en dur ou ignorées par `Chroma_Common`/`main.tf` — voir la
  [Section 4](#4-configuration-variables) pour la liste complète, par groupe.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de
noms et les autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Chroma {#a-gke-autopilot--the-chroma-workload}

Les pods Chroma sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le déploiement s'exécute en tant que StatefulSet
(lorsqu'il est adossé à un PVC) ou Deployment (lorsqu'il est adossé à GCS FUSE),
avec un autoscaling horizontal des pods gérant le nombre de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Chroma pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'adresse IP du service.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe statefulset -n "$NAMESPACE"    # when using StatefulSet
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Persistance des données — StatefulSet PVC ou GCS FUSE {#b-data-persistence--statefulset-pvc-or-gcs-fuse}

Chroma stocke sa base de données SQLite embarquée, ses fichiers d'index HNSW et
ses métadonnées de collection dans un volume persistant à `/data`. Deux
backends de stockage sont disponibles :

**StatefulSet PVC (par défaut) :** Un PersistentVolumeClaim Kubernetes adossé à
un PD équilibré (`standard-rwo`) ou SSD (`premium-rwo`) est provisionné par pod,
offrant un accès disque local à faible latence pour les lectures et écritures
d'index.

- **Console :** Kubernetes Engine → Stockage → PersistentVolumeClaims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

**GCS FUSE (uniquement lorsque `stateful_pvc_enabled = false`) :** Un bucket Cloud Storage
(`<prefix>-data`) est provisionné et monté à `/data` via le pilote CSI
GCS FUSE.

- **Console :** Cloud Storage → Buckets — recherchez le bucket dont le nom se
  termine par `-data`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/chroma/    # inspect Chroma's on-disk layout
  # Confirm the GCS FUSE mount inside a pod:
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h | grep /data
  ```

Voir [App_GKE](App_GKE.md) pour GCS Fuse, les options CMEK et le
provisionnement de PVC.

### C. Secret Manager {#c-secret-manager}

Lorsque `enable_auth_token = true`, le jeton d'authentification API de Chroma est généré et
stocké en tant que secret Secret Manager. Il est injecté dans les pods à
l'exécution en tant que `CHROMA_SERVER_AUTHN_CREDENTIALS` ; le texte en clair n'apparaît jamais dans
la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the token to configure API clients:
  gcloud secrets versions access latest --secret=<prefix>-auth-token --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le service Chroma est exposé en tant que `ClusterIP`, accessible
uniquement à l'intérieur du cluster. Lorsque `service_type = "LoadBalancer"` est défini, une IP
externe de Cloud Load Balancing est provisionnée. Un domaine personnalisé, une IP
statique et Cloud Armor peuvent être ajoutés en couches.

- **Console :** Kubernetes Engine → Services et Ingress ; Services réseau →
  Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  # Test the Chroma heartbeat from inside the cluster:
  kubectl run -n "$NAMESPACE" --rm -it curl --image=curlimages/curl -- \
    curl http://<cluster-ip>:8000/api/v2/heartbeat
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE vers Cloud
Monitoring. Des tests de disponibilité optionnels contre `/api/v2/heartbeat` et des
politiques d'alerte sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Chroma {#3-chroma-application-behaviour}

- **Pas de bootstrap de base de données.** Chroma gère son propre stockage
  embarqué et ne nécessite aucun job d'initialisation de base de données. Aucun
  job `db-init` n'est injecté. Si vous fournissez des `initialization_jobs`
  personnalisés, ils s'exécutent avant le démarrage de l'application.
- **Chargement de l'index au démarrage.** Lorsque Chroma redémarre (après une
  éviction de pod ou une mise à jour progressive), il charge ses index HNSW à
  partir du PVC ou du bucket GCS. Pour les grandes collections, cela peut prendre
  des dizaines de secondes ; la sonde de démarrage à `/api/v2/heartbeat` attend que
  Chroma signale sa disponibilité.
- **Contrainte d'écriture unique.** Chroma n'a pas de verrouillage distribué sur
  son stockage. L'exécution de plusieurs pods écrivant sur le même PVC ou chemin
  GCS corrompra les collections. Gardez `max_instance_count = 1` à moins que vous n'exécutiez
  un déploiement de cluster Chroma avec un stockage séparé par pod.
- **Utilisation du jeton d'authentification.** Lorsque `enable_auth_token = true`, tous les
  appels d'API doivent inclure `Authorization: Bearer <token>`. Récupérez le jeton de Secret
  Manager, puis utilisez-le avec le client Python :
  ```bash
  # Retrieve token
  TOKEN=$(gcloud secrets versions access latest \
    --secret=<prefix>-auth-token --project "$PROJECT")
  ```
  ```python
  import chromadb
  client = chromadb.HttpClient(
      host="<cluster-ip>", port=8000,
      headers={"Authorization": f"Bearer {TOKEN}"}
  )
  ```
- **Sonde de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/api/v2/heartbeat` avec un délai initial de 15 secondes. Le chemin de la sonde est
  fixé par Chroma_Common et ne peut pas être modifié.
- **Tâches planifiées.** Chroma n'a pas de commandes planifiées intégrées.
  Utilisez `cron_jobs` si vous avez besoin de captures instantanées de
  collection périodiques ou de tâches de maintenance.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Chroma sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` | `Chroma is the AI-native open-source vector database with 18,000+ GitHub stars, purpose-built for embeddings and similarity search. Accelerates AI application development with a production-grade store for RAG pipelines, semantic search, and LangChain/LlamaIndex workflows. Deploy on GKE Autopilot with StatefulSet persistence, GCS Fuse storage, optional token authentication, Workload Identity, Secret Manager, and horizontal auto-scaling.` | La description du module. (par exemple, "Chroma GKE : Déployer la base de données vectorielle Chroma sur GKE Autopilot.") |
| `module_documentation` | `https://docs.radmodules.dev/docs/modules/Chroma_GKE` | L'URL de la documentation du module. |
| `module_dependency` | _(set)_ | Spécifiez les noms des modules dont dépend ce module, dans l'ordre dans lequel ils doivent être déployés. (par exemple, ["Services_GCP"]) |
| `module_services` | _(set)_ | Spécifiez les services du module. |
| `credit_cost` | `75` | Spécifiez le coût du module. (par exemple, 50) |
| `require_credit_purchases` | `false` | Lorsque `true`, les frais de module ne peuvent être payés qu'avec des crédits achetés (abonnement ou recharge), et non avec des crédits offerts ou d'événement. |
| `enable_purge` | `true` | Définissez sur true pour activer la possibilité de purger ce module. |
| `public_access` | `true` | Définissez sur true pour rendre le module disponible à tous les utilisateurs de la plateforme. |
| `require_services_gcp_module` | `true` | Force le déploiement du module Services_GCP avant ce module. Si true, le déploiement échoue au moment de la planification avec une erreur claire si aucun réseau VPC géré par Services_GCP n'est détecté dans le projet. Définissez sur false pour autoriser un déploiement autonome avec des ressources prérequises intégrées. |
| `resource_creator_identity` | `rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com` | Le compte de service utilisé par Terraform pour créer des ressources dans le projet de destination. (par exemple, "rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com") |
| `shared_users` | _(set)_ | Liste des utilisateurs qui peuvent afficher et déployer ce module, quel que soit le paramètre public_access. Saisissez une ou plusieurs adresses e-mail d'utilisateur. Métadonnées uniquement. |
| `technical_support_users` | _(set)_ | Liste des utilisateurs responsables de la fourniture du support technique pour ce module. Saisissez une ou plusieurs adresses e-mail d'utilisateur. Le portail de déploiement achemine les demandes de support pour ce module vers ces utilisateurs. Métadonnées uniquement. |
| `impersonation_service_account` | `` | Adresse e-mail du compte de service à emprunter lors de l'appel d'API GCP à partir de scripts shell. Laissez vide pour utiliser les propres identifiants de l'exécuteur. (par exemple, 'deployer@my-project.iam.gserviceaccount.com') |
| `job_execution_wait_timeout` | `900` | Nombre maximal de secondes pendant lesquelles un déploiement attend la fin du job de configuration de la base de données (db-create) avant d'avorter, de sorte qu'un job bloqué échoue rapidement au apply au lieu de rester bloqué jusqu'à l'expiration du build. Définissez-le au moins sur la durée d'exécution du job plus une marge. |
| `explicit_secret_values` | _(set)_ | Valeurs sensibles brutes à injecter directement dans les secrets Kubernetes, en contournant les lectures de source de données Secret Manager. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `scripts_dir` | `` | Chemin d'accès au répertoire des scripts d'initialisation. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `requires_services` | _(set)_ | Mappage explicite des ressources provisionnées par Services_GCP dont ce module a besoin, indépendamment des valeurs par défaut actuelles des variables de Services_GCP. La plateforme lit ce mappage (pas module_services, qui est une liste lisible par l'homme pour l'interface utilisateur de confirmation de déploiement) pour décider quels commutateurs create_* de Services_GCP doivent être activés lors du provisionnement automatique ou de la mise à jour du déploiement Services_GCP partagé pour le projet de destination. Les clés reflètent les noms de variables booléennes de Services_GCP 1:1. create_redis et create_filestore_nfs doivent rester false pour le chemin de déploiement automatisé : la VM NFS+Redis Compute Engine gratuite (create_network_filesystem) est ce que chaque déploiement automatisé obtient ; le passage à Cloud Memorystore/Filestore géré est une optimisation manuelle post-déploiement, jamais quelque chose qu'une chaîne de dépendance automatisée devrait demander seule. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Sélectionnez un projet existant sur la plateforme RAD ou entrez l'ID du projet d'un projet GCP externe. Vous devez accorder le rôle Propriétaire au compte de service de l'agent du projet GCP RAD lors du déploiement dans un projet externe. (par exemple, 'my-project-123') |
| `tenant_id` | `demo` | Spécifiez un identifiant de locataire ou de déploiement unique. Cela identifie de manière unique votre déploiement d'application et est utilisé dans la dénomination des ressources (1 à 7 caractères alphanumériques en minuscules, pas de tirets — la limite de 7 caractères provient de la limite de 30 caractères de l'ID de compte de service de GCP). |
| `region` | `us-central1` | Région GCP pour le déploiement des ressources (par exemple, 'us-central1'). Utilisée comme solution de repli lorsque la découverte du réseau ne peut pas déterminer la région à partir des sous-réseaux VPC existants. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | _(set)_ | Adresses e-mail des utilisateurs auxquels sera accordé l'accès au projet Google Cloud, aux alertes de surveillance et aux notifications (par exemple, ['admin@example.com', 'ops@example.com']). |
| `resource_labels` | _(set)_ | Étiquettes clé-valeur appliquées à toutes les ressources créées par ce module. Utilisez-les pour appliquer des politiques de balisage organisationnelles telles que le centre de coûts, l'environnement ou la propriété de l'équipe. (par exemple, `{ env = "prod", team = "engineering" }`) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chroma` | Nom de l'application utilisé dans la dénomination des ressources. Doit commencer par une lettre et ne contenir que des lettres minuscules, des chiffres et des tirets (1 à 20 caractères). (par exemple, "chroma") |
| `application_display_name` | `Chroma Vector Database` | Nom de l'application lisible par l'homme à des fins d'affichage. (par exemple, "Base de données vectorielle Chroma") |
| `application_description` | `Chroma Vector Database on GKE Autopilot` | Brève description de l'objectif de l'application. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `description` | `Chroma — the AI-native open-source vector database for embeddings and similarity search` | Brève description de l'objectif du déploiement Chroma. Renseigne la description de la charge de travail GKE et la documentation de la plateforme. (par exemple, 'Base de données vectorielle Chroma pour les applications d'IA') |
| `application_version` | `latest` | Tag de version de l'image Docker Chroma. Utilisez 'latest' pour la version stable la plus récente, ou épinglez à une version spécifique pour des déploiements reproductibles. (par exemple, 'latest', '0.5.0') |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez sur true pour déployer l'infrastructure de l'application. Si false, seules les ressources partagées (secrets, stockage, IAM) sont créées sans déployer la charge de travail GKE réelle. |
| `container_image_source` | `custom` | Détermine la source de l'image conteneur. Utilisez 'prebuilt' pour déployer directement une URI d'image existante, ou 'custom' pour construire l'image à partir de la source. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `container_image` | `` | URI de l'image. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `container_build_config` | _(set)_ | Configuration de build. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `enable_image_mirroring` | `true` | Miroite l'image conteneur Chroma dans Artifact Registry avant le déploiement. Recommandé pour éviter les limites de débit de Docker Hub et améliorer la fiabilité du pull dans les environnements de production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods à maintenir en permanence. Pour Chroma, définissez au moins sur 1 pour éviter les démarrages à froid. Doit être inférieur ou égal à max_instance_count. (par exemple, 1) |
| `max_instance_count` | `1` | Nombre maximal de réplicas de pods autorisés à s'exécuter simultanément. Pour Chroma sans mode distribué, 1 est typique. Doit être supérieur ou égal à min_instance_count. (par exemple, 1) |
| `enable_vertical_pod_autoscaling` | `false` | Active l'autoscaling vertical des pods (VPA). Lorsqu'il est activé, l'HPA basé sur le CPU/Mémoire est désactivé pour éviter les conflits. Le VPA optimise automatiquement les demandes de ressources. (par exemple, false) |
| `container_port` | `8000` | Port TCP sur lequel le conteneur Chroma écoute. Pour Chroma, c'est toujours 8000 (défini via Chroma_Common) ; cette variable n'est pas transmise à App_GKE et n'a aucun effet. |
| `container_protocol` | `http1` | Version du protocole HTTP utilisée par le backend du service Kubernetes. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `container_resources` | _(set)_ | Limites CPU/Mémoire pour le conteneur Chroma. Remarque : utilisez les variables cpu_limit et memory_limit pour définir les ressources du conteneur — cet objet structuré est accepté pour la compatibilité de l'interface utilisateur mais ne remplace pas cpu_limit/memory_limit. |
| `timeout_seconds` | `300` | Délai d'expiration de la requête en secondes (0-3600). Temps maximal qu'une requête peut prendre. (par exemple, 300) |
| `enable_cloudsql_volume` | `false` | Injecte un conteneur sidecar Cloud SQL Auth Proxy dans le pod GKE. Chroma n'utilise pas Cloud SQL — cela doit rester false à moins que vous n'exécutiez un sidecar personnalisé à côté de Chroma. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de montage du socket Cloud SQL Auth Proxy. Non référencé — Chroma n'a pas de base de données Cloud SQL. |
| `service_annotations` | _(set)_ | Annotations personnalisées appliquées à la ressource de service Kubernetes. (par exemple, `{ "cloud.google.com/neg" = "{\\"ingress\\": true}" }`) |
| `service_labels` | _(set)_ | Étiquettes personnalisées appliquées spécifiquement à la ressource de service Kubernetes. (par exemple, `{ category = "production", tier = "database" }`) |
| `cloud_sql_proxy_version` | `2-alpine` | Tag d'image Cloud SQL Auth Proxy. Non applicable — Chroma n'a pas de base de données Cloud SQL. |
| `cpu_limit` | `1000m` | Limite CPU allouée au conteneur Chroma. (par exemple, '1000m', '2000m') |
| `memory_limit` | `1Gi` | Limite de mémoire allouée au conteneur Chroma. Chroma charge les index d'embedding en mémoire ; dimensionnez-le en fonction de vos collections. (par exemple, '1Gi', '4Gi') |
| `enable_auth_token` | `false` | Génère un jeton d'authentification aléatoire et le stocke dans Secret Manager. Si true, Chroma est démarré avec CHROMA_SERVER_AUTHN_CREDENTIALS et CHROMA_SERVER_AUTHN_PROVIDER définis de sorte que tous les appels d'API nécessitent le jeton. Recommandé pour tout déploiement accessible en dehors du pod/namespace. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | _(set)_ | Variables d'environnement statiques pour le conteneur Chroma sous forme de paires clé-valeur. (par exemple, `{ CHROMA_LOG_CONFIG_FILE = "/chroma/log_config.yml" }`) |
| `secret_environment_variables` | _(set)_ | Variables d'environnement de Secret Manager. Mappez le nom de la variable d'environnement au nom du secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Calendrier de rotation des secrets. (par exemple, '2592000s' pour 30 jours) |
| `secret_propagation_delay` | `30` | Temps en secondes à attendre après la création ou la mise à jour d'un secret avant de poursuivre les opérations dépendantes. (par exemple, 30) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `` | Nom du cluster GKE dans lequel déployer. Laissez vide pour une découverte automatique. (par exemple, 'gke-cluster-1') |
| `prereq_gke_subnet_cidr` | `10.201.0.0/24` | Plage CIDR pour le sous-réseau GKE intégré. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `gke_cluster_selection_mode` | `primary` | Stratégie de choix du cluster GKE cible. (par exemple, 'primary') |
| `prereq_subnet_cidr_override` | `` | Remplacement pour le CIDR du sous-réseau primaire VPC intégré. |
| `namespace_name` | `` | Espace de noms Kubernetes pour le déploiement. Laissez vide pour une génération automatique à partir de application_name et tenant_id. (par exemple, 'chroma-prod') |
| `prereq_gke_pod_cidr_override` | `` | Remplacement pour le CIDR de la plage secondaire des pods GKE intégrés. |
| `prereq_gke_service_cidr_override` | `` | Remplacement pour le CIDR de la plage secondaire des services GKE intégrés. |
| `workload_type` | `null` | Type de charge de travail Kubernetes. Utilisez 'StatefulSet' (recommandé pour Chroma) pour une identité de pod stable et des redémarrages ordonnés, ou 'Deployment' pour un fonctionnement sans état avec un stockage adossé à GCS. (par exemple, 'Deployment' ou 'StatefulSet') |
| `service_type` | `ClusterIP` | Type de service Kubernetes. Gardez 'ClusterIP' (par défaut) afin que Chroma ne soit accessible qu'à l'intérieur du cluster — la sortie api_url n'est pas accessible depuis l'extérieur du cluster avec ce paramètre. Définissez 'LoadBalancer' uniquement si un accès externe est nécessaire, et activez IAP ou enable_auth_token en même temps. |
| `session_affinity` | `None` | Mode d'affinité de session pour le service Kubernetes. (par exemple, 'None' ou 'ClientIP') |
| `enable_multi_cluster_service` | `false` | Active les services multi-clusters (MCS) pour l'application. Non référencé — la définition de cette variable n'a aucun effet. |
| `extra_service_ports` | _(set)_ | Ports supplémentaires à exposer sur le service Kubernetes, pour une charge de travail qui utilise plus d'un protocole sur le même pod. Reflète la variable App_GKE pour satisfaire les vérifications de convention ; déclarée mais NON transmise par ce module, donc sa définition n'a aucun effet ici. Par défaut, une liste vide, ce qui rend exactement le service que ce module rendait auparavant. |
| `configure_service_mesh` | `false` | Active l'injection du maillage de services Istio pour l'espace de noms de l'application. Nécessite l'installation de Cloud Service Mesh ou Anthos Service Mesh sur le cluster. |
| `enable_network_segmentation` | `false` | Active les NetworkPolicies Kubernetes pour la micro-segmentation. (par exemple, false) |
| `termination_grace_period_seconds` | `60` | Secondes pendant lesquelles Kubernetes attend après SIGTERM avant de terminer de force. Augmentez pour permettre à Chroma de vider les écritures en cours. Plage valide : 0–3600. (par exemple, 60) |
| `deployment_timeout` | `1800` | Nombre maximal de secondes pendant lesquelles Terraform attend la fin du déploiement Kubernetes. (par exemple, 1800) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 7 — Configuration StatefulSet {#group-7--statefulset-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Active la revendication de volume persistant (PVC) pour StatefulSet. Recommandé pour Chroma afin d'éviter la surcharge d'E/S de GCS FUSE pour les grandes collections. Si true sans workload_type explicite, se résout automatiquement en 'StatefulSet'. (par exemple, false) |
| `stateful_pvc_size` | `20Gi` | Taille de stockage pour chaque PVC provisionné par le StatefulSet. Dimensionnez le PVC pour contenir toutes les collections Chroma plus les frais généraux. (par exemple, '20Gi', '50Gi') |
| `stateful_pvc_mount_path` | `/data` | Chemin du système de fichiers à l'intérieur du conteneur Chroma où le PVC par pod est monté. (par exemple, '/data') |
| `stateful_pvc_storage_class` | `standard-rwo` | Classe de stockage Kubernetes pour les PVC StatefulSet. 'standard-rwo' (PD équilibré) est la valeur par défaut pour GKE Autopilot. Utilisez 'premium-rwo' pour des IOPS plus élevées. (par exemple, 'standard-rwo', 'premium-rwo') |
| `stateful_headless_service` | `null` | Crée un service sans tête pour le StatefulSet afin d'activer des identités réseau stables. (par exemple, true) |
| `stateful_pod_management_policy` | `null` | Contrôle l'ordre dans lequel les pods sont créés et supprimés. 'OrderedReady' est requis pour des redémarrages Chroma sûrs. (par exemple, 'OrderedReady' ou 'Parallel') |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour pour le StatefulSet. Utilisez 'RollingUpdate' pour des mises à jour sans interruption de service. (par exemple, 'RollingUpdate' ou 'OnDelete') |
| `stateful_fs_group` | `1000` | GID défini comme fsGroup au niveau du pod dans le contexte de sécurité du StatefulSet. Garantit que le PVC est inscriptible par le groupe. Définissez sur 0 pour laisser fsGroup non défini. (par exemple, 1000) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans l'espace de noms de l'application. |
| `quota_cpu_requests` | `` | Quota total de requêtes CPU pour l'espace de noms. Non référencé — la définition de cette variable n'a aucun effet. |
| `quota_cpu_limits` | `` | Quota total de limites CPU pour l'espace de noms. Non référencé — la définition de cette variable n'a aucun effet. |
| `quota_memory_requests` | `` | Quota total de requêtes mémoire pour l'espace de noms (par exemple, '4Gi'). Doit utiliser des suffixes d'unité binaire tels que 'Gi' ou 'Mi' — les entiers nus sont traités comme des octets par Kubernetes et bloqueront toute planification de pod. |
| `quota_memory_limits` | `` | Quota total de limites mémoire pour l'espace de noms (par exemple, '8Gi'). Doit utiliser des suffixes d'unité binaire tels que 'Gi' ou 'Mi' — les entiers nus sont traités comme des octets par Kubernetes et bloqueront toute planification de pod. |
| `quota_max_pods` | `` | Nombre maximal de pods dans l'espace de noms. Non référencé — la définition de cette variable n'a aucun effet. |
| `quota_max_services` | `` | Nombre maximal de services dans l'espace de noms. Non référencé — la définition de cette variable n'a aucun effet. |
| `quota_max_pvcs` | `` | Nombre maximal de PVC dans l'espace de noms. Non référencé — la définition de cette variable n'a aucun effet. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Crée un PodDisruptionBudget Kubernetes pour limiter l'indisponibilité des pods lors de perturbations volontaires. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors de perturbations volontaires. (par exemple, '1') |
| `enable_topology_spread` | `false` | Ajoute des TopologySpreadConstraints Kubernetes. Non référencé — la définition de cette variable n'a aucun effet. |
| `topology_spread_strict` | `false` | Contrôle le comportement whenUnsatisfiable de la contrainte de répartition topologique. Non référencé — la définition de cette variable n'a aucun effet. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | _(set)_ | Configuration pour la sonde de démarrage Kubernetes. Chroma expose /api/v2/heartbeat. Exemple : `{ enabled = true, type = "HTTP", path = "/api/v2/heartbeat", initial_delay_seconds = 15, timeout_seconds = 5, period_seconds = 10, failure_threshold = 10 }`. |
| `health_check_config` | _(set)_ | Configuration pour la sonde de vivacité Kubernetes. Utilise /api/v2/heartbeat (point d'accès de santé de Chroma). Exemple : `{ enabled = true, type = "HTTP", path = "/api/v2/heartbeat", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }`. |
| `uptime_check_config` | _(set)_ | Configuration du test de disponibilité. Surveille la disponibilité du service. Exemple : `{ enabled = true, path = "/api/v2/heartbeat", check_interval = "60s", timeout = "10s" }`. |
| `alert_policies` | _(set)_ | Politiques d'alerte personnalisées pour Cloud Monitoring. |
| `startup_probe` | _(set)_ | Configuration de la sonde de démarrage. Chroma expose /api/v2/heartbeat une fois entièrement prêt à servir les requêtes. Exemple : `{ enabled = true, type = "HTTP", path = "/api/v2/heartbeat", initial_delay_seconds = 15, timeout_seconds = 5, period_seconds = 10, failure_threshold = 10 }`. |
| `liveness_probe` | _(set)_ | Configuration de la sonde de vivacité. Utilise /api/v2/heartbeat (point d'accès de santé de Chroma). Exemple : `{ enabled = true, type = "HTTP", path = "/api/v2/heartbeat", initial_delay_seconds = 30, timeout_seconds = 5, period_seconds = 30, failure_threshold = 3 }`. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | _(set)_ | Jobs Kubernetes pour les tâches d'initialisation. Chroma ne nécessite aucune initialisation par défaut ; ne fournissez des jobs que pour le chargement de données personnalisées ou les tâches de migration. |
| `cron_jobs` | _(set)_ | Liste des CronJobs à déployer avec Chroma (par exemple, pour les instantanés de collection ou les tâches de maintenance). |
| `additional_services` | _(set)_ | Liste des services Kubernetes supplémentaires à déployer avec Chroma (par exemple, sidecars, services d'aide). |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 12 — CI/CD, Binary Authorization et Cloud Deploy {#group-12--cicd-binary-authorization--cloud-deploy}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cicd_trigger` | `false` | Active le déclencheur Cloud Build automatisé pour le CI/CD. (par exemple, false) |
| `github_repository_url` | `` | URL du dépôt GitHub pour le CI/CD automatisé (par exemple, 'https://github.com/username/repo'). |
| `github_token` | `` | Jeton d'accès personnel (PAT) GitHub. Requis lorsque enable_cicd_trigger est true. |
| `github_app_installation_id` | `` | ID d'installation de l'application GitHub. |
| `cicd_trigger_config` | _(set)_ | Configuration du déclencheur Cloud Build pour le pipeline CI/CD automatisé. Exemple : `{ branch_pattern = "^main$", included_files = [], ignored_files = [], trigger_name = null, description = "Automated build and deployment trigger", substitutions = { } }`. |
| `enable_cloud_deploy` | `false` | Active Google Cloud Deploy pour un pipeline de promotion géré Dev → Staging → Prod. Nécessite enable_cicd_trigger = true. |
| `cloud_deploy_stages` | _(set)_ | Liste ordonnée des étapes du pipeline Cloud Deploy. |
| `enable_binary_authorization` | `false` | Active Binary Authorization pour ce déploiement. (par exemple, false) |
| `binauthz_evaluation_mode` | `ALWAYS_ALLOW` | Mode d'application de Binary Authorization. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Provisionne une instance Cloud Filestore (NFS) et la monte dans le pod GKE en tant que volume persistant partagé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin du système de fichiers à l'intérieur du conteneur où le volume NFS est monté. (par exemple, '/mnt/nfs') |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume pour le montage NFS. (par exemple, 'nfs-data-volume') |
| `nfs_instance_name` | `` | Nom d'une VM NFS GCE existante à utiliser. Laissez vide pour une découverte automatique. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour la VM NFS GCE intégrée. (par exemple, 'app-nfs') |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Contrôle si le module provisionne les buckets GCS définis dans storage_buckets. |
| `storage_buckets` | _(set)_ | Buckets Cloud Storage à créer en plus du bucket de données Chroma. |
| `gcs_volumes` | _(set)_ | Montages de volume GCS FUSE via le pilote CSI. Le bucket de données Chroma est automatiquement ajouté ; utilisez ceci pour des volumes supplémentaires. |
| `manage_storage_kms_iam` | `false` | Si true, crée un trousseau de clés KMS CMEK et une clé de chiffrement de stockage. |
| `enable_artifact_registry_cmek` | `false` | Si true, active le chiffrement CMEK des images conteneurs dans Artifact Registry. |
| `max_images_to_retain` | `7` | Nombre maximal d'images conteneurs récentes à conserver dans Artifact Registry. Définissez sur 0 pour désactiver. (par exemple, 7) |
| `delete_untagged_images` | `true` | Supprime automatiquement les images conteneurs non taguées d'Artifact Registry. (par exemple, true) |
| `image_retention_days` | `30` | Jours après lesquels les images conteneurs sont éligibles à la suppression. Définissez sur 0 pour désactiver. (par exemple, 30) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 15 — Redis (transmis, non applicable à Chroma) {#group-15--redis-forwarded-not-applicable-to-chroma}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active la configuration Redis pour l'application en injectant les variables d'environnement REDIS_HOST et REDIS_PORT dans le déploiement GKE. Si true et redis_host est laissé vide, le module utilise par défaut l'IP du serveur NFS comme hôte Redis. Définissez redis_host explicitement pour vous connecter à une instance Redis dédiée telle que Memorystore. |
| `redis_host` | `` | Nom d'hôte ou adresse IP du serveur Redis injecté comme variable d'environnement REDIS_HOST. Utilisé uniquement lorsque enable_redis est true. Laissez vide pour utiliser par défaut l'adresse IP du serveur NFS. (par exemple, '10.0.0.5', 'redis.internal.example.com') |
| `redis_port` | `6379` | Port TCP du serveur Redis injecté comme variable d'environnement REDIS_PORT. Utilisé uniquement lorsque enable_redis est true. (par exemple, '6379') |
| `redis_auth` | `` | Mot de passe d'authentification Redis. Non applicable à Chroma. Transmis au module de fondation pour compatibilité. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 16 — Configuration de la base de données (transmis, non applicable à Chroma) {#group-16--database-configuration-forwarded-not-applicable-to-chroma}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Moteur de base de données Cloud SQL. Non référencé — Chroma n'a pas de base de données SQL ; le database_type est fixé à NONE par Chroma_Common. |
| `sql_instance_name` | `` | Nom d'une instance Cloud SQL existante. Non référencé — Chroma n'a pas de base de données SQL. |
| `sql_instance_base_name` | `app-sql` | Nom de base pour l'instance Cloud SQL intégrée. Non référencé — Chroma n'a pas de base de données SQL. |
| `application_database_name` | `gkeappdb` | Nom de la base de données à créer dans l'instance Cloud SQL. Injecté dans l'application en tant que variable d'environnement DB_NAME. Utilisé uniquement lorsque database_type n'est pas 'NONE'. (par exemple, 'app_db', 'crm_production') |
| `application_database_user` | `gkeappuser` | Nom d'utilisateur de la base de données créé pour l'application. Injecté dans l'application en tant que variable d'environnement DB_USER. Utilisé uniquement lorsque database_type n'est pas 'NONE'. (par exemple, 'app_user', 'crm_svc') |
| `database_password_length` | `32` | Longueur du mot de passe de la base de données généré aléatoirement. Non référencé — Chroma n'a pas de base de données SQL. Transmis à la fondation pour compatibilité. (par exemple, 32) |
| `enable_postgres_extensions` | `false` | Active les extensions PostgreSQL. Non référencé — Chroma n'a pas de base de données SQL. |
| `postgres_extensions` | _(set)_ | Extensions PostgreSQL à installer. Non référencé — Chroma n'a pas de base de données SQL. |
| `enable_mysql_plugins` | `false` | Active les plugins MySQL. Non référencé — Chroma n'a pas de base de données SQL. (par exemple, false) |
| `mysql_plugins` | _(set)_ | Liste des plugins MySQL à installer. Non référencé — Chroma n'a pas de base de données SQL. |
| `enable_auto_password_rotation` | `false` | Active la rotation automatique du mot de passe de la base de données. Non applicable — Chroma n'a pas de base de données SQL. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après un événement de rotation du mot de passe de la base de données. Non applicable — Chroma n'a pas de base de données SQL. |
| `db_password_env_var_name` | `` | Variable d'environnement supplémentaire pour exposer le mot de passe de la base de données. Non applicable — Chroma n'a pas de base de données SQL. |
| `db_host_env_var_name` | `` | Nom de variable d'environnement supplémentaire pour exposer l'hôte de la base de données à côté du DB_HOST standard. Laissez vide pour injecter uniquement DB_HOST. (par exemple, 'DB_HOSTNAME') |
| `db_user_env_var_name` | `` | Nom de variable d'environnement supplémentaire pour exposer l'utilisateur de la base de données à côté du DB_USER standard. Laissez vide pour injecter uniquement DB_USER. (par exemple, 'DB_USERNAME') |
| `db_name_env_var_name` | `` | Nom de variable d'environnement supplémentaire pour exposer le nom de la base de données à côté du DB_NAME standard. Laissez vide pour injecter uniquement DB_NAME. (par exemple, 'DB_DATABASE') |
| `db_port_env_var_name` | `` | Nom de variable d'environnement supplémentaire pour exposer le port de la base de données à côté du DB_PORT standard. Laissez vide pour injecter uniquement DB_PORT. (par exemple, 'DB_PORT_NUMBER') |
| `db_name` | `chromadb` | Non référencé — Chroma n'a pas de base de données SQL. Transmis au module de fondation pour compatibilité. |
| `db_user` | `chromauser` | Non référencé — Chroma n'a pas de base de données SQL. Transmis au module de fondation pour compatibilité. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Calendrier Cron pour les sauvegardes automatisées (par exemple, '0 2 * * *' pour tous les jours à 2h du matin). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Nombre de jours de rétention des fichiers de sauvegarde dans le bucket de sauvegarde GCS. (par exemple, 7) |
| `enable_backup_import` | `false` | Active l'importation automatique d'une sauvegarde lors du déploiement. (par exemple, false) |
| `backup_source` | `gcs` | Source de la sauvegarde : 'gdrive' ou 'gcs'. (par exemple, 'gcs') |
| `backup_file` | `backup.tar` | Nom du fichier de sauvegarde à importer. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `backup_uri` | `` | URI de la sauvegarde. Pour GCS : URI complet comme 'gs://bucket/path/backup.tar'. Pour Google Drive : ID de fichier. |
| `backup_format` | `tar` | Format du fichier de sauvegarde. (par exemple, 'tar') |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 18 — Scripts SQL personnalisés (non applicable à Chroma) {#group-18--custom-sql-scripts-not-applicable-to-chroma}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` | `false` | Active l'exécution de scripts SQL personnalisés à partir de GCS pendant l'initialisation. Non applicable à Chroma (pas de base de données SQL). (par exemple, false) |
| `custom_sql_scripts_bucket` | `` | Nom du bucket GCS contenant les scripts SQL personnalisés. Non applicable à Chroma. |
| `custom_sql_scripts_path` | `` | Préfixe de chemin dans le bucket GCS pour les scripts SQL. Non applicable à Chroma. |
| `custom_sql_scripts_use_root` | `false` | Exécute les scripts SQL personnalisés en tant qu'utilisateur root de la base de données. Non applicable à Chroma. (par exemple, false) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Active la configuration de domaine personnalisé via l'API Gateway Kubernetes avec des certificats SSL. (par exemple, false) |
| `application_domains` | _(set)_ | Liste des domaines personnalisés pour l'application (par exemple, ['chroma.example.com']). |
| `reserve_static_ip` | `true` | Réserve une IP externe statique. Recommandé pour la production. |
| `static_ip_name` | `` | Nom de l'IP statique réservée. Laissez vide pour une génération automatique. |
| `network_tags` | _(set)_ | Tags réseau appliqués aux nœuds GKE. Le tag 'nfsserver' est requis lorsque enable_nfs est true. (par exemple, ['allow-ingress', 'nfsserver']) |
| `network_name` | `` | Nom du réseau VPC à utiliser. Laissez vide pour une découverte automatique. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |
| `gateway_backend_stage` | `dev` | Étape Cloud Deploy dont le service est ciblé par la Gateway HTTPRoute. Pertinent uniquement lorsque enable_cloud_deploy est true. (par exemple, 'dev') |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active le proxy conscient de l'identité (IAP) pour l'authentification via la passerelle Kubernetes. Requis lorsque service_type est 'LoadBalancer' pour empêcher l'accès externe non authentifié à l'API Chroma. Nécessite que enable_custom_domain ou enable_cdn soit true. (par exemple, false) |
| `iap_authorized_users` | _(set)_ | Liste des e-mails d'utilisateurs autorisés à accéder via IAP (par exemple, ['user:alice@example.com']). |
| `iap_authorized_groups` | _(set)_ | Liste des groupes Google autorisés à accéder via IAP (par exemple, ['group:engineering@example.com']). |
| `iap_oauth_client_id` | `` | ID client OAuth pour IAP. Requis lorsque enable_iap est true. |
| `iap_oauth_client_secret` | `` | Secret client OAuth pour IAP. Requis lorsque enable_iap est true. |
| `iap_support_email` | `` | E-mail de support pour l'écran de consentement OAuth IAP. Non référencé — la définition de cette variable n'a aucun effet sur le déploiement dans ce module d'application. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique de sécurité Cloud Armor au backend Ingress GKE. Nécessite que enable_custom_domain soit true ou que service_type soit 'LoadBalancer'. |
| `admin_ip_ranges` | _(set)_ | Plages CIDR d'administration autorisées pour l'accès privilégié. (par exemple, ['203.0.113.0/24']) |
| `cloud_armor_policy_name` | `default-waf-policy` | Le nom de la politique de sécurité Cloud Armor à appliquer. (par exemple, "default-waf-policy") |
| `enable_cdn` | `false` | Active Cloud CDN via GCPBackendPolicy. (par exemple, false) |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Active l'application du périmètre VPC Service Controls. |
| `vpc_cidr_ranges` | _(set)_ | Plages CIDR de sous-réseau VPC pour le niveau d'accès réseau VPC-SC. |
| `vpc_sc_dry_run` | `true` | Si true, les violations VPC-SC sont journalisées mais non bloquées. |
| `organization_id` | `` | ID d'organisation GCP pour la politique Access Context Manager VPC-SC. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud détaillés pour tous les services GCP pris en charge. |

Toutes les autres entrées de ce groupe suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à chaque étape (Cloud Deploy). |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `endpoint_url` | Point de terminaison de l'API REST Chroma (`<service-url>:8000`). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés. |
| `statefulset_name` | Nom du StatefulSet (lors de l'utilisation d'un stockage adossé à un PVC). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt(e). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_auth_token` | `true` pour tout déploiement accessible de l'extérieur | Critique | Sans jeton, tout appelant pouvant atteindre l'API Chroma peut lire, écrire ou supprimer toutes les collections. |
| `stateful_pvc_enabled` | `true` pour la production | Élevé | Sans PVC, Chroma stocke les données dans le système de fichiers éphémère du conteneur. Un redémarrage du pod efface toutes les collections et tous les vecteurs. |
| `stateful_pvc_mount_path` | `/data` | Critique | Si le chemin de montage ne correspond pas au répertoire de stockage de Chroma, les données sont écrites dans la couche éphémère et perdues silencieusement au redémarrage. |
| `stateful_pvc_size` | `20Gi` (taille généreusement) | Élevé | Un PVC plein provoque le crash de Chroma avec des erreurs de disque plein. La capacité du PVC ne peut pas être réduite après le provisionnement. |
| `max_instance_count` | `1` | Élevé | Plusieurs pods Chroma sur le même stockage corrompront les collections — Chroma n'a pas de verrou d'écriture distribué. |
| `memory_limit` | `4Gi`+ pour la production | Élevé | Chroma charge les index HNSW en mémoire. Le `1Gi` par défaut ne prend en charge que de très petites collections ; les OOM kills interrompent les requêtes en cours. |
| `workload_type` | défini par `stateful_pvc_enabled` | Élevé | La définition explicite de `"Deployment"` en même temps que `stateful_pvc_enabled = true` échoue au moment de la planification. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod. |
| `application_version` | épingler à une balise spécifique | Moyen | L'utilisation de `latest` rend les déploiements non reproductibles. Les formats de données Chroma peuvent changer entre les versions majeures. |
| `iap_oauth_client_id` / `_secret` | définir avant d'activer IAP | Élevé | La définition de `enable_iap = true` sans identifiants OAuth valides bloque tout le trafic. |
| `enable_iap` / `enable_cloud_armor` | activer pour les services accessibles de l'extérieur | Élevé | Sans authentification, un point de terminaison Chroma exposé de l'extérieur est entièrement ouvert. |
| `backup_retention_days` | augmenter pour la production | Moyen | Trop court pour la reprise après sinistre ; les instantanés GCS ou PVC réguliers sont la principale voie de récupération. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro entraîne la suppression du pod ; après la mise à l'échelle, Chroma doit recharger les index à partir du PVC ou de GCS, ce qui ajoute de la latence au démarrage. |
| `database_type` / `sql_instance_name` / `application_database_name`\_`user` / `redis_host`\_`port`\_`auth` | laisser par défaut | Faible | Ces entrées du groupe 15/16 sont transmises à `App_GKE` uniquement pour la parité des conventions ; `Chroma_Common` corrige `database_type = "NONE"` et `main.tf` code en dur `enable_redis = false`, donc les modifier n'a aucun effet. |
| `container_image_source` / `container_protocol` / `container_build_config` | laisser par défaut | Faible | Non référencé par ce module — la source de l'image, la build et le protocole sont fixés par `Chroma_Common`. Les modifier n'a aucun effet. |

---

Pour le comportement de base référencé partout — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Chroma partagée avec la
variante Cloud Run est décrite dans **[Chroma_Common](Chroma_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Chroma sur GKE Autopilot](../labs/Chroma_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Chroma sur Google Cloud Run](Chroma_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chroma Common — Configuration d'application partagée](Chroma_Common.md) — la configuration partagée par les deux cibles de déploiement.
