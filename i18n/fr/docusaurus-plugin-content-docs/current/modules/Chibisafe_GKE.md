---
title: "Chibisafe sur GKE Autopilot"
description: "Référence de configuration pour déployer Chibisafe sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Chibisafe_GKE.md @ 3055034 sha256:e10181553296 -->

# Chibisafe sur GKE Autopilot {#chibisafe-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Chibisafe_GKE.png" alt="Chibisafe sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Chibisafe est un outil auto-hébergé de téléversement de fichiers et d'images,
doté d'un tableau de bord moderne, du téléversement par glisser-déposer,
d'albums et d'une API publique. Ce module déploie la **pile Chibisafe complète**
— l'interface web à `/`, l'API REST sous `/api`, la référence OpenAPI à `/docs`
et les fichiers téléversés servis par leur nom — sous la forme d'une seule charge
de travail sur **GKE Autopilot**, en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.
En amont, Chibisafe est distribué sous forme de trois conteneurs (le backend
chibisafe-server, un front-end Next.js et un reverse proxy Caddy) ; ce module les
regroupe dans une seule image construite sur mesure.

> **Statut :** l'image de la pile complète n'a pas encore été construite ni
> déployée ; le comportement décrit ci-dessous est donc tiré du code source du
> module et de la version amont `v6.5.5`, et non vérifié en conditions réelles.

Ce guide se concentre sur les services cloud utilisés par Chibisafe et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Chibisafe s'exécute sous la forme d'une unique charge de travail — un conteneur
avec Caddy devant deux processus Node.js (backend et front-end) — sans base de
données externe. Le déploiement assemble un ensemble ciblé de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod de pile complète (Caddy sur le port 8000 → backend + front-end Next.js sur la boucle locale), StatefulSet par défaut, 1 vCPU / 1 GiB par défaut |
| Base de données | Aucune | Chibisafe conserve sa base SQLite, ses fichiers téléversés et ses journaux sur le volume persistant — aucune instance Cloud SQL n'est créée |
| Stockage bloc | PVC de StatefulSet GKE | PVC `standard-rwo` de 20Gi par défaut monté sur `/data`, contenant la base SQLite, les fichiers téléversés et les journaux |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est toujours provisionné ; il n'est monté comme volume GCS FUSE que lorsque le PVC du StatefulSet est désactivé |
| Secrets | Secret Manager | `ADMIN_PASSWORD` facultatif (contrôlé par `enable_api_key`, désactivé par défaut) |
| Entrée | Kubernetes Gateway / Cloud Load Balancing | Domaine personnalisé + certificat géré activés **par défaut** (`enable_custom_domain = true`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule « base de données ».** `database_type` est fixé à `NONE`
  par `Chibisafe_Common` ; les nombreuses variables `database_*`/`db_*` reprises
  dans `variables.tf` n'existent que par souci de cohérence avec les conventions
  du socle et n'ont aucun effet.
- **StatefulSet + PVC bloc est la configuration par défaut.** SQLite ne tolère
  pas la sémantique de verrouillage de fichiers POSIX de GCS FUSE ;
  `stateful_pvc_enabled = true` est donc la valeur par défaut, ce qui résout
  automatiquement `workload_type` en `StatefulSet` avec un PVC `standard-rwo` de
  20Gi sur `/data`.
- **Rédacteur unique, réplica unique.** `min_instance_count = 1`, `max_instance_count
  = 1` — Chibisafe est une application SQLite à rédacteur unique ; ne dépassez pas
  1 sans repenser le stockage.
- **Image construite sur mesure avec un épinglage de version propre à
  l'application.** `image_source = "custom"` construit un Dockerfile basé sur
  `chibisafe/chibisafe-server` (backend dans `/app`) qui y copie le front-end
  Next.js `chibisafe/chibisafe` (`/opt/chibisafe-web`) et un binaire Caddy
  `2.11.4` statique. Le build lit son propre argument de build `CHIBISAFE_VERSION`
  (et non le `APP_VERSION` générique qu'injecte le socle ; une seule étiquette
  épingle le backend et le front-end) ; `application_version = "latest"` est
  épinglé sur `v6.5.5` au moment du build.
- **Jamais de Redis.** La variante reprend une variable `enable_redis` par souci de
  cohérence avec les conventions du socle, mais `main.tf` transmet toujours
  `enable_redis = false` à App_GKE, quelle que soit sa valeur — Chibisafe ne
  dépend pas de Redis.
- **Le domaine personnalisé est activé par défaut.** Contrairement à la plupart
  des modules, `enable_custom_domain =
  true` d'origine ; définissez `application_domains` pour que le certificat géré
  soit réellement associé à un nom d'hôte.
- **Aucun secret obligatoire.** `enable_api_key = false` par défaut — le backend
  crée le compte propriétaire de premier démarrage `admin` avec le mot de passe
  amont bien connu `admin` ; changez-le immédiatement après la première connexion
  dans l'interface web. Passez `enable_api_key` à `true` pour initialiser à la
  place un `ADMIN_PASSWORD` aléatoire provenant de Secret Manager.
- **Tout l'état réside sous un seul point de montage.** Le point d'entrée crée des
  liens symboliques des répertoires `/app/database`, `/app/uploads` et `/app/logs`
  de l'image vers des sous-répertoires de l'unique volume persistant (`/data`), en
  migrant au premier démarrage tout contenu fourni par l'image.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Chibisafe {#a-gke-autopilot--the-chibisafe-workload}

Les pods Chibisafe sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Avec la valeur par défaut
`stateful_pvc_enabled = true`, la charge de travail est un **StatefulSet** avec une
gestion des pods `OrderedReady` et un PVC stable par pod — mieux adapté qu'un
Deployment pour une application SQLite à rédacteur unique.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge
  de travail Chibisafe pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'adresse IP externe (le cas
  échéant).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector=app~chibisafe
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise
à l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Stockage persistant — PVC bloc et Cloud Storage {#b-persistent-storage--block-pvc-and-cloud-storage}

Chibisafe n'a aucun service de base de données à inspecter — son état (base
SQLite, fichiers téléversés et journaux) réside entièrement sur le volume
persistant monté sur `/data`. Par défaut, ce volume est un **PersistentVolumeClaim
bloc** par pod (`stateful_pvc_enabled = true`, 20Gi `standard-rwo`), qui offre aux
fichiers SQLite les E/S à faible latence et conformes à POSIX dont ils ont besoin.
Un bucket **Cloud Storage** `storage` est toujours provisionné par
`Chibisafe_Common`, mais il n'est monté comme volume GCS FUSE que lorsque le PVC
du StatefulSet est désactivé (`enable_gcs_storage_volume` est calculé comme
`!stateful_pvc_enabled` dans `main.tf`) — ce qui évite un double montage sur le
même chemin.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims pour le PVC ;
  Cloud Storage → Buckets pour le bucket `storage` toujours créé.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- df -h /data
  gcloud storage buckets list --project "$PROJECT" --filter="name~chibisafe"
  ```

Consultez [App_GKE](App_GKE.md) pour le cycle de vie des PVC de StatefulSet, les
options de StorageClass et les détails des montages GCS FUSE.

### C. Secret Manager {#c-secret-manager}

Chibisafe ne génère **aucun secret par défaut**. Le seul secret facultatif est un
mot de passe administrateur aléatoire, contrôlé par `enable_api_key` (par défaut
`false`) : lorsqu'il est activé, une valeur aléatoire de 24 caractères est stockée
dans Secret Manager (suffixe de nom `api-key`) et fournie au pod sous forme de
**Secret Kubernetes natif** (via `explicit_secret_values`, et non par le chemin
habituel Secret Manager → SecretSync), injecté comme variable d'environnement
`ADMIN_PASSWORD` — le backend de Chibisafe initialise son compte administrateur
de premier démarrage avec cette valeur au lieu de la valeur par défaut amont bien
connue.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~chibisafe"
  gcloud secrets versions access latest --secret=<api-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le modèle d'injection Secret Store CSI /
Secret natif et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

`enable_custom_domain = true` par défaut, ce qui expose Chibisafe via une
Kubernetes Gateway dotée d'un certificat géré par Google dès que
`application_domains` est renseigné. Le Service interne est de type `ClusterIP`
par défaut ; passez `service_type` à `LoadBalancer` pour obtenir une adresse IP
externe directe au lieu du chemin Gateway (ou en complément).

- **Console :** Network services → Gateways, ou Équilibrage de charge (si `service_type =
  LoadBalancer`) ; VPC network → IP addresses pour l'adresse IP statique réservée.
- **CLI :**
  ```bash
  kubectl get svc,gateway,httproute -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques
GKE sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles mais désactivés par défaut
(`uptime_check_config.enabled = false`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Consultez [App_GKE](App_GKE.md) pour les exigences d'accessibilité des tests de
disponibilité et le câblage des alertes.

---

## 3. Comportement de l'application Chibisafe {#3-chibisafe-application-behaviour}

- **Aucun job d'initialisation ni de migration.** Chibisafe gère son propre
  stockage SQLite ; `Chibisafe_Common` n'injecte par défaut aucune tâche
  `db-init` ni de migration. La variable `initialization_jobs` n'est disponible
  que pour des tâches de chargement de données personnalisées.
- **Relocalisation de l'état au premier démarrage.** L'image conserve son état
  modifiable dans trois répertoires frères de son WORKDIR — `/app/database`
  (SQLite), `/app/uploads` (fichiers et miniatures) et `/app/logs`. Le point
  d'entrée (`entrypoint.sh`) crée un lien symbolique de chacun d'eux vers un
  sous-répertoire de l'unique montage persistant (`/data` par défaut), en migrant
  au premier démarrage tout contenu fourni par l'image vers le volume vide.
  L'opération est idempotente d'un redémarrage à l'autre — les répertoires déjà
  liés sont laissés tels quels.
- **Compte administrateur.** Au premier démarrage, le backend crée le compte
  propriétaire `admin`. Si `enable_api_key = true`, une valeur aléatoire est
  générée et injectée comme `ADMIN_PASSWORD`, que le backend utilise comme mot de
  passe de ce compte au lieu de la valeur par défaut amont bien connue (`admin`) ;
  sinon, connectez-vous avec `admin`/`admin` et changez-le immédiatement.
  `ADMIN_PASSWORD` n'est transmis qu'au processus backend — le point d'entrée le
  retire de l'environnement du front-end et de Caddy.
- **Aucun alias de variables d'environnement de base de données.**
  `database_type = NONE` — il n'y a aucune injection ni aucun alias `DB_HOST`/
  `DB_USER` dont se soucier ; SQLite réside entièrement sur le volume
  `/data`.
- **Processus et ports.** `tini` est le PID 1 ; le point d'entrée (après la
  relocalisation de l'état décrite ci-dessus) démarre trois processus :

  | Processus | Écoute sur | Sert |
  |---|---|---|
  | Caddy | `0.0.0.0:8000` (`container_port`) | Le seul écouteur vers lequel le Service achemine le trafic |
  | Backend chibisafe-server | `127.0.0.1:18000` (boucle locale uniquement) | `/api/*`, `/docs*` |
  | Front-end Next.js | `127.0.0.1:18001` (boucle locale uniquement) | L'interface web |

  Ils sont supervisés en mode **fail-fast** : si l'un d'eux s'arrête, les autres
  sont arrêtés et le conteneur se termine avec le code 1, si bien que Kubernetes
  le redémarre (choix préféré à supervisord, qui laisserait un conteneur paraître
  sain avec un front-end mort).
- **Routage** (le Caddyfile amont de `v6.5.5`, dans le même ordre) : tout chemin
  désignant un fichier sous `/data/uploads` est servi directement par Caddy (le
  backend ne sert pas les fichiers téléversés en production) ; `/api/*` → backend
  (l'API REST — voir la sortie `api_url`) ; `/docs*` → backend (la référence
  OpenAPI Scalar) ; tout le reste → front-end (l'interface web à `/`, par exemple
  `/dashboard`, `/login`). Deux écarts par rapport à l'amont : l'en-tête `Host`
  est conservé, de sorte que les liens de fichiers construits par le backend sont
  corrects sans avoir à définir « Serve uploads from » ; et `X-Forwarded-For`/
  `X-Real-IP` sont fixés à l'adresse IP cliente que Caddy résout lui-même (plages
  de l'équilibreur de charge Google approuvées, sélection stricte la plus à
  droite), si bien qu'un client ne peut pas les usurper.
- **Front-end → backend.** Le rendu côté serveur du front-end appelle directement
  le backend à `BASE_API_URL=http://127.0.0.1:18000`, défini par le point
  d'entrée ; le navigateur appelle `/api` sur la même origine.
- **Environnement du conteneur.** `NODE_ENV=production` est la seule valeur par
  défaut à l'échelle du conteneur ; `HOST`/`HOSTNAME`/`PORT` des deux processus
  Node sont définis processus par processus par le point d'entrée (`HOSTNAME` doit
  être remplacé, car Kubernetes le définit avec le nom du pod). `PORT` est
  volontairement laissé non défini par `Chibisafe_Common` ; Caddy se rabat sur
  `8000`, ce qui correspond à `container_port`.
- **Téléversements.** Un Service LoadBalancer n'impose aucun plafond sur le corps
  des requêtes ; la taille de bloc de téléversement par défaut de Chibisafe
  (environ 81 MB) fonctionne donc telle quelle — contrairement à
  `Chibisafe_CloudRun`, où la limite de 32 MiB de Cloud Run impose de la réduire.
- **Mémoire.** La valeur par défaut `1Gi` héberge désormais deux processus Node
  plus Caddy ; cela n'a pas encore été mesuré en conditions réelles — augmentez
  `memory_limit` si le pod est arrêté pour dépassement de mémoire (OOM).
- **Mise à jour d'un déploiement existant.** Un UPDATE d'un déploiement réalisé
  avec la version antérieure limitée au backend reconstruit automatiquement
  l'image (le hachage du contenu du répertoire de scripts change), conserve le
  port `8000`, supprime la variable d'environnement `HOST=0.0.0.0` définie à
  l'échelle du conteneur (désormais définie par processus) et laisse intactes les
  données du PVC `/data`. `/` passe d'une réponse JSON 404 à l'interface web.
- **Chemin de santé.** Les sondes de démarrage et d'activité sont toutes deux des
  requêtes **HTTP** `GET /api/health` (`startup_probe`/`liveness_probe` ont par
  défaut `path = "/api/health"`, comme `Chibisafe_CloudRun`), envoyées via Caddy
  au backend, qui renvoie un `200 {"status":"yes"}` littéral dès qu'il répond,
  sans authentification requise — c'est aussi ce dont a besoin le contrôle de
  santé de la Gateway (qui reflète la sonde de vivacité) : exactement un 200.
  `/` est l'interface web, dont le code d'état relève du front-end plutôt que d'un
  signal de santé. Les variables alternatives `health_check_config`/`startup_probe_config`
  ont désormais aussi `path = "/api/health"` par défaut, mais sont supplantées —
  le socle prend les sondes dans `startup_probe`/`liveness_probe`.
- **Contrainte de mise à l'échelle à rédacteur unique.** `min_instance_count = max_instance_count =
  1` par défaut ; chaque pod du StatefulSet possède son propre PVC, si bien que
  dépasser 1 sans repenser le stockage expose à des rédacteurs SQLite divergents.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  kubectl get pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" <pod-name> -- ls -la /app/database /app/uploads /app/logs
  kubectl exec -n "$NAMESPACE" <pod-name> -- env | grep -E 'HOST|NODE_ENV|PORT'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Chibisafe ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `chibisafe` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Étiquette de l'image `chibisafe/chibisafe-server` ; `latest` est épinglé sur `v6.5.5` au moment du build via l'argument de build `CHIBISAFE_VERSION` propre à l'application. |
| `enable_api_key` | `false` | Génère une valeur aléatoire dans Secret Manager, injectée comme `ADMIN_PASSWORD` via un Secret Kubernetes natif, qui initialise l'identifiant administrateur de premier démarrage au lieu de la valeur par défaut amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | 1 GiB par défaut, partagé par deux processus Node et Caddy ; pas encore mesuré en conditions réelles. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Laissez à 1 — Chibisafe est une application SQLite à rédacteur unique. |
| `container_port` | `8000` | Le port du proxy Caddy. Fixé par `Chibisafe_Common` ; cette variable n'est pas transmise à App_GKE et la modifier n'a aucun effet. |
| `enable_cloudsql_volume` | `false` | Chibisafe n'a pas de base de données Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interne par défaut ; le chemin Gateway (groupe 19) est la route par défaut du trafic externe. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement, car `stateful_pvc_enabled = true` par défaut. |
| `session_affinity` | `None` | Aucune affinité client configurée par défaut. |

### Groupe 7 — StatefulSet / PVC {#group-7--statefulset--pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Obligatoire — SQLite ne tolère pas le verrouillage de fichiers POSIX de GCS FUSE. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Dimensionnez le PVC pour contenir la base SQLite ainsi que tous les fichiers téléversés. |
| `stateful_pvc_mount_path` | `/data` | Le point d'entrée crée des liens symboliques de `/app/database`, `/app/uploads` et `/app/logs` vers ce montage. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD sur SSD ; consomme le quota `SSD_TOTAL_GB` — remplacez-la par `standard` (HDD) sur les projets contraints par les quotas. |
| `stateful_fs_group` | `3000` | Correspond à la convention UID 1000 / GID 2000 du chart Helm de Chibisafe, afin que le PVC soit accessible en écriture au groupe. |

### Groupe 10 — Observabilité {#group-10--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | `path = "/api/health"` | Les sondes réellement en vigueur (transmises à `App_GKE` dans `main.tf`). Envoyées via le proxy Caddy au backend — un `200 {"status":"yes"}` littéral, sans authentification requise. |
| `health_check_config` / `startup_probe_config` | `path = "/api/health"` | Inertes — déclarées uniquement pour refléter les variables du socle, jamais transmises à `App_GKE`. Ne comptez pas sur elles pour modifier la sonde déployée. |
| `uptime_check_config` | `enabled = false`, `path = "/api/health"` | Activez-la pour ajouter un test de disponibilité public et une alerte une fois le point de terminaison accessible publiquement. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket `storage` toujours présent (suffixe `storage`). |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires. Le bucket de stockage de Chibisafe n'est monté automatiquement sur `/data` que lorsque `stateful_pvc_enabled = false` ; avec le StatefulSet par défaut, il est créé mais laissé non monté pour éviter un double montage sur `/data`. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (reprise, **inerte**) | Déclarée uniquement par souci de cohérence avec les conventions du socle — `Chibisafe_GKE/main.tf` transmet toujours `enable_redis = false` à App_GKE, quelle que soit cette valeur. Chibisafe ne dépend pas de Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (inhabituel parmi les modules) — Kubernetes Gateway + certificat géré. |
| `application_domains` | `[]` | Doit être renseigné pour que le certificat géré soit associé à un véritable nom d'hôte. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

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
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée). |
| `service_url` | URL de l'interface web de Chibisafe (servie à `/`). La même adresse sert l'API REST sous `/api`, la référence OpenAPI à `/docs` et les fichiers téléversés par leur nom. Externe avec une IP de LoadBalancer réservée, sinon l'URL interne au cluster. |
| `api_url` | URL de base de l'API REST (`<service_url>/api`), pour les clients de téléversement et les scripts ; `GET <api_url>/health` renvoie `200 {"status":"yes"}`. |
| `chibisafe_api_key_secret_id` | ID du secret Secret Manager du secret facultatif de mot de passe administrateur. Vide lorsque `enable_api_key = false`. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuelles jobs d'initialisation personnalisés. |
| `statefulset_name` | Nom du StatefulSet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — l'association de `workload_type = "Deployment"` avec `stateful_pvc_enabled = true`, des `quota_memory_*` exprimés en entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | Le désactiver revient à un montage GCS FUSE sur `/data`, dont le comportement de verrouillage de fichiers POSIX n'est pas sûr pour SQLite et expose à une corruption de la base de données. |
| `stateful_pvc_mount_path` | `/data` | Critical | Les liens symboliques de relocalisation du point d'entrée (`/app/database`, `/app/uploads`, `/app/logs`) sont codés en dur vers ce montage ; le modifier sans mettre aussi à jour l'image rompt la persistance de l'état. |
| `workload_type` | `null` (→ `StatefulSet`) | Critical | Forcer `Deployment` avec `stateful_pvc_enabled = true` échoue au moment du plan ; le forcer plutôt via `stateful_pvc_enabled = false` sacrifie l'intégrité de SQLite au profit du risque GCS FUSE (voir ci-dessus). |
| `max_instance_count` | `1` | High | Chibisafe est une application SQLite à rédacteur unique ; dépasser 1 pod expose à des rédacteurs divergents et à un état corrompu, même si chaque réplica du StatefulSet obtient son propre PVC. |
| `stateful_fs_group` | `3000` | High | Un `fsGroup` incohérent ou non défini laisse le montage du PVC sans accès en écriture de groupe pour l'UID du conteneur, ce qui provoque des échecs d'écriture pour la base SQLite et les fichiers téléversés. |
| `stateful_pvc_storage_class` | `standard-rwo` (remplacer par `standard` en cas de contrainte) | Medium | `standard-rwo`, sur SSD, consomme le quota serré `SSD_TOTAL_GB` ; une série d'applications avec état peut l'épuiser. La mise à l'échelle à zéro ne libère **pas** le PVC — seule la suppression le fait. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms (pertinent uniquement si `enable_resource_quota = true`). |
| `enable_custom_domain` | `true` avec `application_domains` défini | Medium | Laissé activé avec un `application_domains` vide, le chemin Gateway/certificat géré n'a aucun nom d'hôte auquel s'associer. |
| `enable_redis` | n'importe quelle valeur (inerte) | Low | `main.tf` transmet toujours `enable_redis = false` — modifier cette variable n'a aucun effet ; ne comptez pas sur elle pour ajouter une connectivité Redis. |
| `container_port` | `8000` (fixe) | Low | La variable est déclarée par souci de cohérence avec les conventions, mais n'est pas transmise à App_GKE ; la modifier ne change pas le port d'écoute réel du proxy Caddy. |
| Variables `database_type` / `db_*` | `NONE` / inertes | Low | Chibisafe n'a pas de base de données SQL ; ces variables n'existent que pour refléter celles du socle et sont ignorées sans avertissement. |
| `enable_api_key` | `true` si le service est accessible de l'extérieur ; sinon, changer le mot de passe par défaut à la première connexion | Medium | Lorsqu'elle est désactivée, le compte `admin` démarre avec le mot de passe amont bien connu `admin` — changez-le à la première connexion, surtout si le service est accessible de l'extérieur. Les clés d'API par requête sont générées au sein de l'application. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Chibisafe,
partagée avec la variante Cloud Run, est décrite dans le module Chibisafe_Common
(`modules/Chibisafe_Common/README.md`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Chibisafe sur GKE Autopilot](../labs/Chibisafe_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Chibisafe sur Google Cloud Run](Chibisafe_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Chibisafe Common — Configuration applicative partagée](Chibisafe_Common.md) — la configuration partagée par les deux cibles de déploiement.
