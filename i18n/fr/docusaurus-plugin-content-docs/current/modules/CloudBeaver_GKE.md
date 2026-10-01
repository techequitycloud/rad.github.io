---
title: "CloudBeaver sur GKE Autopilot"
description: "Référence de configuration pour déployer CloudBeaver sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CloudBeaver_GKE.md @ 3055034 sha256:f36213d38967 -->

# CloudBeaver sur GKE Autopilot {#cloudbeaver-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_GKE.png" alt="CloudBeaver sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver est un gestionnaire de bases de données web, accessible depuis un navigateur, issu du projet DBeaver
— une console d'administration unique pour se connecter à PostgreSQL, MySQL, SQL Server,
Oracle, SQLite et de nombreux autres moteurs, et les interroger. Ce module déploie
CloudBeaver sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par CloudBeaver et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

CloudBeaver s'exécute sous la forme d'une unique charge de travail web JVM. Comme CloudBeaver conserve tout
son état dans un espace de travail persistant et ne provisionne aucune base de données applicative, le
déploiement assemble un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod JVM, 1 vCPU / 1 GiB par défaut, port 8978 |
| Espace de travail persistant | Persistent Disk (PVC en mode bloc) via StatefulSet | **Recommandé :** un PVC en mode bloc par pod, monté sur `/opt/cloudbeaver/workspace`, héberge le magasin H2 intégré |
| Base de données | **Aucune provisionnée** | `database_type = "NONE"` — CloudBeaver stocke son propre état ; il *se connecte* aux bases de données que vous configurez dans l'interface |
| Cache et file d'attente | **Aucun** | CloudBeaver n'utilise pas Redis ; `enable_redis` est forcé à désactivé |
| Secrets | Secret Manager | Aucun secret applicatif n'est généré — le compte administrateur est créé via l'assistant de configuration au premier lancement |
| Entrée | Cloud Load Balancing | **`ClusterIP` par défaut** (interne au cluster) ; utilisez `LoadBalancer` / un domaine personnalisé pour un accès externe |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données applicative n'est provisionnée.** `database_type = "NONE"`. CloudBeaver
  conserve ses métadonnées dans un magasin H2 intégré à l'intérieur du volume de l'espace de travail. Les
  bases de données qu'il *gère* sont ajoutées par un opérateur dans l'interface après le déploiement.
- **Utilisez un PVC en mode bloc pour l'espace de travail, pas GCS FUSE.** `stateful_pvc_enabled = true`
  est vivement recommandé : un Persistent Disk en mode bloc — et non GCS FUSE — est le stockage
  adapté pour la base H2 intégrée de CloudBeaver. Lorsque le PVC est activé, le
  module ignore automatiquement le volume GCS FUSE sur le même chemin pour éviter un
  double montage.
- **Le StatefulSet est sélectionné automatiquement.** Définir `stateful_pvc_enabled = true` sans
  `workload_type` explicite résout la charge de travail en `StatefulSet`, pour une identité de pod stable
  et des redémarrages ordonnés.
- **Une seule instance par conception.** `min_instance_count = 1` (évite les démarrages à froid lents de la JVM,
  et GKE ne permet pas la mise à l'échelle à zéro) et `max_instance_count = 1` (l'espace de travail est un
  magasin à écrivain unique). **N'augmentez pas** `max_instance_count`.
- **Le Service est de type `ClusterIP` par défaut.** Interne au cluster uniquement — ce qui convient à une console
  d'administration de bases de données. Pour un accès depuis un navigateur extérieur au cluster, utilisez
  `service_type = "LoadBalancer"` ou un Ingress avec un domaine personnalisé (et IAP).
- **Le compte administrateur revient au premier visiteur.** CloudBeaver n'a pas d'administrateur
  préconfiguré — terminez l'assistant de configuration immédiatement dès que le service est accessible.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail CloudBeaver {#a-gke-autopilot--the-cloudbeaver-workload}

Les pods CloudBeaver sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. Lorsqu'un PVC en mode bloc est activé, la charge de travail s'exécute en tant que **StatefulSet**
(port 8978) pour une identité de pod stable. Comme l'espace de travail est à écrivain unique, maintenez la
charge de travail à un seul réplica.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail CloudBeaver pour voir
  les pods et les événements. Kubernetes Engine → Services & Ingress montre comment elle est exposée.
- **CLI :**
  ```bash
  kubectl get pods,svc,statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe statefulset -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment ou StatefulSet) sont gérés.

### B. Persistent Disk — le volume de l'espace de travail (PVC en mode bloc) {#b-persistent-disk--the-workspace-volume-block-pvc}

L'intégralité de l'état de CloudBeaver — sa base de métadonnées H2 intégrée, les connexions enregistrées,
les utilisateurs et la configuration — persiste sous `/opt/cloudbeaver/workspace`. Le
stockage recommandé est un **Persistent Disk en mode bloc** provisionné pour chaque pod par le
modèle de PVC du StatefulSet et monté sur ce chemin. C'est le cœur durable du
déploiement et le stockage adapté à la base H2 intégrée.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Inspect the workspace contents inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /opt/cloudbeaver/workspace
  ```

Lorsque `stateful_pvc_enabled = true`, le module définit `enable_gcs_storage_volume = false`
afin que le volume GCS FUSE ne soit pas également monté sur le même chemin. Un bucket Cloud Storage `storage`
est néanmoins déclaré par CloudBeaver_Common par souci de parité avec la variante Cloud Run.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `storage` est déclaré pour le déploiement. Avec la
configuration recommandée en PVC en mode bloc, l'espace de travail réside sur le Persistent Disk plutôt que dans le
bucket, mais celui-ci est tout de même provisionné et disponible pour un stockage auxiliaire.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Connectivité aux bases de données (aucune instance gérée) {#d-database-connectivity-no-managed-instance}

Ce module ne provisionne **aucune instance Cloud SQL** — `gcloud sql instances list`
n'en affichera aucune créée par CloudBeaver. CloudBeaver se connecte plutôt aux
bases de données que vous enregistrez dans son interface. Pour atteindre le Cloud SQL partagé du déploiement (ou
toute base de données privée), la cible doit être accessible sur le VPC depuis le pod.

- **CLI (testez l'accessibilité depuis l'intérieur du pod) :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- sh -c 'nc -zv <db-private-ip> 5432'
  ```

### E. Secret Manager {#e-secret-manager}

CloudBeaver ne génère **aucun secret applicatif** — il n'y a ni clé de chiffrement, ni
secret JWT, ni mot de passe de base de données à gérer (il n'y a pas de base de données). Le compte
administrateur est créé via l'assistant de configuration au premier lancement, et tout l'état réside dans
l'espace de travail.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée sous forme de Service **`ClusterIP`** — accessible uniquement depuis
l'intérieur du cluster, ce qui convient à une console d'administration de bases de données. Pour un accès depuis un navigateur
extérieur au cluster, utilisez `service_type = "LoadBalancer"` ou activez un Ingress
avec un domaine personnalisé et un certificat géré par Google (éventuellement avec IAP, Cloud Armor
et une IP statique réservée).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE sont envoyées à Cloud Monitoring. Des
tests de disponibilité et des règles d'alerte facultatifs sont disponibles (les tests de disponibilité nécessitent un point de terminaison
accessible publiquement, par exemple un Service LoadBalancer).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application CloudBeaver {#3-cloudbeaver-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni job db-init ni base de données
  applicative. CloudBeaver initialise son propre magasin de métadonnées intégré à l'intérieur de
  l'espace de travail au premier démarrage.
- **L'état réside entièrement dans le volume de l'espace de travail.** La base H2 intégrée, les connexions
  enregistrées, les utilisateurs gérés et la configuration résident tous sous
  `/opt/cloudbeaver/workspace`, adossé au PVC en mode bloc. Le PVC survit aux redémarrages et aux
  replanifications de pod ; c'est pourquoi un StatefulSet + un PVC en mode bloc est vivement
  recommandé plutôt que GCS FUSE pour le magasin H2 intégré.
- **Assistant de configuration au premier lancement.** Au premier accès, CloudBeaver présente un assistant de configuration pour
  créer la configuration du serveur et le compte administrateur. Il n'y a pas d'administrateur
  préconfiguré — la première personne qui termine l'assistant devient l'administrateur. Faites-le immédiatement,
  et gardez le Service interne tant que ce n'est pas fait.
- **Ajouter des bases de données à gérer.** Après vous être connecté en tant qu'administrateur, ajoutez des connexions dans l'interface
  (New Connection → choisissez le pilote → indiquez l'hôte, le port et les identifiants). Pour atteindre des bases de données
  privées, assurez-vous qu'elles sont accessibles sur le VPC depuis le pod.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` (l'interface web de CloudBeaver),
  qui renvoie HTTP 200 une fois que la JVM a fini de démarrer.
- **Mise à l'échelle à écrivain unique.** Gardez `max_instance_count = 1`. Le magasin de l'espace de travail ne peut pas
  être partagé sans risque par des pods concurrents.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à CloudBeaver ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `cloudbeaver` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `CloudBeaver` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image CloudBeaver (construite à partir de `dbeaver/cloudbeaver:<version>`) ; épinglez-le pour la reproductibilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `min_instance_count` | `1` | Gardez 1 réplica à chaud (GKE ne permet pas la mise à l'échelle à zéro ; évite les démarrages à froid lents de la JVM). |
| `max_instance_count` | `1` | **Gardez 1.** L'espace de travail est un magasin à écrivain unique ; des pods concurrents le corrompent. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. CloudBeaver s'exécute sur la JVM — dimensionnez en conséquence. |
| `container_port` | `8978` | Fixé par CloudBeaver_Common ; non transmis à App_GKE et sans effet ici. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Interne au cluster par défaut (recommandé pour une console de bases de données). Utilisez `LoadBalancer` pour un accès externe. |
| `workload_type` | `null` | Laissez non défini — avec `stateful_pvc_enabled = true`, il est résolu automatiquement en `StatefulSet`. |
| `session_affinity` | _(défini)_ | Routage persistant pour les sessions de l'interface. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **Définissez `true`** — un PVC en mode bloc (et non GCS FUSE) est le stockage adapté à la base H2 intégrée de CloudBeaver. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; doit contenir l'espace de travail plus une marge. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | Doit être le répertoire de l'espace de travail de CloudBeaver. |
| `stateful_pvc_storage_class` | _(défini)_ | StorageClass Kubernetes du PVC. |
| `stateful_headless_service` | _(défini)_ | Service headless pour des noms DNS de pod stables. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 15s | Sonde de démarrage ciblant l'interface de CloudBeaver. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de vivacité ciblant l'interface de CloudBeaver. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring — nécessite un point de terminaison accessible publiquement (par exemple un Service LoadBalancer). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — l'espace de travail de CloudBeaver se trouve sur le PVC en mode bloc, pas sur NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS déclarés. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `enable_image_mirroring` | `true` | Réplique l'image CloudBeaver dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md). Notez que
`enable_redis` est forcé à `false` et qu'aucune base de données applicative n'est provisionnée
(`database_type = NONE`) par ce module.

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
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée / que `LoadBalancer` est utilisé). |
| `service_url` | URL permettant d'accéder à CloudBeaver. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation (vide par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — `workload_type = "Deployment"` associé à `stateful_pvc_enabled = true`, des `quota_memory_requests`/`_limits` sans suffixe d'unité binaire, IAP sans identités autorisées. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (PVC en mode bloc) | Critical | Sans PVC en mode bloc persistant, l'espace de travail (base H2 intégrée, connexions, utilisateurs, configuration) est perdu au redémarrage du pod. GCS FUSE n'est pas un stockage sûr pour la base H2 intégrée. |
| PVC de l'espace de travail | À conserver d'un redéploiement à l'autre | Critical | Le PVC contient tout l'état de CloudBeaver ; le supprimer efface toutes les connexions et tous les paramètres enregistrés. |
| `max_instance_count` | `1` | Critical | L'espace de travail est à écrivain unique ; deux pods écrivant simultanément dans le magasin H2 intégré le corrompent. |
| `stateful_pvc_mount_path` | `/opt/cloudbeaver/workspace` | High | Le chemin de l'espace de travail de CloudBeaver est figé dans l'image ; un montage ailleurs laisse l'état sur un stockage éphémère. |
| Assistant de configuration au premier lancement | À terminer immédiatement | High | Il n'y a pas d'administrateur préconfiguré — quiconque atteint l'interface en premier peut s'approprier le compte administrateur. |
| `service_type` | `ClusterIP` (ou équilibreur de charge + IAP) | High | `LoadBalancer` sans IAP/Cloud Armor expose une console d'administration de bases de données à l'Internet public. |
| `memory_limit` | `1Gi` | High | CloudBeaver repose sur la JVM ; une mémoire insuffisante provoque des arrêts pour OOM. |
| `min_instance_count` | `1` | Medium | GKE exige min ≥ 1 ; un réplica à chaud évite les démarrages à froid lents de la JVM. |
| `application_version` | Épingler un tag en production | Medium | `latest` peut faire changer la version de CloudBeaver d'un build à l'autre ; épinglez-le pour la reproductibilité. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_redis` / `database_type` | Laisser tels quels (désactivé / `NONE`) | Low | CloudBeaver n'utilise ni l'un ni l'autre ; les surcharger n'apporte rien et n'est pas pris en charge ici. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et réplication d'images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à CloudBeaver, partagée avec la variante Cloud Run, est
décrite dans **[CloudBeaver_Common](CloudBeaver_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CloudBeaver sur GKE Autopilot](../labs/CloudBeaver_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CloudBeaver Common — Configuration applicative partagée](CloudBeaver_Common.md) — la configuration partagée par les deux cibles de déploiement.
