---
title: "CloudBeaver sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de CloudBeaver sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CloudBeaver_GKE.md @ 15fd4c7 sha256:ea3862132d47 -->

# CloudBeaver sur GKE Autopilot {#cloudbeaver-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_GKE.png" alt="CloudBeaver sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver est un gestionnaire de bases de données web accessible par navigateur, issu du projet DBeaver — une console administrative unique pour se connecter et interroger PostgreSQL, MySQL, SQL Server, Oracle, SQLite et de nombreux autres moteurs. Ce module déploie CloudBeaver sur **GKE Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par CloudBeaver et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

CloudBeaver s'exécute comme une seule charge de travail web JVM. Parce que CloudBeaver conserve tout son état dans un espace de travail persistant et ne provisionne aucune base de données d'application, le déploiement connecte un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod JVM unique, 1 vCPU / 1 GiB par défaut, port 8978 |
| Espace de travail persistant | Persistent Disk (PVC de bloc) via StatefulSet | **Recommandé :** un PVC de bloc par pod monté à `/opt/cloudbeaver/workspace` sauvegarde le stockage H2 embarqué |
| Base de données | **Aucune provisionnée** | `database_type = "NONE"` — CloudBeaver stocke son propre état ; il *se connecte* aux bases de données que vous configurez dans l'interface utilisateur |
| Cache et file d'attente | **Aucun** | CloudBeaver n'utilise pas Redis ; `enable_redis` est désactivé de force |
| Secrets | Secret Manager | Aucun secret au niveau de l'application n'est généré — le compte administrateur est créé via l'assistant de configuration de première exécution |
| Ingress | Cloud Load Balancing | **`ClusterIP` par défaut** (dans le cluster) ; utilisez `LoadBalancer` / un domaine personnalisé pour l'accès externe |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données d'application n'est provisionnée.** `database_type = "NONE"`. CloudBeaver
  conserve ses métadonnées dans un stockage H2 embarqué à l'intérieur du volume de l'espace de travail. Les
  bases de données qu'il *gère* sont ajoutées par un opérateur dans l'interface utilisateur après le déploiement.
- **Utilisez un PVC de bloc pour l'espace de travail, pas GCS FUSE.** `stateful_pvc_enabled = true`
  est la valeur par défaut et doit rester activée : un Persistent Disk de bloc — et non GCS FUSE — est le
  stockage de sauvegarde correct pour la base de données H2 embarquée de CloudBeaver. Lorsque le PVC est activé, le
  module ignore automatiquement le volume GCS FUSE au même chemin pour éviter un
  double montage.
- **StatefulSet est sélectionné automatiquement.** La définition de `stateful_pvc_enabled = true` sans
  un `workload_type` explicite résout la charge de travail en un `StatefulSet` pour une identité de pod stable
  et des redémarrages ordonnés.
- **Instance unique par conception.** `min_instance_count = 1` (évite les démarrages à froid lents de la JVM,
  et GKE n'a pas de mise à l'échelle à zéro) et `max_instance_count = 1` (l'espace de travail est un
  stockage à écrivain unique). N'augmentez **pas** `max_instance_count`.
- **Le service est `ClusterIP` par défaut.** Uniquement dans le cluster — approprié pour une console d'administration de base de données. Pour un accès par navigateur depuis l'extérieur du cluster, utilisez
  `service_type = "LoadBalancer"` ou un Ingress avec un domaine personnalisé (et IAP).
- **Le compte administrateur est revendiqué par le premier visiteur.** CloudBeaver n'a pas d'administrateur pré-configuré — complétez l'assistant de configuration immédiatement une fois le service accessible.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail CloudBeaver {#a-gke-autopilot--the-cloudbeaver-workload}

Les pods CloudBeaver sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Avec un PVC de bloc activé, la charge de travail s'exécute en tant que **StatefulSet**
(port 8978) pour une identité de pod stable. Comme l'espace de travail est à écrivain unique, maintenez la
charge de travail à un seul réplica.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail CloudBeaver pour voir
  les pods et les événements. Kubernetes Engine → Services et Ingress montre comment elle est exposée.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe statefulset -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Déploiement vs StatefulSet) sont gérés.

### B. Persistent Disk — le volume de l'espace de travail (PVC de bloc) {#b-persistent-disk--the-workspace-volume-block-pvc}

L'état complet de CloudBeaver — sa base de données de métadonnées H2 embarquée, les connexions enregistrées,
les utilisateurs et la configuration — persiste sous `/opt/cloudbeaver/workspace`. Le
stockage de sauvegarde recommandé est un **Persistent Disk de bloc** provisionné par pod par le
modèle de PVC du StatefulSet et monté à ce chemin. C'est le cœur durable du
déploiement et le stockage correct pour la base de données H2 embarquée.

- **Console :** Kubernetes Engine → Stockage → Revendications de volume persistant.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Inspect the workspace contents inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /opt/cloudbeaver/workspace
  ```

Lorsque `stateful_pvc_enabled = true`, le module définit `enable_gcs_storage_volume = false`
afin que le volume GCS FUSE ne soit pas également monté au même chemin. Un bucket Cloud Storage `storage`
est toujours déclaré par CloudBeaver_Common pour la parité avec la variante Cloud Run.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `storage` est déclaré pour le déploiement. Avec la
configuration recommandée de PVC de bloc, l'espace de travail réside sur le Persistent Disk plutôt que sur le
bucket, mais le bucket est toujours provisionné et disponible pour le stockage auxiliaire.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Connectivité de la base de données (aucune instance gérée) {#d-database-connectivity-no-managed-instance}

Ce module ne provisionne **aucune instance Cloud SQL** — `gcloud sql instances list` ne
montrera pas une instance créée par CloudBeaver. Au lieu de cela, CloudBeaver se connecte aux
bases de données que vous enregistrez dans son interface utilisateur. Pour atteindre le Cloud SQL partagé du déploiement (ou
toute base de données privée), la cible doit être accessible sur le VPC depuis le pod.

- **CLI (tester l'accessibilité depuis le pod) :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- sh -c 'nc -zv <db-private-ip> 5432'
  ```

### E. Secret Manager {#e-secret-manager}

CloudBeaver ne génère **aucun secret au niveau de l'application** — il n'y a pas de clé de chiffrement, pas de
secret JWT, et pas de mot de passe de base de données à gérer (il n'y a pas de base de données). Le compte administrateur est créé via l'assistant de configuration de première exécution, et tout l'état réside dans l'espace de travail.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée en tant que service **`ClusterIP`** — accessible uniquement depuis
l'intérieur du cluster, ce qui convient à une console d'administration de base de données. Pour un accès par navigateur
depuis l'extérieur du cluster, utilisez `service_type = "LoadBalancer"` ou activez un Ingress
avec un domaine personnalisé et un certificat géré par Google (éventuellement avec IAP, Cloud Armor,
et une IP statique réservée).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles (les vérifications de disponibilité nécessitent un point de terminaison accessible publiquement, par exemple un service LoadBalancer).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application CloudBeaver {#3-cloudbeaver-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job d'initialisation de base de données et pas de base de données d'application. CloudBeaver initialise son propre stockage de métadonnées embarqué dans l'espace de travail au premier démarrage.
- **L'état est entièrement dans le volume de l'espace de travail.** La base de données H2 embarquée, les connexions enregistrées, les utilisateurs gérés et la configuration résident tous sous
  `/opt/cloudbeaver/workspace`, sauvegardés par le PVC de bloc. Le PVC survit aux redémarrages et à la replanification des pods, c'est pourquoi un StatefulSet + PVC de bloc est fortement recommandé par rapport à GCS FUSE pour le stockage H2 embarqué.
- **Assistant de configuration de première exécution.** Lors du premier accès, CloudBeaver présente un assistant de configuration pour créer la configuration du serveur et le compte administrateur. Il n'y a pas d'administrateur pré-configuré — quiconque complète l'assistant en premier devient l'administrateur. Faites-le immédiatement, et maintenez le service interne jusqu'à ce que vous l'ayez fait.
- **Ajout de bases de données à gérer.** Après vous être connecté en tant qu'administrateur, ajoutez des connexions dans l'interface utilisateur (Nouvelle connexion → choisissez le pilote → fournissez l'hôte/le port/les identifiants). Pour atteindre les bases de données privées, assurez-vous qu'elles sont accessibles sur le VPC depuis le pod.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` (l'interface utilisateur web de CloudBeaver),
  qui renvoie HTTP 200 une fois que la JVM a terminé de démarrer.
- **Mise à l'échelle à écrivain unique.** Maintenez `max_instance_count = 1`. Le stockage de l'espace de travail ne peut pas
  être partagé en toute sécurité par des pods concurrents.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour CloudBeaver sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudbeaver` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `CloudBeaver` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image CloudBeaver (construite à partir de `dbeaver/cloudbeaver:<version>`) ; épingler pour la reproductibilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `min_instance_count` | `1` | Gardez 1 réplica chaud (GKE n'a pas de mise à l'échelle à zéro ; évite les démarrages à froid lents de la JVM). |
| `max_instance_count` | `1` | **Maintenez à 1.** L'espace de travail est un stockage à écrivain unique ; des pods concurrents le corrompent. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. CloudBeaver s'exécute sur la JVM — dimensionnez en conséquence. |
| `container_port` | `8978` | Fixé par CloudBeaver_Common ; non transmis à App_GKE et n'a aucun effet ici. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Dans le cluster par défaut (recommandé pour une console DB). Utilisez `LoadBalancer` pour un accès externe. |
| `workload_type` | `null` | Laissez non défini — avec `stateful_pvc_enabled = true`, il se résout automatiquement en `StatefulSet`. |
| `session_affinity` | _(défini)_ | Routage persistant pour les sessions UI. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Gardez `true`** — un PVC de bloc (pas GCS FUSE) est le stockage correct pour la base de données H2 embarquée de CloudBeaver. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; contient l'espace de travail plus les frais généraux. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | Doit être le répertoire de l'espace de travail de CloudBeaver. |
| `stateful_pvc_storage_class` | _(défini)_ | Kubernetes StorageClass pour le PVC. |
| `stateful_headless_service` | _(défini)_ | Service sans tête pour des noms DNS de pod stables. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 15s de délai | Sonde de démarrage contre l'interface utilisateur de CloudBeaver. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité contre l'interface utilisateur de CloudBeaver. |
| `uptime_check_config` | _(défini)_ | Vérification de disponibilité Cloud Monitoring — nécessite un point de terminaison accessible publiquement (par exemple, un service LoadBalancer). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — l'espace de travail de CloudBeaver est sur le PVC de bloc, pas NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner les buckets GCS déclarés. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image CloudBeaver dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md). Notez que
`enable_redis` est forcé à `false` et aucune base de données d'application n'est provisionnée
(`database_type = NONE`) par ce module.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP dans le cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à la phase. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée / `LoadBalancer` est utilisé). |
| `service_url` | URL pour atteindre CloudBeaver. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — `workload_type = "Deployment"` avec `stateful_pvc_enabled = true`, `quota_memory_requests`/`_limits` sans suffixes d'unité binaire, IAP sans identités autorisées. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (PVC de bloc) | Critique | Sans un PVC de bloc persistant, l'espace de travail (base de données H2 embarquée, connexions, utilisateurs, configuration) est perdu lors du redémarrage du pod. GCS FUSE n'est pas un stockage sûr pour la base de données H2 embarquée. |
| PVC de l'espace de travail | Préserver lors des redéploiements | Critique | Le PVC contient tout l'état de CloudBeaver ; sa suppression efface toutes les connexions et paramètres enregistrés. |
| `max_instance_count` | `1` | Critique | L'espace de travail est à écrivain unique ; deux pods écrivant simultanément dans le stockage H2 embarqué le corrompent. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | Élevé | Le chemin de l'espace de travail de CloudBeaver est intégré à l'image ; le monter ailleurs laisse l'état sur un stockage éphémère. |
| Assistant de configuration de première exécution | Compléter immédiatement | Élevé | Il n'y a pas d'administrateur pré-configuré — quiconque accède à l'interface utilisateur en premier peut revendiquer le compte administrateur. |
| `service_type` | `ClusterIP` (ou LB+IAP) | Élevé | `LoadBalancer` sans IAP/Cloud Armor expose une console d'administration de base de données à l'internet public. |
| `memory_limit` | `1Gi` | Élevé | CloudBeaver est basé sur la JVM ; trop peu de mémoire provoque des arrêts OOM. |
| `min_instance_count` | `1` | Moyen | GKE nécessite min ≥ 1 ; un réplica chaud évite les démarrages à froid lents de la JVM. |
| `application_version` | Épingler un tag en production | Moyen | `latest` peut modifier la version de CloudBeaver entre les reconstructions ; épingler pour la reproductibilité. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_redis` / `database_type` | Laisser tel quel (désactivé / `NONE`) | Faible | CloudBeaver n'utilise aucun des deux ; la surcharge n'a aucun avantage et n'est pas prise en charge ici. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à CloudBeaver partagée avec la variante Cloud Run est
décrite dans **[CloudBeaver_Common](CloudBeaver_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CloudBeaver sur GKE Autopilot](../labs/CloudBeaver_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) — la même application sur Cloud Run, pour quand vous avez besoin de l'autre cible de déploiement.
- [CloudBeaver Common — Configuration d'application partagée](CloudBeaver_Common.md) — la configuration partagée par les deux cibles de déploiement.
