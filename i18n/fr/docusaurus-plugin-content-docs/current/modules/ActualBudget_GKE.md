---
title: "ActualBudget sur GKE Autopilot"
description: "Référence de configuration pour déployer ActualBudget sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ActualBudget_GKE.md @ 3055034 sha256:077708a12703 -->

# ActualBudget sur GKE Autopilot {#actualbudget-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ActualBudget_GKE.png" alt="ActualBudget sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Actual Budget est une application de finances personnelles centrée sur la confidentialité et
le fonctionnement en local (local-first), fondée sur la budgétisation par enveloppes à base
zéro. Le composant `actual-server` est un serveur de synchronisation Node.js léger qui stocke
chaque budget dans un fichier SQLite et le synchronise entre l'interface web et les clients
de bureau et mobiles. Ce module déploie ActualBudget sur **GKE Autopilot** sous la forme d'un
**StatefulSet** doté d'un PVC de type bloc par pod, au-dessus de la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud qu'utilise ActualBudget et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ActualBudget s'exécute comme une charge de travail Node.js `actual-server` unique. Comme il
gère son propre stockage SQLite, le déploiement assemble un ensemble volontairement restreint
de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods `actual-server`, 1 vCPU / 1 GiB par défaut, réplica unique (`min = max = 1`) exécuté en tant que **StatefulSet** |
| Base de données | Aucune | Les budgets sont des fichiers SQLite sous `/data` — `database_type = "NONE"` est imposé par `ActualBudget_Common` ; aucune instance Cloud SQL n'est créée |
| Stockage persistant | PVC Kubernetes (volume bloc par pod) | `stateful_pvc_enabled = true` par défaut — un PVC `standard-rwo` de 20Gi monté sur `/data` (SQLite a besoin d'un stockage bloc, pas de GCS FUSE) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours déclaré par `ActualBudget_Common` ; il n'est monté sur `/data` (via GCS FUSE) que lorsque le PVC bloc est désactivé |
| Secrets | Secret Manager | Facultatif — un jeton d'API de 32 caractères (`enable_api_key`, par défaut `false`) injecté en tant que `ACTUAL_TOKEN` via un Secret Kubernetes natif |
| Ingress | Service Kubernetes / Gateway API | Par défaut `service_type = ClusterIP` avec `enable_custom_domain = true` mais aucun domaine configuré — accès interne uniquement tant que vous n'ajoutez pas un LoadBalancer ou un domaine |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **StatefulSet + PVC bloc par défaut.** `stateful_pvc_enabled = true` résout automatiquement
  `workload_type` en `StatefulSet` (inutile de définir les deux) et monte un PVC
  `standard-rwo` de 20Gi sur `/data` avec `fsGroup = 3000`, conformément à la convention du
  chart Helm d'ActualBudget, afin que le conteneur (UID 1000/GID 2000) puisse écrire sur le
  volume. Ce choix est délibérément préféré à GCS FUSE, car SQLite supporte mal un répertoire
  monté via FUSE.
- **Aucune base de données.** `database_type` est fixé à `NONE` par `ActualBudget_Common` ; il
  n'y a ni instance Cloud SQL, ni job `db-init`, et `enable_cloudsql_volume` vaut `false` par
  défaut (pas de sidecar Cloud SQL Auth Proxy).
- **Redis est désactivé en dur, pas seulement désactivé par défaut.** Le `main.tf` de la
  variante transmet `enable_redis = false` à la fondation App_GKE sans condition — il ne
  transmet **pas** `var.enable_redis` — de sorte qu'ActualBudget ne reçoit jamais de
  `REDIS_HOST` sur GKE, quelle que soit la valeur de cette variable.
- **Réplica unique par conception.** `min_instance_count = 1` et `max_instance_count = 1` — le
  serveur suppose un accès exclusif à ses fichiers SQLite sur le PVC partagé.
- **`container_port` est fixé à `5006`** par `ActualBudget_Common`, quelle que soit la valeur
  de la variable `container_port` elle-même — cette variable est inerte (sa description et son
  texte de validation font référence à un `6333` obsolète, artefact de copier-coller inoffensif
  provenant d'un autre module).
- **Aucune génération d'identifiants administrateur ni de secret.** Le mot de passe du serveur
  est défini de manière interactive sur l'écran d'intégration du premier lancement — il n'y a
  aucun identifiant pré-créé à récupérer, sauf si `enable_api_key =
  true` génère un `ACTUAL_TOKEN`.
- **Les sondes de santé ciblent `/`** — HTTP `GET /` renvoie 200 dès que le serveur Node est à
  l'écoute, sans authentification.
- **Exposition interne uniquement par défaut.** `service_type` vaut par défaut `ClusterIP` (et
  non `LoadBalancer`, contrairement à la plupart des modules d'application GKE) et
  `enable_custom_domain` vaut `true` par défaut, mais `application_domains` vaut `[]` par
  défaut — un nouveau déploiement n'a donc aucun point de terminaison externe accessible tant
  que vous n'avez pas défini `service_type = LoadBalancer` ou fourni `application_domains`
  (ainsi que le DNS).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet ActualBudget {#a-gke-autopilot--the-actualbudget-statefulset}

ActualBudget s'exécute comme un StatefulSet à réplica unique, ce qui donne à son pod une
identité stable (`<statefulset-name>-0`) et rattache le même PVC lors des redémarrages et des
mises à jour.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail ActualBudget
  pour voir les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle
et le type de charge de travail (Deployment ou StatefulSet).

### B. Volumes persistants — le PVC bloc `/data` {#b-persistent-volumes--the-data-block-pvc}

Avec `stateful_pvc_enabled = true` (la valeur par défaut), un PersistentVolumeClaim par pod
est provisionné et monté sur `/data`, où `actual-server` écrit ses bases de données SQLite de
budget, ses fichiers serveur et ses fichiers utilisateur. La StorageClass `standard-rwo` par
défaut repose sur du SSD (Balanced PD) et consomme le quota régional `SSD_TOTAL_GB` (souvent
serré).

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- df -h /data
  ```

### C. Cloud Storage — le bucket `storage` (solution de repli GCS FUSE) {#c-cloud-storage--the-storage-bucket-gcs-fuse-fallback}

`ActualBudget_Common` déclare toujours un bucket Cloud Storage (`storage`), mais celui-ci
n'est monté sur `/data` via GCS FUSE que lorsque le PVC bloc est désactivé
(`stateful_pvc_enabled = false`). Avec le PVC du StatefulSet par défaut en place, ce bucket
existe mais n'est pas monté.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  ```

Consultez [App_GKE](App_GKE.md) pour le comportement des montages GCS Fuse et les options
CMEK.

### D. Secret Manager — jeton d'API facultatif {#d-secret-manager--optional-api-token}

Par défaut, aucun secret n'est créé. Lorsque `enable_api_key = true`, un jeton aléatoire de 32
caractères est généré, stocké dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key`
et injecté dans le pod en tant que variable d'environnement `ACTUAL_TOKEN` via un Secret
Kubernetes natif — utile pour les automatisations qui doivent appeler le serveur avant que
l'interface ne soit configurée.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### E. Réseau et ingress {#e-networking--ingress}

La charge de travail utilise par défaut `service_type = ClusterIP` — aucune IP externe n'est
créée d'emblée. `enable_custom_domain = true` provisionne une ressource Kubernetes Gateway
API, mais avec `application_domains = []` par défaut, il n'y a aucun nom d'hôte à router.
Définissez `service_type = LoadBalancer` pour obtenir une IP externe directe, ou renseignez
`application_domains` (avec un DNS pointant vers l'IP obtenue) pour une Gateway sur domaine
personnalisé avec un certificat géré.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services → Load balancing.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur
les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE sont envoyées
à Cloud Monitoring. Un test de disponibilité facultatif (`uptime_check_config`, désactivé par
défaut) nécessite un point de terminaison accessible publiquement, ce que la valeur par défaut
`ClusterIP` ne fournit pas.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application ActualBudget {#3-actualbudget-application-behaviour}

- **Aucun job d'initialisation.** Il n'y a aucune base de données à amorcer ; le serveur crée
  ses fichiers SQLite sous `/data` au premier démarrage. Des `initialization_jobs`
  personnalisés sont acceptés pour des tâches de chargement ou de migration de données, mais
  aucun n'est fourni par défaut.
- **Configuration du premier lancement.** Au premier accès, l'interface web affiche un écran
  d'intégration où vous définissez le **mot de passe du serveur** — il n'existe aucun
  identifiant pré-créé à récupérer. Faites-le immédiatement après avoir rendu le service
  accessible ; tant qu'aucun mot de passe n'est défini, toute personne pouvant atteindre l'URL
  peut s'approprier le serveur.
- **Organisation des données.** `ACTUAL_SERVER_FILES = /data/server-files` (métadonnées du
  serveur et base de données des comptes) et `ACTUAL_USER_FILES = /data/user-files` (données
  de synchronisation par budget), tous deux sur le montage persistant `/data` (PVC par
  défaut).
- **Modèle de synchronisation local-first.** Les clients (web, bureau, mobile) conservent une
  copie locale complète du budget et n'utilisent le serveur que pour synchroniser les
  modifications chiffrées entre appareils — une brève indisponibilité du serveur n'empêche
  pas de travailler dans un client.
- **Contrainte d'écrivain unique, mises à jour sûres du StatefulSet.** Le serveur suppose un
  accès exclusif à ses fichiers SQLite ; conservez `max_instance_count = 1`. Comme la charge
  de travail est un StatefulSet doté d'une identité stable par pod rattachée au même PVC, la
  stratégie `RollingUpdate` par défaut remplace le pod unique sur place au lieu de démarrer
  un second pod sur le volume partagé — contrairement aux combinaisons Deployment+NFS
  utilisées par d'autres modules de ce dépôt, il n'y a ici aucun risque d'interblocage dû à
  un double montage.
- **Priorité des sondes.** `startup_probe_config` et `health_check_config` (les variables de
  sonde génériques de premier niveau d'App_GKE) sont **inertes** pour ActualBudget — la
  configuration effective des sondes provient toujours des variables `startup_probe` /
  `liveness_probe` propres à ActualBudget (transmises via la sortie `config`
  d'`ActualBudget_Common`), qui ciblent toutes deux HTTP `GET /` sans authentification.
- **Mises à jour de version.** Modifiez `application_version` et réappliquez — Cloud Build
  produit une nouvelle image et le StatefulSet déploie la nouvelle révision. `latest` construit
  la version épinglée `25.7.1` via l'ARG de build spécifique à l'application
  `ACTUALBUDGET_VERSION` (et non l'`APP_VERSION` générique que la fondation injecte).
- **Chemin de santé.** Sonde de démarrage : HTTP `GET /`, délai initial de 15s, timeout de
  10s, période de 10s, 10 échecs tolérés. Sonde de vivacité : HTTP `GET /`, délai initial de
  30s, timeout de 5s, période de 30s, 3 échecs tolérés. Les deux renvoient 200 sans
  authentification dès que le serveur HTTP est à l'écoute.
- **Vérification :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')
  kubectl port-forward -n "$NAMESPACE" "$POD" 5006:5006 &
  curl -s -o /dev/null -w "%{http_code}\n" http://localhost:5006/   # expect 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à ActualBudget ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `actualbudget` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` construit la version épinglée `25.7.1`. |
| `enable_api_key` | `false` | Génère un jeton d'API de 32 caractères dans Secret Manager et l'injecte en tant que `ACTUAL_TOKEN`. Recommandé pour tout déploiement accessible en dehors du pod/de l'espace de noms. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | `actual-server` est un processus Node.js léger ; 1 vCPU suffit. |
| `memory_limit` | `1Gi` | Une mémoire modeste suffit pour des fichiers de budget typiques. |
| `min_instance_count` | `1` | Garde l'instance unique active et évite les démarrages à froid. |
| `max_instance_count` | `1` | **Conservez 1** — un seul volume SQLite partagé, un seul écrivain. |
| `container_port` | `5006` | Inerte — `ActualBudget_Common` fixe toujours le port du conteneur à `5006`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Réplique `actualbudget/actual-server` dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Accessible depuis l'extérieur par défaut, comme tous les autres modules d'application GKE destinés au navigateur. Définissez `ClusterIP` pour le garder interne uniquement. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | Aucun routage persistant configuré (le réplica unique rend ce point largement sans objet). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Activé par défaut — la base SQLite de budget et les fichiers utilisateur d'`actual-server` nécessitent un stockage bloc, pas GCS FUSE. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; dimensionnez-la pour les bases de données et fichiers de budget, marge comprise. |
| `stateful_pvc_mount_path` | `/data` | Emplacement où `actual-server` conserve sa base SQLite, ses fichiers serveur et ses fichiers utilisateur. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD sur SSD ; consomme le quota `SSD_TOTAL_GB` — remplacez par `standard` (HDD) si ce quota est serré. |
| `stateful_fs_group` | `3000` | Correspond à la convention `fsGroup` du chart Helm d'ActualBudget afin que le conteneur (UID 1000/GID 2000) puisse écrire sur le PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Activé par défaut (contrairement à la plupart des modules) — protège le réplica unique du StatefulSet lors des interruptions volontaires de nœud. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors des interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 15s, 10 échecs | La sonde de démarrage **effective** (voir §3 « Priorité des sondes »). |
| `liveness_probe` | HTTP `/`, délai initial de 30s, 3 échecs | La sonde de vivacité **effective**. |
| `startup_probe_config` / `health_check_config` | HTTP `/` | Déclarées pour refléter les variables de la fondation, mais **inertes** pour ActualBudget — utilisez plutôt `startup_probe` / `liveness_probe` ci-dessus. |
| `uptime_check_config` | désactivé | À activer uniquement une fois le point de terminaison accessible publiquement (`LoadBalancer` ou domaine personnalisé). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée toujours le bucket `storage` que déclare `ActualBudget_Common`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le bucket `storage` n'est monté automatiquement sur `/data` que lorsque `stateful_pvc_enabled = false`. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la variable) | **Sans effet** — `main.tf` impose `enable_redis = false` à la fondation, quelle que soit la valeur de cette variable. |
| `redis_host` / `redis_port` / `redis_auth` | inertes | Sans objet — ActualBudget n'a pas d'intégration Redis sur GKE. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `NONE` (fixe) | `ActualBudget_Common` le fixe à `NONE` ; aucune instance Cloud SQL n'est créée, quelle que soit cette variable. |
| `application_database_name` / `application_database_user` | `actualbudgetdb` / `actualbudgetuser` | Transmises uniquement pour la compatibilité avec la fondation — non référencées (il n'existe aucune base de données). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut, mais avec `application_domains = []`, la Gateway n'a aucun nom d'hôte à router tant que vous n'en fournissez pas un. |
| `application_domains` | `[]` | À renseigner pour exposer ActualBudget via un domaine personnalisé + certificat géré. |
| `reserve_static_ip` | `true` | Réserve une IP statique même si `service_type` vaut par défaut `ClusterIP` (aucune IP de LoadBalancer n'est allouée par défaut). |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL pour accéder à ActualBudget. |
| `actualbudget_api_key_secret_id` | ID du secret Secret Manager de la clé d'API. Vide lorsque `enable_api_key = false`. |
| `statefulset_name` | Nom du StatefulSet. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés (vide par défaut). |
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

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous forme d'entiers bruts, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Plusieurs pods écrivant dans les mêmes fichiers SQLite sur un même volume partagé exposent à une corruption ou à des conflits d'écriture. |
| Mot de passe du serveur au premier lancement | à définir immédiatement | Critical | Tant qu'aucun mot de passe n'est défini, toute personne pouvant atteindre le service peut s'approprier le serveur et ses données de budget. |
| Contenu du PVC `/data` | ne jamais supprimer manuellement | Critical | Le PVC bloc est la seule copie des bases de données de budget ; le supprimer efface tous les budgets. |
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver entraîne un repli sur GCS FUSE pour `/data`, qui ne supporte pas SQLite sous de fortes écritures concurrentes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods. |
| `service_type` / `application_domains` | en définir un pour exposer en externe | High | Avec les valeurs par défaut (`ClusterIP` + aucun domaine), le service n'est accessible que depuis l'intérieur du cluster. |
| `stateful_pvc_storage_class` | `standard-rwo` (SSD) | Medium | Consomme le quota serré `SSD_TOTAL_GB` ; remplacez par `standard` (HDD) sur un projet limité en quota — SQLite n'a pas besoin des IOPS d'un SSD. |
| `enable_redis` | n'importe quelle valeur — **inerte** | Low | Tenter d'activer Redis via cette variable n'a aucun effet sur GKE ; `main.tf` le force toujours à désactivé. |
| `container_port` | `5006` (fixe) | Low | La variable est inerte ; sa propre description et son texte de validation font référence à un numéro de port obsolète et sans rapport. |
| `startup_probe_config` / `health_check_config` | n'importe quelle valeur — **inertes** | Low | Utilisez plutôt `startup_probe` / `liveness_probe` pour modifier le timing des sondes ; ces deux variables sont ignorées pour ActualBudget. |
| `enable_api_key` | `true` pour l'automatisation sur un point de terminaison accessible | Medium | Sans `ACTUAL_TOKEN`, l'accès programmatique à l'API repose uniquement sur le mot de passe du serveur. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et réplication d'images — consultez **[App_GKE](App_GKE.md)**. La
configuration applicative propre à ActualBudget, partagée avec la variante Cloud Run, est
décrite dans **[ActualBudget_Common](ActualBudget_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ActualBudget sur GKE Autopilot](../labs/ActualBudget_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [ActualBudget Common — Configuration applicative partagée](ActualBudget_Common.md) — la configuration partagée par les deux cibles de déploiement.
