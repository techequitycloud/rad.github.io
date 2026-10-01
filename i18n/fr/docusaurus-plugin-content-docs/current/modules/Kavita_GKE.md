---
title: "Kavita sur GKE Autopilot"
description: "Référence de configuration pour déployer Kavita sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Kavita_GKE.md @ 3055034 sha256:9f80b9711558 -->

# Kavita sur GKE Autopilot {#kavita-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kavita_GKE.png" alt="Kavita sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kavita est une bibliothèque numérique et un serveur de lecture auto-hébergés,
rapides et riches en fonctionnalités, pour les bandes dessinées, les mangas et
les livres numériques — une interface web de lecture épurée, des flux OPDS, des
collections, des listes de lecture et une recherche plein texte sur votre
bibliothèque, le tout construit sur .NET avec une base de données SQLite interne.
Ce module déploie Kavita sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Kavita et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Kavita s'exécute comme une unique charge de travail web .NET **sans base de
données ni cache externes** — tout ce dont il a besoin (paramètres, base de
données SQLite interne et index de la bibliothèque) se trouve sur le disque sous
`/kavita/config`.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod web .NET sur le port 5000, `1000m` de CPU / `1Gi` de mémoire par défaut |
| Base de données | **Aucune** — SQLite interne | `database_type` est fixé à `NONE` par `Kavita_Common` ; aucune instance Cloud SQL n'est créée |
| Persistance de l'état | PVC bloc par pod (StatefulSet) | `/kavita/config` contient la base de données SQLite (`kavita.db`) et les paramètres de l'application ; **activé par défaut** (`stateful_pvc_enabled = true`) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est provisionné par `Kavita_Common`, mais il n'est monté sur `/kavita/config` que lorsque le PVC bloc est désactivé |
| Secrets | Secret Manager | **Aucun secret généré** — l'assistant de configuration du premier lancement crée le compte administrateur ; `secret_ids`/`secret_values` sont vides |
| Entrée | Kubernetes Gateway API | Service `ClusterIP` par défaut, exposé via la Gateway avec une IP statique réservée ; domaine personnalisé pris en charge |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite réside sur un véritable PVC bloc, et non sur GCS FUSE.**
  `stateful_pvc_enabled` vaut `true` par défaut ; Kavita s'exécute donc comme un
  `StatefulSet` avec un PVC bloc par pod monté sur `/kavita/config`. C'est
  délibéré : gcsfuse corrompt les index SQLite et multimédias, si bien que le
  montage GCS FUSE (`enable_gcs_storage_volume`) n'est utilisé qu'en solution de
  repli lorsque le PVC bloc est désactivé. Si vous définissez un jour
  `stateful_pvc_enabled = false`, la base de données SQLite et les métadonnées de
  la bibliothèque de Kavita sont déplacées vers le bucket `storage` adossé à GCS
  FUSE — ne le faites que si vous comprenez le risque de SQLite sur gcsfuse.
- **Le bucket GCS `storage` est créé dans tous les cas, mais n'est monté que sous
  condition.** `Kavita_Common` déclare toujours une sortie de bucket `storage`,
  mais la surcouche GKE définit
  `enable_gcs_storage_volume = !stateful_pvc_enabled` ; avec le PVC bloc par
  défaut en place, ce bucket existe donc mais n'est **pas** monté dans le pod.
- **Un seul réplica par défaut, et cela doit rester ainsi.**
  `min_instance_count =
  1`, `max_instance_count = 1`. Kavita sert une unique
  bibliothèque SQLite partagée à partir d'un seul volume — sans clustering ni
  coordination du stockage partagé ; exécuter plus d'un réplica sur le même PVC
  n'est donc pas sûr.
- **NFS est désactivé par défaut** (`enable_nfs = false`) — la persistance est
  entièrement assurée par le PVC du StatefulSet, et non par Filestore.
- **Aucun job d'initialisation de base de données au premier démarrage.**
  Kavita n'a pas de tâche `db-init` ni de migration ; `initialization_jobs` est
  par défaut une liste vide, et seules les tâches personnalisées que vous
  fournissez sont exécutées.
- **Aucun secret généré automatiquement.** Contrairement à la plupart des modules
  d'application, Kavita ne crée aucun mot de passe administrateur ni aucune clé
  d'API dans Secret Manager — le compte administrateur est créé via l'assistant
  de configuration du premier lancement de l'interface web, la première fois que
  vous ouvrez le service.
- **`session_affinity` vaut `None` et `service_type` vaut `ClusterIP`** — l'accès
  externe passe par la Gateway API (`enable_custom_domain = true` par défaut)
  plutôt que par un Service LoadBalancer exposé directement.
- **Redis est forcé à l'arrêt.** La valeur par défaut du socle `App_GKE` pour
  `enable_redis` est `true`, mais le `main.tf` de `Kavita_GKE` code en dur
  `enable_redis = false` — Kavita n'a aucun usage de Redis, et ce choix ne peut
  pas être remplacé via les variables du module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kavita {#a-gke-autopilot--the-kavita-workload}

Kavita s'exécute par défaut comme un `StatefulSet` (sélectionné automatiquement
parce que `stateful_pvc_enabled
= true`), ce qui donne à chaque pod une identité
stable et son propre PVC. Comme il s'agit d'une application SQLite à réplica
unique et à écrivain unique, ne la mettez pas à l'échelle horizontalement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge
  de travail Kavita pour consulter les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector app.kubernetes.io/name~kavita 2>/dev/null || \
    kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Stockage persistant — PVC bloc (SQLite + métadonnées de la bibliothèque) {#b-persistent-storage--block-pvc-sqlite--library-metadata}

La configuration de Kavita, sa base de données SQLite interne (`kavita.db`) et
les métadonnées de la bibliothèque résident toutes sous `/kavita/config`, qui est
par défaut une **Persistent Volume Claim bloc par pod**
(`stateful_pvc_enabled = true`, `stateful_pvc_size = "20Gi"`,
`stateful_pvc_storage_class = "standard-rwo"`). Il s'agit d'un véritable stockage
bloc — et non d'un montage GCS FUSE — car gcsfuse corrompt les fichiers SQLite et
les fichiers d'index multimédias.

- **Console :** Kubernetes Engine → Storage pour le PVC ; Compute Engine →
  Disks pour le disque persistant sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  gcloud compute disks list --project "$PROJECT" --filter="name~kavita"
  ```

`standard-rwo` est adossé à du SSD (Balanced PD) et consomme le quota
`SSD_TOTAL_GB` du projet — consultez [App_GKE](App_GKE.md) et les
recommandations du dépôt sur les classes de stockage pour passer au HDD
(`stateful_pvc_storage_class = "standard"`) si le quota SSD est limité. Perdre ce
PVC fait perdre l'intégralité de l'index de la bibliothèque Kavita, des
paramètres et de la progression de lecture.

### C. Cloud Storage (le bucket `storage` non monté) {#c-cloud-storage-the-unmounted-storage-bucket}

`Kavita_Common` provisionne un bucket Cloud Storage (suffixe `storage`) quelle
que soit la disposition de stockage utilisée. Avec la disposition par défaut à
PVC bloc, il est créé mais non monté ; il n'est monté sur `/kavita/config` via
GCS FUSE que lorsque `stateful_pvc_enabled = false`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~kavita"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages via le
pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Kavita n'a **aucun secret généré** — ce module ne crée ni mot de passe
administrateur, ni clé d'API, ni clé de signature. Les secrets personnalisés que
vous configurez via `secret_environment_variables` transitent néanmoins par
Secret Manager et le pilote Secret Store CSI, comme pour tout autre module
d'application GKE.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kavita"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail utilise un Service `ClusterIP`
(`service_type = "ClusterIP"`) exposé à l'extérieur via la Kubernetes Gateway API
(`enable_custom_domain =
true`) avec une IP statique réservée
(`reserve_static_ip = true`).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques GKE vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles (`uptime_check_config` est désactivé par
défaut pour ce module).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards
  / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kavita {#3-kavita-application-behaviour}

- **Aucune tâche d'amorçage de base de données.** Kavita gère entièrement son
  stockage SQLite à l'exécution ; `Kavita_Common` n'injecte aucune tâche
  `db-init` ni de migration, et `initialization_jobs` vaut `[]` par défaut.
- **Assistant de configuration au premier démarrage.** Il n'existe ni compte
  administrateur pré-créé ni identifiant généré. Ouvrez l'URL du service :
  l'assistant de configuration du premier lancement vous guide dans la création
  du compte administrateur initial et l'ajout de votre première bibliothèque.
- **La disposition du stockage est contrôlée par `stateful_pvc_enabled`.** Avec
  la valeur par défaut `true`, Kavita s'exécute comme un `StatefulSet` et
  `/kavita/config` (configuration + `kavita.db` SQLite) est un PVC bloc
  (`stateful_pvc_size = "20Gi"`, classe de stockage `standard-rwo`,
  `stateful_fs_group = 3000` pour que le volume soit accessible en écriture au
  groupe). Si vous le désactivez, `Kavita_Common` monte à la place le bucket GCS
  `storage` au même chemin via GCS FUSE (`enable_gcs_storage_volume = true` dans
  ce cas). `stateful_pod_management_policy` vaut `null` par défaut (valeur par
  défaut `OrderedReady` d'App_GKE), ce qui est le réglage sûr pour les
  redémarrages de Kavita à écrivain unique.
- **Écrivain unique, réplica unique.** `min_instance_count = 1` et
  `max_instance_count = 1` par défaut — Kavita n'a pas de mode distribué ni de
  clustering ; n'augmentez donc pas `max_instance_count` tant qu'un seul PVC et
  une seule base de données SQLite servent de support à la charge de travail.
- **Chemins des sondes de santé.** La sonde de démarrage (`startup_probe` /
  `startup_probe_config`) et la sonde de vivacité (`liveness_probe` /
  `health_check_config`) sont toutes deux des requêtes **HTTP `GET /api/health`**
  non authentifiées. La sonde de démarrage utilise une marge d'échecs plus large
  (`initial_delay_seconds = 15`, `period_seconds = 10`, `failure_threshold = 10`)
  pour tolérer une indexation de la bibliothèque plus lente au premier démarrage,
  avant que la sonde de vivacité (`initial_delay_seconds = 30`,
  `period_seconds = 30`, `failure_threshold = 3`) prenne le relais.
- **Redis est désactivé de force.** Le `main.tf` de `Kavita_GKE` définit
  `enable_redis = false` sans condition lors de l'appel à `App_GKE`, ce qui
  remplace la valeur par défaut `enable_redis = true` du socle — aucun
  `REDIS_HOST`/`REDIS_PORT` n'est jamais injecté.
- **Build d'image personnalisé.** Le conteneur est construit à partir d'un
  Dockerfile qui est une fine surcouche (`FROM jvmilazz0/kavita:${KAVITA_VERSION}`) ;
  `application_version = "latest"` se résout en l'argument de build épinglé
  `KAVITA_VERSION = 0.8.7` (changer de version impose de modifier la valeur
  épinglée dans `Kavita_Common`, pas seulement de redéployer).
- **Vérifier la charge de travail et le PVC après le déploiement :**
  ```bash
  kubectl get statefulset,pvc,pods -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /kavita/config
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 5000:5000
  curl -s http://127.0.0.1:5000/api/health
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Kavita ou notables pour
lui sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kavita` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Kavita` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Tag de l'image Kavita ; `latest` construit la version épinglée `KAVITA_VERSION = 0.8.7`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Limite de CPU du conteneur Kavita. |
| `memory_limit` | `1Gi` | Limite de mémoire ; Kavita est un serveur .NET léger, à l'aise avec de grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenu à 1 pour éviter les démarrages à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | **Laissez à 1** — Kavita ne prend en charge ni le clustering ni les écritures partagées. |
| `container_port` | `5000` (fixé par `Kavita_Common`) | Non transmis à `App_GKE` ; le conteneur écoute toujours sur le port 5000. |
| `enable_cloudsql_volume` | `false` | Kavita n'utilise pas Cloud SQL — laissez `false`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'accès externe passe par la Gateway API, et non par un LoadBalancer direct. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` parce que `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucun routage persistant n'est nécessaire avec un seul réplica. |

### Groupe 7 — StatefulSet / PVC bloc {#group-7--statefulset--block-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Activé par défaut.** Provisionne le PVC bloc par pod qui contient la configuration et la base de données SQLite de Kavita. |
| `stateful_pvc_size` | `20Gi` | Taille du volume de configuration/bibliothèque/SQLite ; augmentez-la pour les grandes collections. |
| `stateful_pvc_mount_path` | `/kavita/config` | Doit rester le répertoire de données de Kavita (configuration + `kavita.db`). |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD adossé à du SSD ; consomme le quota `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `3000` | Rend le PVC accessible en écriture au groupe pour le processus de Kavita (UID 1000 / GID 2000). |
| `stateful_pod_management_policy` | `null` → `OrderedReady` | Requis pour des redémarrages sûrs de la charge de travail SQLite à écrivain unique. |

### Groupe 15 — Redis (inerte pour Kavita) {#group-15--redis-inert-for-kavita}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) | **Remplacée par `false`** dans le `main.tf` de `Kavita_GKE`, quelle que soit cette valeur — Kavita n'utilise jamais Redis. |
| `redis_host` / `redis_port` / `redis_auth` | — | Transmises au socle uniquement par souci de compatibilité ; sans objet pour Kavita. |

### Groupe 16 — Base de données (sans objet) {#group-16--database-not-applicable}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Kavita_Common` — Kavita stocke tout dans SQLite en interne ; aucune instance Cloud SQL n'est créée. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | L'entrée via la Gateway API est activée par défaut pour Kavita. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |
| `enable_nfs` | `false` | Désactivé par défaut — la persistance passe par le PVC bloc, et non par Filestore. |

Toutes les autres entrées suivent le comportement standard
d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Kavita. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `storage`, monté uniquement lorsque `stateful_pvc_enabled = false`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuelles jobs d'initialisation personnalisés que vous avez fournies (aucune par défaut). |
| `statefulset_name` | Nom du StatefulSet (présent puisque Kavita utilise par défaut le type de charge de travail StatefulSet). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé en même temps qu'un réglage sans état, IAP sans identités autorisées, des `quota_memory_*` exprimés en entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (valeur par défaut) | Critical | Le désactiver déplace la base de données SQLite de Kavita vers un montage GCS FUSE, ce qui risque de corrompre le fichier SQLite et l'index de la bibliothèque en cas d'écritures concurrentes. |
| `stateful_pvc_mount_path` | `/kavita/config` | Critical | Doit correspondre au répertoire de données fixe de Kavita ; le modifier sépare l'application de son état de configuration/SQLite. |
| `max_instance_count` | `1` | Critical | Kavita n'offre ni clustering ni coordination des écritures partagées ; plus d'un réplica sur le même PVC risque de corrompre SQLite. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Le SSD consomme le quota `SSD_TOTAL_GB`, très limité ; sur un projet contraint par les quotas, passez au HDD (`standard`), car les besoins d'E/S de Kavita n'exigent pas les IOPS d'un SSD. |
| `enable_nfs` | `false` | Low | NFS est inutile — la persistance passe par le PVC bloc ; l'activer ajoute un coût sans aucun bénéfice pour la disposition par défaut de ce module. |
| `enable_redis` | forcé à `false` dans `main.tf` | Low | Définir cette variable n'a aucun effet — Kavita n'utilise jamais Redis, quelle que soit la valeur transmise. |
| `stateful_fs_group` | `3000` | High | Kavita s'exécute en tant qu'UID 1000/GID 2000 ; un `fsGroup` incorrect ou non défini peut empêcher le conteneur d'écrire sur le PVC au démarrage. |
| `memory_limit` | `1Gi` | Medium | Suffisant pour de grandes bibliothèques ; une valeur trop basse expose à des erreurs OOM pendant les analyses de la bibliothèque ou l'indexation plein texte. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| Compte administrateur du premier lancement | Terminez l'assistant de configuration rapidement après le déploiement | Medium | Tant que l'assistant n'a pas été exécuté, le service est accessible mais ne dispose d'aucun compte administrateur ni d'aucune bibliothèque configurée. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et les URL OPDS enregistrées en favoris. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation réglementaire ; Kavita n'a pas de voie de sauvegarde de base de données distincte, puisque tout son état réside sur le PVC. |

---

Pour le comportement du socle auquel ce guide fait référence — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Kavita partagée
avec la variante Cloud Run est décrite dans
**[Kavita_Common](Kavita_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kavita sur GKE Autopilot](../labs/Kavita_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Kavita sur Google Cloud Run](Kavita_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Kavita Common — Configuration applicative partagée](Kavita_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Calibre-Web sur GKE Autopilot](CalibreWeb_GKE.md), [Komga sur GKE Autopilot](Komga_GKE.md), [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md), [Navidrome sur GKE Autopilot](Navidrome_GKE.md) dans la solution **Digital Library**.
