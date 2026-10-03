---
title: "AFFiNE sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'AFFiNE sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Affine_GKE.md @ 15fd4c7 sha256:c4ea5490d858 -->

# AFFiNE sur GKE Autopilot {#affine-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Affine_GKE.png" alt="AFFiNE sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

AFFiNE est une base de connaissances open-source, axée sur la confidentialité,
qui unifie les documents, les tableaux blancs et les bases de données dans un
seul espace de travail — une alternative auto-hébergeable à Notion et Miro. Ce
module déploie AFFiNE sur **GKE Autopilot** comme une fine couche au-dessus de
la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud qu'AFFiNE utilise et comment les
explorer et les opérer depuis la Google Cloud Console et la ligne de commande.
Pour les mécanismes communs à chaque application GKE — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et le cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

AFFiNE fonctionne comme un serveur auto-hébergé Node.js unique. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de serveur Node.js sur le port 3010, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` |
| Collaboration en temps réel | Redis (co-hébergé sur la VM NFS partagée) | Pub/sub de synchronisation de documents Yjs et la file d'attente des jobs en arrière-plan |
| Persistance des fichiers | Cloud Filestore (NFS) | Les blobs téléchargés persistent sous `/root/.affine/storage`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement (sauvegardes/stockage auxiliaire) |
| Secrets | Secret Manager | Seulement le mot de passe de base de données auto-généré — la propre clé de signature d'AFFiNE réside dans PostgreSQL |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15`
  et `Affine_Common` fixe le moteur quoi qu'il arrive — les autres moteurs ne
  sont pas pris en charge.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur la boucle locale, pas
  une socket.** `enable_cloudsql_volume = true` exécute un sidecar cloud-sql-proxy
  écoutant sur `127.0.0.1:5432` (le modèle GKE) — c'est différent de la
  variante Cloud Run, qui monte une socket Unix. Le point d'entrée cloud
  résout l'hôte de la boucle locale et définit `sslmode=disable` pour celui-ci ;
  une vraie IP privée (Cloud Run) obtient `sslmode=require` à la place.
- **Redis est requis, pas optionnel.** `enable_redis = true` par défaut ; la
  VM NFS partagée co-héberge également Redis, donc la description indique
  explicitement de conserver `enable_nfs = true` à moins qu'un `redis_host`
  externe ne soit fourni. Sans Redis, la synchronisation de documents en temps
  réel et la file d'attente des jobs ne fonctionnent pas.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à
  `/root/.affine/storage`) afin que les blobs téléchargés persistent et puissent être
  partagés entre les pods — et parce qu'il héberge l'instance Redis dont
  l'application dépend.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un
  client atteignent le même pod.
- **Pas de compte/mot de passe administrateur à récupérer.** AFFiNE n'a
  pas de credential administrateur forcé au premier démarrage ; le premier
  utilisateur à s'inscrire sur l'URL déployée devient le propriétaire de
  l'espace de travail.
- **La clé de signature réside dans la base de données, pas dans Secret
  Manager.** AFFiNE génère sa clé de signature/privée pendant l'étape
  `affine-migrate` du job `self-host-predeploy` et la persiste dans PostgreSQL —
  `secret_ids` est intentionnellement vide ; le mot de passe de la base de
  données est le seul secret que Secret Manager détient pour cette
  application.
- **La création du schéma se fait dans un job d'initialisation, pas au
  démarrage.** Le job `affine-migrate` exécute `node ./scripts/self-host-predeploy`
  (migration idempotente + génération de clé) avant le démarrage du conteneur
  du serveur, il n'y a donc pas d'étape d'installation au premier démarrage à
  attendre au moment de l'exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail AFFiNE {#a-gke-autopilot--the-affine-workload}

Les pods AFFiNE sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. Le type de charge de travail est résolu via
la logique partagée `workload_type`/`stateful_pvc_enabled` (voir
[App_GKE](App_GKE.md)) ; par défaut, AFFiNE s'exécute en tant que
`Deployment`.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail AFFiNE pour les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app~affine 2>/dev/null || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AFFiNE stocke toutes les données de l'espace de travail (documents, tableaux
blancs, bases de données, utilisateurs) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods l'atteignent via le sidecar **Cloud SQL Auth Proxy**
sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée le rôle et la base de données de
l'application et accorde les privilèges (plus une autorisation
`cloudsqlsuperuser` au mieux pour que les migrations puissent
`CREATE EXTENSION`) ; le job `affine-migrate` exécute ensuite la propre
migration de schéma d'AFFiNE.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Redis — collaboration en temps réel {#c-redis--real-time-collaboration}

La synchronisation de documents Yjs pub/sub et la file d'attente des jobs en
arrière-plan d'AFFiNE nécessitent Redis. `enable_redis = true` par défaut ;
lorsque `redis_host` est laissé vide, la Fondation injecte l'IP du
serveur NFS partagé (la VM NFS co-héberge Redis). Le point d'entrée cloud
mappe les `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` injectés
sur les `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD` d'AFFiNE.

- **Console :** Compute Engine → Instances de VM (la VM NFS/Redis partagée).
- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i REDIS
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

Voir [App_GKE](App_GKE.md) pour la découverte et le provisionnement de la VM
NFS/Redis partagée.

### D. Cloud Storage et persistance des fichiers {#d-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est
provisionné automatiquement et le compte de service de la charge de travail
se voit accorder l'accès ; il sert aux sauvegardes et au stockage auxiliaire.
Séparément, les blobs téléchargés d'AFFiNE résident sur **NFS (Cloud
Filestore)** à `/root/.affine/storage`, partagés entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~affine"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Seul le secret du mot de passe de la base de données est généré
automatiquement pour AFFiNE — il n'y a pas de secret au niveau de
l'application car AFFiNE persiste sa propre clé de signature dans PostgreSQL.
Sur GKE, les secrets sont projetés dans les pods via le pilote CSI du Secret
Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~affine"
  gcloud secrets versions access latest --secret=<database-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré
par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et
Cloud SQL vers Cloud Monitoring. Des tests de disponibilité et des politiques
d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application AFFiNE {#3-affine-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` (`postgres:15-alpine`, timeout 600 s) crée de manière
  idempotente le rôle et la base de données de l'application, accorde les
  privilèges sur la base de données et le schéma `public`, et accorde
  au mieux `cloudsqlsuperuser` afin que les migrations ultérieures puissent
  `CREATE EXTENSION`. Il signale ensuite le sidecar Cloud SQL Auth Proxy
  (`POST /quitquitquit`) afin que le pod du Job se termine proprement.
- **Migration de schéma dans un job d'initialisation dédié, pas au
  démarrage.** Le job `affine-migrate` (l'image d'application AFFiNE
  construite, 2 Gi de mémoire, timeout 1200 s, `max_retries = 3`) s'exécute
  après `db-init` et exécute le propre
  `node ./scripts/self-host-predeploy` d'AFFiNE, qui effectue une migration de schéma
  idempotente **et génère la clé de signature/privée**, la persistant dans
  PostgreSQL. Le conteneur d'exécution ne migre jamais en ligne — au moment où
  le serveur démarre, le schéma et la clé existent déjà.
- **Pas de compte administrateur forcé.** AFFiNE n'a pas de credential
  superadministrateur imposé par l'image ; le premier utilisateur à visiter
  l'URL déployée et à s'inscrire devient le propriétaire initial de l'espace
  de travail.
- **La connexion à la base de données est TCP-sur-boucle-locale via le sidecar
  Auth Proxy, pas une socket.** Le point d'entrée cloud
  (`cloud-entrypoint.sh`) assemble `DATABASE_URL` à partir des
  variables `DB_*` injectées ; sur GKE, l'hôte résolu est
  `127.0.0.1` (le sidecar proxy) il utilise donc `sslmode=disable`. Il
  mappe également `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` sur
  les `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASSWORD` d'AFFiNE, et
  définit par défaut `AFFINE_SERVER_EXTERNAL_URL` à l'URL de service injectée par la
  plateforme afin que les liens d'invitation/partage se résolvent
  correctement.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /` ;
  les sondes de vivacité et de disponibilité utilisent `GET /info`, le
  point de terminaison d'informations du serveur d'AFFiNE. Le chemin de
  vivacité doit renvoyer un 200 littéral car App_GKE le reflète dans la
  vérification de santé de la passerelle — `/` redirige (302),
  ce que kubelet accepte mais l'équilibreur de charge traite comme
  malsain, de sorte que la passerelle servirait un 503. Sonde de démarrage :
  délai initial de 60 s, période de 15 s, seuil d'échec de 30 (jusqu'à ~510 s
  à partir du démarrage du conteneur). Vivacité : délai initial de 60 s,
  période de 30 s, seuil d'échec de 3. Étant donné que la migration s'exécute
  dans le job `affine-migrate` séparé, la fenêtre de démarrage couvre
  principalement le chargement du bundle Node.js et la configuration de la
  connexion Redis/PostgreSQL, pas la création du schéma.
- **L'indexeur de texte intégral est désactivé.** `AFFINE_INDEXER_ENABLED = "false"`
  car l'indexeur nécessite un backend de recherche basé sur pgvector qui n'est
  pas provisionné par ce module ; le serveur démarre sur PostgreSQL + Redis
  simples.
- **Inspecter les jobs d'initialisation et la configuration en cours
  d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<affine-migrate-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|REDIS_SERVER|AFFINE_SERVER'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
AFFiNE sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `affine` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image pour `ghcr.io/toeverything/affine`. `latest` correspond à `stable` (AFFiNE ne publie pas de tag `latest`). Incrémenter pour déclencher une nouvelle build d'image. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | AFFiNE est toujours une build personnalisée légère sur l'image amont afin que le point d'entrée cloud puisse s'exécuter. |
| `container_port` | `3010` | Port du serveur auto-hébergé d'AFFiNE. |
| `container_resources.cpu_limit` | `2000m` | 2 vCPU par défaut. |
| `container_resources.memory_limit` | `4Gi` | 4 Gi par défaut. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods. |
| `max_instance_count` | `5` | Nombre maximal de réplicas de pods. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy sur la boucle locale (`127.0.0.1:5432`) — requis sur GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de la socket Unix de l'Auth Proxy (utilisé pour le point de terminaison metadata/quitquitquit, pas la connexion à la base de données elle-même). |
| `enable_image_mirroring` | `true` | Toujours vrai — l'image de base est mise en miroir de Docker Hub/GHCR vers Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur d'AFFiNE. |
| `workload_type` | `null` → `Deployment` | Déploiement par défaut. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne le même pod. |
| `network_tags` | `["nfsserver"]` | Appliqué aux nœuds/pods ; correspond au tag de pare-feu de la VM NFS/Redis partagée. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Garder vrai — la VM NFS partagée co-héberge également l'instance Redis dont AFFiNE a besoin ; la désactiver supprime à la fois la persistance des blobs et Redis à moins qu'un `redis_host` externe ne soit fourni. |
| `nfs_mount_path` | `/root/.affine/storage` | Où AFFiNE stocke les blobs téléchargés. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Requis pour la production — la synchronisation en temps réel Yjs et la file d'attente des jobs s'exécutent via Redis. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS partagé. |
| `redis_port` | `6379` | Port TCP de Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis, si requis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE nécessite PostgreSQL 15+ ; les autres moteurs sont rejetés par la couche Common. |
| `application_database_name` | `affine` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `affine` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre AFFiNE. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`, `affine-migrate`) et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre stateless, IAP sans
> identités autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | La sélection d'un moteur non-PostgreSQL rompt `self-host-predeploy` et chaque requête. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `enable_redis` | `true` | Critique | La synchronisation de documents en temps réel et la file d'attente des jobs d'AFFiNE dépendent de Redis ; le désactiver sans alternative rompt la collaboration et les jobs en arrière-plan. |
| `enable_nfs` | `true` (sauf si un `redis_host` externe est fourni) | Critique | La VM NFS partagée co-héberge également Redis — la désactivation de NFS sans Redis externe supprime silencieusement la connexion Redis d'AFFiNE aussi, pas seulement la persistance des blobs. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:5432` est requis pour la connectivité à la base de données sur GKE. |
| `container_resources.memory_limit` | `4Gi` | Élevé | Le job d'initialisation `affine-migrate` seul demande 2 Gi ; sous-provisionner le conteneur du serveur risque un OOM sous une charge de collaboration en temps réel. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions en temps réel basées sur WebSocket. |
| `AFFINE_SERVER_EXTERNAL_URL` (valeur par défaut automatique) | URL du service de la plateforme | Moyen | Si elle est incorrectement remplacée via `environment_variables`, les liens d'invitation et de partage se résolvent vers le mauvais hôte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `AFFINE_INDEXER_ENABLED` (fixe `false`) | Laisser tel quel sauf si une base de données vectorielle est connectée | Faible | L'activer sans un backend basé sur pgvector rompt l'indexeur de texte intégral. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et `AFFINE_SERVER_EXTERNAL_URL`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à AFFiNE
partagée avec la variante Cloud Run est décrite dans
**[Affine_Common](Affine_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AFFiNE sur GKE Autopilot](../labs/Affine_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [AFFiNE sur Google Cloud Run](Affine_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [AFFiNE Common — Configuration d'application partagée](Affine_Common.md) — la configuration partagée par les deux cibles de déploiement.
