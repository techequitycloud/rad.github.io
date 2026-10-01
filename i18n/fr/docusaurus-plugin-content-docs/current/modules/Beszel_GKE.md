---
title: "Beszel sur GKE Autopilot"
description: "Référence de configuration pour déployer Beszel sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Beszel_GKE.md @ 3055034 sha256:56bb2dbc289d -->

# Beszel sur GKE Autopilot {#beszel-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_GKE.png" alt="Beszel sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel est un hub de supervision de serveurs léger et open source — métriques
historiques des ressources, statistiques des conteneurs Docker et alertes
configurables, construit sur PocketBase (Go et une base de données SQLite intégrée).
Ce module déploie le hub Beszel sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Beszel et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Beszel s'exécute comme un **StatefulSet** Kubernetes à réplica unique sur Autopilot,
servant son interface web et son API REST sur le port 8090 et conservant tout son
état sur un Persistent Volume bloc monté sur `/beszel_data`. Le déploiement assemble
un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod Go, StatefulSet, 1 vCPU / 1 GiB par défaut, port 8090 |
| Base de données | **Aucune** | Beszel intègre sa propre base PocketBase/SQLite — aucun Cloud SQL n'est provisionné |
| Stockage persistant | Persistent Disk (PVC) | PVC bloc de 20 Gi sur `/beszel_data` pour tout l'état (StatefulSet) |
| Cache et file d'attente | **Aucun** | Beszel n'utilise pas Redis ; `enable_redis` est forcé à off |
| Secrets | Secret Manager | Aucun secret applicatif injecté — le premier administrateur est créé dans l'interface |
| Entrée | Cloud Load Balancing | Service `ClusterIP` par défaut ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Beszel est autonome — `database_type = "NONE"`,
  `enable_cloudsql_volume = false` et `enable_redis = false`. Tout l'état réside dans
  la base SQLite intégrée sous `/beszel_data`.
- **StatefulSet avec un PVC bloc par défaut.** `stateful_pvc_enabled = true` (la
  valeur par défaut sur GKE), de sorte que `workload_type` se résout automatiquement en
  `StatefulSet` et qu'un Persistent Disk de 20 Gi est monté sur `/beszel_data`. Un
  PVC bloc est le support durable adapté à SQLite (contrairement à un montage de
  fichiers réseau). Comme le PVC couvre `/beszel_data`, le volume GCS FUSE sur le même
  chemin est désactivé pour éviter un double montage.
- **Le réplica unique est délibéré.** `min_instance_count = max_instance_count = 1`.
  Beszel est une application à écrivain unique (un seul fichier SQLite) ;
  n'augmentez **pas** le nombre de réplicas.
- **Mise à jour de type `Recreate`.** Un seul pod peut posséder le PVC SQLite à la
  fois ; le StatefulSet remplace le pod au lieu d'en exécuter deux sur le même volume.
- **Port 8090.** Le hub Beszel écoute sur 8090 ; le port du conteneur et les sondes
  sont configurés en conséquence.
- **`ClusterIP` par défaut.** Le Service est interne par défaut ; exposez le hub via
  la Gateway/l'Ingress avec un domaine personnalisé (et un certificat géré), ou
  définissez un LoadBalancer, afin que les agents distants et les navigateurs
  puissent le joindre.
- **Chemin de santé `/api/health`.** Les sondes de démarrage et de vivacité
  interrogent le point de terminaison de santé public et non authentifié du hub (200
  lorsqu'il est prêt).
- **L'administrateur initial est créé dans l'interface.** Aucun mot de passe
  administrateur n'est stocké dans Secret Manager ; ouvrez le hub après le déploiement
  et terminez la configuration du superutilisateur au premier lancement de PocketBase.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Beszel {#a-gke-autopilot--the-beszel-workload}

Beszel est ordonnancé comme un StatefulSet à réplica unique sur Autopilot, qui
facture le CPU et la mémoire que le pod demande réellement. Comme l'application est à
écrivain unique, elle n'est pas mise à l'échelle horizontalement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Beszel pour voir le pod, le StatefulSet et les événements. Kubernetes Engine →
  Services & Ingress montre comment elle est exposée.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=beszel
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Persistent Disk (PVC) — le volume `/beszel_data` {#b-persistent-disk-pvc--the-beszel_data-volume}

L'intégralité de l'état de Beszel (la base SQLite, la configuration téléversée et les
métriques historiques) réside sur un Persistent Volume bloc réclamé par le
StatefulSet et monté sur `/beszel_data` (20 Gi par défaut).

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ; Compute
  Engine → Disks.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~beszel"
  ```

> **Attention :** ce PVC **est** la base de données. Supprimer le StatefulSet avec son
> PVC, ou supprimer le disque sous-jacent, efface tout l'historique de supervision et
> le compte administrateur. Consultez [App_GKE](App_GKE.md) pour les détails sur le
> StatefulSet et la classe de stockage.

### C. Secret Manager {#c-secret-manager}

Beszel n'injecte **aucun** secret applicatif — il n'y a ni clé de chiffrement, ni
secret JWT, ni mot de passe de base de données à gérer (la base est un SQLite
intégré et l'administrateur est créé dans l'interface). La liste des secrets ne
montre que ceux que le socle crée lui-même.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI si vous ajoutez
des secrets via `secret_environment_variables`.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée comme Service `ClusterIP` (au sein du
cluster uniquement). Activez un domaine personnalisé avec un certificat géré par
Google, ou un LoadBalancer/une Gateway, afin que les agents distants et les
navigateurs puissent joindre le hub. Une IP statique peut être réservée pour que
l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs. (Notez que Beszel est lui-même un produit de supervision — la
supervision GCP observe ici le *hub*, pas les machines que Beszel surveille.)

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Beszel {#3-beszel-application-behaviour}

- **Pas de job d'initialisation ; le schéma est autogéré.** Beszel crée et migre
  automatiquement sa base PocketBase/SQLite intégrée au premier démarrage (et à chaque
  mise à niveau de version). Il n'y a pas de job `db-init`, car il n'y a pas de base
  de données externe.
- **L'état réside sur le PVC bloc.** Tout ce qui se trouve sous `/beszel_data` — la
  base SQLite, la configuration et les métriques historiques — est conservé sur le
  Persistent Volume. Les redémarrages de pod et les mises à niveau de version
  rattachent le même PVC, de sorte que l'historique est préservé.
- **La configuration initiale se fait dans l'interface.** Accédez à l'URL du service
  et terminez la création du compte superutilisateur (administrateur) au premier
  lancement de PocketBase. Aucun identifiant administrateur n'est généré
  automatiquement dans Secret Manager. Après avoir créé l'administrateur, ajoutez les
  systèmes à superviser et installez l'agent Beszel sur chacun d'eux (le hub affiche
  la commande d'installation de l'agent et la clé publique).
- **Écrivain unique — pas de mise à l'échelle horizontale.** Un fichier SQLite sur un
  PVC signifie qu'un seul pod peut écrire. `min = max = 1`, et un seul pod peut
  posséder le PVC à la fois. Une garde au moment du plan rejette
  `min_instance_count > max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`,
  qui renvoie `200` dès que le hub est prêt. Vérifiez le port et les variables
  d'environnement injectés :
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -i port
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Beszel ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe — Identité de l'application {#group--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `beszel` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Beszel. `latest` résout l'image de base vers la version épinglée `0.9.1` ; définissez un tag explicite pour maîtriser les mises à niveau. |

### Groupe — Exécution et mise à l'échelle {#group--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; Beszel est léger, 1 vCPU suffit largement. |
| `memory_limit` | `1Gi` | Mémoire par pod ; 512 Mi–1 Gi est typique. |
| `min_instance_count` | `1` | Maintenu à 1 — un seul écrivain SQLite. |
| `max_instance_count` | `1` | **Ne l'augmentez pas.** Plus d'un pod corrompt la base SQLite partagée. |
| `enable_cloudsql_volume` | `false` | Pas de sidecar Cloud SQL Auth Proxy ; Beszel utilise un SQLite intégré. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Beszel dans Artifact Registry. |

### Groupe — Backend et cluster GKE {#group--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interne par défaut ; exposez-le via un domaine personnalisé / un LoadBalancer pour les agents externes. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` parce que `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Un seul pod, le routage persistant est donc inutile. |

### Groupe — StatefulSet {#group--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Beszel est avec état — un PVC bloc héberge sa base SQLite. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod pour `/beszel_data`. |
| `stateful_pvc_mount_path` | `/beszel_data` | Chemin de montage de la base SQLite et de l'historique des métriques. |

### Groupe — Stockage et système de fichiers {#group--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé ; Beszel persiste sur le PVC bloc, pas dans NFS. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires (le volume GCS `/beszel_data` est désactivé lorsque le PVC est utilisé). |
| `create_cloud_storage` | `true` | Provisionne le ou les buckets de stockage déclarés. |

### Groupe — Cache et file d'attente Redis {#group--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` (effective) | La variable elle-même vaut `true` par défaut, mais le `main.tf` du wrapper code en dur `enable_redis = false` dans l'appel au socle et ne transmet jamais `var.enable_redis` — Beszel n'utilise pas Redis. |

### Groupe — Observabilité et santé {#group--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s delay | Sonde de démarrage ; fenêtre de 10 tentatives pour la création du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` 30s delay | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif sur le hub. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour joindre Beszel. |
| `statefulset_name` | Nom du StatefulSet Beszel. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (aucun par défaut). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un type de charge de travail `Deployment` combiné à `stateful_pvc_enabled = true`, des valeurs mémoire de ResourceQuota en unités binaires, `min_instance_count > max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC du StatefulSet / disque sous-jacent | Ne jamais le supprimer | Critique | Le PVC **est** la base SQLite — le supprimer efface tout l'historique de supervision et le compte administrateur. |
| `max_instance_count` | `1` | Critique | Exécuter plus d'un pod sur le PVC SQLite partagé provoque des conflits de verrous et une corruption de la base. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver supprime le volume bloc durable, si bien que l'état SQLite est perdu au redémarrage du pod. |
| `workload_type` | laisser `null` (→ StatefulSet) | Élevé | Définir `Deployment` avec `stateful_pvc_enabled = true` fait échouer une garde au moment du plan. |
| `enable_cloudsql_volume` / `database_type` | `false` / pas de SQL | Élevé | Beszel n'a pas de base externe ; activer Cloud SQL provisionne une instance inutilisée et perturbe le démarrage. |
| `service_type` / domaine personnalisé | exposer délibérément | Élevé | Laissé en `ClusterIP` sans Ingress, les agents distants situés hors du cluster ne peuvent pas joindre le hub. |
| `enable_iap` | uniquement pour l'interface, jamais avec des agents hors Google | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris la remontée des métriques des agents. |
| `quota_memory_requests` / `_limits` | unités binaires (`1Gi`, `1024Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent tout ordonnancement de pod dans l'espace de noms. |
| `container_port` | `8090` | Moyen | Le hub n'écoute que sur 8090 ; le modifier sans adapter l'image casse les sondes et le Service. |
| `application_version` | épinglez-la explicitement | Moyen | `latest` résout l'image de base vers la version épinglée `0.9.1` ; épinglez un vrai tag pour maîtriser les mises à niveau et les migrations de schéma. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Beszel, partagée
avec la variante Cloud Run, est décrite dans **[Beszel_Common](Beszel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Beszel sur GKE Autopilot](../labs/Beszel_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Beszel sur Google Cloud Run](Beszel_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Beszel Common — Configuration applicative partagée](Beszel_Common.md) — la configuration partagée par les deux cibles de déploiement.
