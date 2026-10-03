---
title: "Radicale sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Radicale sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Radicale_GKE.md @ 15fd4c7 sha256:e08ecfb6f1bd -->

# Radicale sur GKE Autopilot {#radicale-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Radicale_GKE.png" alt="Radicale sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Radicale est un **serveur CalDAV/CardDAV** auto-hébergé et open source pour la
synchronisation des calendriers et des contacts — une application WSGI
légère, purement Python, sans framework ni base de données. Il stocke chaque
calendrier et carnet d'adresses sous forme de fichiers iCalendar/vCard
ordinaires sur disque. Ce module déploie Radicale sur **GKE Autopilot**
au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud que Radicale utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Radicale s'exécute comme un seul pod Python WSGI. Le déploiement connecte un
ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod de processus Python unique, 1 vCPU / 1 GiB par défaut |
| Base de données | aucune | Radicale stocke chaque collection sous forme de fichiers simples — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage, ou un PVC de bloc | PVC de bloc par défaut (`stateful_pvc_enabled = true`) ; un bucket GCS `storage` est également provisionné et n'est monté que si le PVC est désactivé |
| Cache et file d'attente | aucun | Radicale n'a aucune dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Un vrai `ADMIN_PASSWORD` généré — Radicale n'est livré avec aucun compte administrateur par défaut |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données d'aucune sorte.** `Radicale_Common` corrige `database_type =
  "NONE"` — Radicale est un pur stockage de système de fichiers.
- **Build personnalisé, avec un wrapper léger.** `Radicale_Common` ajoute un point d'entrée cloud à l'image officielle `ghcr.io/kozea/radicale` via Cloud Build, puis met en miroir le résultat dans Artifact Registry.
- **PVC de stockage de bloc par défaut, et requis.** `stateful_pvc_enabled = true` (résout automatiquement `workload_type` en `StatefulSet`) donne aux collections de Radicale un verrouillage de fichier POSIX réel et des renommages de répertoire. Sur GCS FUSE, la création d'un calendrier ou d'un carnet d'adresses échoue, car gcsfuse ne peut pas renommer le répertoire temporaire dans lequel Radicale construit chaque collection. `stateful_pvc_storage_class` est par défaut `standard` (HDD) plutôt que SSD — les collections sont de petits fichiers texte sans besoin d'IOPS élevées.
- **Pas de compte administrateur par défaut — un vrai secret généré.** `Radicale_Common` génère et injecte un vrai `ADMIN_PASSWORD` à chaque déploiement (voir le [guide commun](Radicale_Common.md)).
- **`max_instance_count` épinglé à `1`, `min_instance_count` par défaut à `0`.** Le backend de stockage de Radicale n'est pas conçu pour un accès multi-instance concurrent, mais n'a pas de base de données/index à réchauffer au démarrage, donc la mise à l'échelle à zéro est sûre et rapide.
- **MKCOL fonctionne nativement ici — mais le job d'amorçage peut ne pas atteindre un PVC.** Le service LoadBalancer L4 simple de GKE n'a pas de restriction MKCOL (contrairement à Cloud Run), mais avec `stateful_pvc_enabled = true` (par défaut), les collections pré-créées du job d'amorçage peuvent ne pas apparaître — voir §3.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Radicale {#a-gke-autopilot--the-radicale-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100    # Deployment mode
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100  # StatefulSet mode
  ```

### B. Stockage — Cloud Storage ou un PVC de bloc {#b-storage--cloud-storage-or-a-block-pvc}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
  kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
  ```

### C. Secret Manager {#c-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~radicale"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Radicale {#3-radicale-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a pas de job `db-init` — Radicale n'a pas de base de données à amorcer.
- **`seed-default-collections` s'exécute au moment du déploiement.** Un job d'initialisation ponctuel (`execute_on_apply = true`) écrit un "Calendrier par défaut" et un "Carnet d'adresses par défaut" directement sur le volume de stockage pour l'utilisateur administrateur.
- **Pas de compte administrateur par défaut.** L'authentification de Radicale est par défaut `denyall` jusqu'à ce qu'un fichier htpasswd existe. `Radicale_Common` génère un vrai `ADMIN_PASSWORD` et le point d'entrée cloud écrit à la fois la configuration INI et une entrée htpasswd bcrypt **à chaque démarrage de pod**.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ MKCOL fonctionne sur GKE — mais vérifiez où atterrissent les écritures de votre job d'amorçage {#-mkcol-works-on-gke--but-check-where-your-seed-jobs-writes-land}

Contrairement à Cloud Run, le service LoadBalancer L4 simple de GKE **ne restreint pas** la méthode WebDAV `MKCOL` — confirmé en direct (`201 Created`). Un vrai client CalDAV/CardDAV peut créer de nouvelles collections directement sans avoir besoin de contournement, ce qui est l'une des raisons pour lesquelles `Radicale_GKE` est mieux adapté à une utilisation plus intensive ou en production.

Cependant, le job d'initialisation `seed-default-collections` par défaut est un job de module commun Cloud-Run/GKE partagé et ne monte que le bucket GCS `storage` partagé — il **ne peut pas** s'attacher au PVC de bloc d'un StatefulSet (un job Kubernetes ne peut pas monter un PVC `ReadWriteOnce` déjà détenu par un pod en cours d'exécution). Donc :

- **Avec `stateful_pvc_enabled = true`** (par défaut) : les écritures du job d'amorçage atterrissent dans le bucket GCS autrement inutilisé, et le "Calendrier par défaut"/"Carnet d'adresses par défaut" **n'apparaîtra pas** sur le système de fichiers du pod en cours d'exécution, soutenu par PVC. Ceci est inoffensif — créez votre premier calendrier via un vrai client CalDAV, ou `curl -X MKCOL` (confirmé comme fonctionnel), au lieu de vous attendre aux valeurs par défaut pré-amorçées.
- **Sans PVC** (mode de déploiement soutenu par GCS) : les écritures du job d'amorçage atterrissent dans le même bucket que le pod en cours d'exécution, de sorte que les valeurs par défaut apparaissent — mais la création de toute autre collection échoue sur GCS FUSE.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Radicale sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `radicale` | Nom de base des ressources. |
| `application_display_name` | `Radicale` | Nom lisible par l'homme affiché dans l'interface utilisateur de la plateforme. |
| `application_version` | `latest` | Résout vers le build épinglé `RADICALE_VERSION=3.7.7` — les tags GHCR n'ont pas de préfixe `v`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5232` | Fixé via `Radicale_Common` ; cette variable n'est pas transmise à `App_GKE`. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Limites de mise à l'échelle HPA ; `max` est épinglé à `1` de manière non négociable. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Gardez `true`** — donne aux collections de Radicale un verrouillage de fichier POSIX réel et des renommages de répertoire ; sur GCS FUSE, la création d'une collection échoue. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_mount_path` | `/var/lib/radicale` | Doit correspondre à la déclaration `VOLUME` de l'image de base. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, pas SSD — les collections sont de petits fichiers texte sans besoin d'IOPS élevées ; évite le quota `SSD_TOTAL_GB` serré. |
| `stateful_fs_group` | `3000` | Rend le PVC inscriptible par le groupe ; Radicale s'exécute en tant que UID 1000 / GID 2000. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Monté à `/var/lib/radicale` via GCS FUSE **sauf si** `stateful_pvc_enabled = true`, auquel cas le PVC prend le même chemin de montage. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Radicale_Common` — Radicale n'a aucune base de données d'aucune sorte. |

### Groupe 11 — Automatisation de la charge de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injecté par `Radicale_Common`) | Voir §3 pour la mise en garde GKE+PVC. Fournir une liste personnalisée remplace entièrement cette valeur par défaut. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Redirection 302 non authentifiée de Radicale vers son interface web ; les deux types de sondes considèrent les codes 2xx–3xx comme sains. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `storage_buckets` | Le bucket `storage` (inutilisé comme montage lorsque `stateful_pvc_enabled = true`). |
| `statefulset_name` | Nom du StatefulSet, lorsque `workload_type = "StatefulSet"`. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` (par défaut) | Élevé | Sans cela, `/var/lib/radicale` est basé sur GCS FUSE, et la création d'un calendrier ou d'un carnet d'adresses échoue (gcsfuse ne peut pas renommer les répertoires). |
| Attendre des collections par défaut sur un déploiement basé sur PVC | Créer le premier calendrier via un vrai client CalDAV ou `curl -X MKCOL` | Moyen | Le job `seed-default-collections` ne peut pas monter le PVC `ReadWriteOnce` d'un StatefulSet, donc ses écritures atterrissent dans le bucket GCS inutilisé à la place — les valeurs par défaut pré-amorçées n'apparaissent pas silencieusement sur le système de fichiers du pod en cours d'exécution. |
| `max_instance_count` | Laisser à `1` | **Critique** | Le backend de stockage de Radicale n'est pas conçu pour un accès multi-instance concurrent ; augmenter cela risque une corruption des données. |
| `stateful_pvc_storage_class` | Laisser à `standard` (HDD) | Faible–Moyen | Passer à `standard-rwo`/`premium-rwo` (SSD) puise dans le quota `SSD_TOTAL_GB` beaucoup plus serré sans réel avantage — le modèle d'E/S de Radicale n'a pas besoin des IOPS du SSD. |
| Identifiant administrateur | Récupérer depuis Secret Manager après le premier déploiement | **Critique** | Contrairement aux applications avec un identifiant par défaut bien connu, Radicale génère un vrai secret — il n'y a aucun moyen de se connecter tant que vous n'avez pas récupéré `ADMIN_PASSWORD`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Radicale partagée avec la variante
Cloud Run est décrite dans **[Radicale_Common](Radicale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Radicale sur GKE Autopilot](../labs/Radicale_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Radicale sur Google Cloud Run](Radicale_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Radicale Common — Configuration d'application partagée](Radicale_Common.md) — la configuration partagée par les deux cibles de déploiement.
