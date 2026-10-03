---
title: "Filebrowser sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Filebrowser sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Filebrowser_GKE.md @ 15fd4c7 sha256:e15537dd5371 -->

# Filebrowser sur GKE Autopilot {#filebrowser-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Filebrowser_GKE.png" alt="Filebrowser sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Filebrowser est un gestionnaire de fichiers web léger et open source écrit en Go. Il
sert une arborescence de répertoires via HTTP pour la navigation, le téléchargement,
l'édition et le partage de fichiers. Ce module déploie Filebrowser sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Filebrowser et sur la
manière de les explorer et de les utiliser à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Filebrowser s'exécute comme une seule charge de travail web Go. Il est
délibérément minimal — pas de base de données SQL, pas de cache, pas de file
d'attente — de sorte que le déploiement relie un petit ensemble de services
Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go unique, 1 vCPU / 1 GiB par défaut ; `min = max = 1` |
| État persistant | Cloud Storage (GCS FUSE) **ou** un PVC de type bloc | Monté à `/database` ; contient la base de données SQLite embarquée |
| Base de données | Aucune (SQLite embarquée) | `database_type = NONE` ; aucune instance Cloud SQL n'est provisionnée |
| Cache et file d'attente | Aucun | Filebrowser n'utilise pas Redis |
| Secrets | Secret Manager | Aucun secret d'application généré ; les utilisateurs vivent dans la base de données SQLite |
| Ingress | Cloud Load Balancing | Service `ClusterIP` par défaut ; domaine personnalisé + certificat géré disponibles |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **L'état réside dans un fichier SQLite embarqué à `/database`.** Filebrowser
  n'a pas de base de données Cloud SQL. Ses utilisateurs, ses paramètres et ses
  liens de partage sont stockés dans `/database/filebrowser.db`. Par défaut, `/database`
  est un PVC de type bloc sur un StatefulSet ; ce n'est qu'avec `stateful_pvc_enabled = false`
  qu'il s'agit d'un bucket Cloud Storage monté via GCS FUSE (voir ci-dessous).
- **GCS FUSE vs. PVC de type bloc.** Avec `stateful_pvc_enabled = true` (par défaut), la charge
  de travail devient un **StatefulSet** avec un PVC de type bloc persistant
  (par défaut `20Gi`) monté à `/database`, et le volume GCS FUSE
  est automatiquement désactivé pour éviter un double montage au même chemin.
  Un PVC de type bloc offre à SQLite un verrouillage de fichier POSIX approprié
  et constitue le choix le plus robuste pour un gestionnaire de fichiers avec état.
- **Instance unique par conception.** `min_instance_count = max_instance_count = 1`. SQLite ne tolère pas les
  écritures concurrentes — conservez un seul réplica.
- **La connexion par défaut est `admin` / `admin`.** Filebrowser
  initialise cela au premier démarrage ; changez-le dans l'interface web
  immédiatement après le déploiement.
- **Pas de Redis, pas de job d'initialisation.** `enable_redis = false` et aucun job
  `db-init` ne s'exécute ; le pod est prêt dès que le conteneur démarre.
- **Port de conteneur 80.** Filebrowser sert du HTTP/1.1 simple sur le port 80.
- **Le domaine personnalisé est activé par défaut.** `enable_custom_domain = true` et
  `reserve_static_ip = true` ; fournissez `application_domains` pour servir un nom d'hôte avec un
  certificat géré par Google.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Filebrowser {#a-gke-autopilot--the-filebrowser-workload}

Filebrowser s'exécute comme un StatefulSet à réplica unique (`stateful_pvc_enabled = true`,
par défaut ; un Deployment lorsque c'est `false`) planifié sur Autopilot,
qui facture le CPU/la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Filebrowser pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche le Service et toute adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud Storage / PVC de type bloc — état persistant {#b-cloud-storage--block-pvc--persistent-state}

Filebrowser n'a pas de base de données Cloud SQL. Sa base de données SQLite
embarquée (`/database/filebrowser.db`) est stockée sur le montage `/database` :

- **Par défaut — StatefulSet (`stateful_pvc_enabled = true`) :** un **PersistentVolumeClaim**
  de type bloc (par défaut `20Gi`, StorageClass `standard-rwo`) monté à
  `/database` ; le volume GCS FUSE est désactivé pour éviter un double
  montage. Gardez-le activé : la base de données de Filebrowser est bbolt, qui
  écrit à des offsets arbitraires que GCS FUSE rejette.
- **Deployment (`stateful_pvc_enabled = false`) :** un bucket **Cloud Storage** dédié monté
  via GCS FUSE à travers le pilote CSI.

- **Console :** Cloud Storage → Buckets ; ou Kubernetes Engine → Stockage → PVCs.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"   # GCS FUSE mode
  gcloud storage ls gs://<data-bucket>/filebrowser.db
  kubectl get pvc -n "$NAMESPACE"                                            # PVC mode
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les PVC de StatefulSet.

### C. Secret Manager {#c-secret-manager}

Filebrowser ne génère **aucun secret d'application** — il n'y a pas de clé de
chiffrement ou de secret JWT à gérer, car tout l'état d'identité réside dans la
base de données SQLite. Secret Manager est toujours utilisé par la fondation
pour les secrets gérés par la plateforme (par exemple, les jetons CI/CD si
configurés).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~filebrowser"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, le Service est `ClusterIP`, avec `enable_custom_domain = true` et
`reserve_static_ip = true` afin qu'un Ingress avec un certificat géré par Google puisse
servir un nom d'hôte fourni sur une IP stable. Sans domaine personnalisé, la
charge de travail est accessible dans le cluster à `http://<service>.<namespace>.svc.cluster.local`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des tests de disponibilité
et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Filebrowser {#3-filebrowser-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` et pas d'instance Cloud SQL. Au premier démarrage,
  le binaire Filebrowser crée sa base de données SQLite à `/database/filebrowser.db` si
  elle n'existe pas déjà et initialise l'utilisateur par défaut
  `admin`/`admin`.
- **Persistance de l'état.** Les utilisateurs, les paramètres et les liens de
  partage résident entièrement dans `/database/filebrowser.db` sur le montage `/database`
  (bucket GCS FUSE ou PVC de type bloc), survivant aux redémarrages et aux
  redéploiements. `FB_ROOT = /srv` est l'arborescence de fichiers que l'application sert.
- **Les identifiants par défaut doivent être modifiés.** La connexion
  initialisée `admin`/`admin` est bien connue. Connectez-vous et
  changez le mot de passe (et idéalement le nom d'utilisateur) dans l'interface
  web immédiatement après le premier déploiement.
- **Contrainte d'un seul rédacteur.** La base de données SQLite embarquée ne
  prend pas en charge les rédacteurs concurrents. Gardez `min_instance_count = max_instance_count = 1` ; un PVC
  de type bloc StatefulSet offre un verrouillage de fichier approprié mais reste
  à réplica unique.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/health`** — le point de terminaison de santé non authentifié de
  Filebrowser, qui renvoie `200` dès que le serveur écoute :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- wget -qO- http://localhost:80/health
  ```
- **Pas de Redis.** `enable_redis = false` ; Filebrowser est un gestionnaire de fichiers
  autonome sans file d'attente ni cache. La valeur par défaut App_GKE de
  `enable_redis = true` est explicitement remplacée.
- **L'image personnalisée nécessite `imagePullPolicy = Always`.** L'image est un wrapper
  mince construit et mis en miroir dans Artifact Registry ; App_GKE définit
  `imagePullPolicy = Always` pour les images personnalisées/mises en miroir afin qu'une
  reconstruction-redéploiement tire toujours la nouvelle couche.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Filebrowser sont listés ; toute autre entrée est héritée de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `filebrowser` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Filebrowser. `latest` se résout au `v2.32.0` épinglé au moment de la build ; épingler explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; Filebrowser est léger. |
| `memory_limit` | `1Gi` | Mémoire par pod ; 256 Mi sont amplement suffisants pour le serveur Go. |
| `min_instance_count` | `1` | Réplicas minimum. Garder à 1 — SQLite est à rédacteur unique. |
| `max_instance_count` | `1` | **Garder à 1** pour éviter les rédacteurs SQLite concurrents. |
| `container_port` | `80` | Écouteur HTTP/1.1 de Filebrowser. |
| `enable_cloudsql_volume` | `false` | Filebrowser n'a pas de Cloud SQL ; laisser `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Filebrowser dans Artifact Registry. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé ; le placer devant un Ingress via `enable_custom_domain`. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`, sinon `Deployment`. |
| `session_affinity` | `None` | Réplica unique, donc le routage persistant est inutile. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Définir `true` pour stocker `/database` sur un PVC de type bloc au lieu de GCS FUSE (recommandé pour le verrouillage de fichiers SQLite). |
| `stateful_pvc_size` | `20Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/database` | Chemin de montage — doit correspondre au répertoire de `FB_DATABASE`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass (`standard-rwo` PD équilibré ; `premium-rwo` pour des IOPS plus élevées). |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s de délai | Sonde de démarrage ; Filebrowser expose `/health` une fois prêt. |
| `liveness_probe` | HTTP `/health` 30s de délai | Sonde de vivacité sur le point de terminaison non authentifié `/health`. |
| `uptime_check_config` | `{enabled=false, path="/health"}` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métriques facultatives. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; non nécessaire pour Filebrowser. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket `/database` de Filebrowser (et tout `storage_buckets` supplémentaire). |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket `/database` est ajouté automatiquement (sauf si un PVC est utilisé). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Hérité de App_GKE et **non** remplacé par ce module. Filebrowser n'utilise pas Redis, donc définissez-le sur `false` lors du déploiement — le laisser activé connecte une dépendance inutilisée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Non applicable — Filebrowser n'a pas de base de données SQL. `database_password_length` et
`db_name` / `db_user` sont transmis à la fondation uniquement pour la
compatibilité ; `database_type` est fixé à `NONE` par `Filebrowser_Common`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner un Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Filebrowser. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Filebrowser. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `/database` en mode GCS FUSE). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsque `stateful_pvc_enabled = true`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les
> combinaisons* au moment de la planification — IAP sans identifiants OAuth, `min_instance_count > max_instance_count`,
> `workload_type = Deployment` avec `stateful_pvc_enabled = true`, valeurs de mémoire ResourceQuota sans suffixes d'unité
> binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Volume `/database` (bucket ou PVC) | Ne jamais supprimer | Critique | La base de données SQLite embarquée y réside ; sa suppression détruit tous les utilisateurs, les paramètres et les liens de partage. |
| `admin` / `admin` (connexion initiale) | Changer à la première connexion | Critique | Laisser l'identifiant par défaut permet à quiconque peut atteindre le service de prendre le contrôle total. |
| `max_instance_count` | `1` | Élevé | >1 met des rédacteurs concurrents sur la base de données SQLite unique, la corrompant. |
| `stateful_pvc_mount_path` | `/database` | Élevé | Doit correspondre au répertoire de `FB_DATABASE` ; une non-concordance stocke la base de données sur un disque éphémère et perd l'état au redémarrage. |
| `stateful_pvc_enabled` + `enable_gcs_storage_volume` | Laisser Common désactiver GCS FUSE | Élevé | Les deux à `/database` double-montent ; Common définit automatiquement `enable_gcs_storage_volume = false` lorsque le PVC est activé — ne forcez pas les deux. |
| `container_port` | `80` | Élevé | Filebrowser écoute sur le port 80 ; un port différent fait échouer la sonde de démarrage et le pod ne devient jamais prêt. |
| Chemin `startup_probe` / `liveness_probe` | `/health` | Élevé | Pointer les sondes vers un chemin authentifié renvoie 401/403 et le pod ne devient jamais prêt. |
| `enable_cloudsql_volume` | `false` | Moyen | Filebrowser n'a pas de Cloud SQL ; l'activation ajoute un sidecar Auth Proxy inutile. |
| `enable_redis` | `true` | Moyen | Filebrowser n'a pas de Redis, mais la valeur par défaut App_GKE de `true` est héritée inchangée — définissez-la explicitement sur `false`, sinon une dépendance inutilisée est connectée. |
| `enable_iap` | identifiants requis | Élevé | L'activation d'IAP sans `iap_oauth_client_id`/`secret` expose silencieusement le service non authentifié (bloqué par une garde au moment de la planification). |
| `application_version` | épingler en production | Moyen | `latest` se résout en un `v2.32.0` épinglé au moment de la build ; épingler explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
Filebrowser partagée avec la variante Cloud Run est décrite dans
**[Filebrowser_Common](Filebrowser_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Filebrowser sur GKE Autopilot](../labs/Filebrowser_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Filebrowser Common — Configuration d'application partagée](Filebrowser_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Kopia sur GKE Autopilot](Kopia_GKE.md), [UrBackup sur GKE Autopilot](UrBackup_GKE.md) dans la solution **Sauvegarde et reprise après sinistre**.
