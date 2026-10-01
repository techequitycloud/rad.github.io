---
title: "Radicale sur GKE Autopilot"
description: "Référence de configuration pour déployer Radicale sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Radicale_GKE.md @ 3055034 sha256:1a743989c33a -->

# Radicale sur GKE Autopilot {#radicale-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Radicale_GKE.png" alt="Radicale sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Radicale est un **serveur CalDAV/CardDAV** open source et auto-hébergé pour la
synchronisation des agendas et des contacts — une application WSGI légère, en
pur Python, sans framework ni base de données. Il stocke chaque agenda et
chaque carnet d'adresses sous forme de simples fichiers iCalendar/vCard sur
disque. Ce module déploie Radicale sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Radicale et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
GKE — Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Radicale s'exécute comme un pod WSGI Python unique. Le déploiement assemble un
ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod à processus Python unique, 1 vCPU / 1 GiB par défaut |
| Base de données | aucune | Radicale stocke chaque collection sous forme de simples fichiers — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage, ou un PVC bloc | Bucket GCS `storage` par défaut ; `stateful_pvc_enabled = true` le remplace par un véritable PVC bloc (recommandé en production) |
| Cache et file d'attente | aucun | Radicale ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Un véritable `ADMIN_PASSWORD` généré — Radicale n'est livré avec aucun compte administrateur par défaut |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données, quelle qu'elle soit.** `Radicale_Common` impose
  `database_type =
  "NONE"` — Radicale est un pur stockage sur système de fichiers.
- **Build personnalisé à enveloppe fine.** `Radicale_Common` ajoute un point
  d'entrée cloud à l'image officielle `ghcr.io/kozea/radicale` via Cloud Build,
  puis met en miroir le résultat dans Artifact Registry.
- **PVC de stockage bloc recommandé.** Définissez `stateful_pvc_enabled = true`
  (ce qui résout automatiquement `workload_type` en `StatefulSet`) afin que le
  système de fichiers des collections de Radicale bénéficie d'un véritable
  verrouillage de fichiers POSIX, que GCS FUSE ne prend pas en charge de manière
  fiable. `stateful_pvc_storage_class` vaut `standard` (HDD) par défaut plutôt
  que SSD — les collections sont de petits fichiers texte sans besoin d'IOPS
  élevées.
- **Aucun compte administrateur par défaut — un véritable secret généré.**
  `Radicale_Common` génère et injecte un véritable `ADMIN_PASSWORD` à chaque
  déploiement (consultez le [guide Common](Radicale_Common.md)).
- **`max_instance_count` fixé à `1`, `min_instance_count` vaut `0` par
  défaut.** Le backend de stockage de Radicale n'est pas conçu pour un accès
  concurrent par plusieurs instances, mais il n'a ni base de données ni index à
  préchauffer au démarrage, si bien que la mise à l'échelle à zéro est sûre et
  rapide.
- **MKCOL fonctionne nativement ici — mais la tâche d'amorçage peut ne pas
  atteindre un PVC.** Le simple Service LoadBalancer L4 de GKE ne présente
  aucune restriction sur MKCOL (contrairement à Cloud Run), mais avec
  `stateful_pvc_enabled = true`, les collections pré-créées par la tâche
  d'amorçage par défaut peuvent ne pas apparaître — voir le §3.

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

### B. Stockage — Cloud Storage ou un PVC bloc {#b-storage--cloud-storage-or-a-block-pvc}

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

### D. Réseau et entrée {#d-networking--ingress}

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

- **Aucune configuration de base de données au premier déploiement.** Il n'y a
  pas de tâche `db-init` — Radicale n'a aucune base de données à initialiser.
- **`seed-default-collections` s'exécute au moment du déploiement.** Un Job
  d'initialisation ponctuel (`execute_on_apply = true`) écrit un « Default
  Calendar » et un « Default Address Book » directement sur le volume de
  stockage pour l'utilisateur administrateur.
- **Aucun compte administrateur par défaut.** L'authentification de Radicale
  vaut `denyall` par défaut tant qu'aucun fichier htpasswd n'existe.
  `Radicale_Common` génère un véritable `ADMIN_PASSWORD` et le point d'entrée
  cloud écrit à la fois la configuration INI et une entrée htpasswd bcrypt **à
  chaque démarrage du pod**.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`.
- **Inspecter l'exécution des tâches :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

### ⚠ MKCOL fonctionne sur GKE — mais vérifiez où aboutissent les écritures de votre tâche d'amorçage {#-mkcol-works-on-gke--but-check-where-your-seed-jobs-writes-land}

Contrairement à Cloud Run, le simple Service LoadBalancer L4 de GKE ne
restreint **pas** la méthode WebDAV `MKCOL` — confirmé en conditions réelles
(`201 Created`). Un véritable client CalDAV/CardDAV peut créer directement de
nouvelles collections sans aucun contournement, ce qui est l'une des raisons
pour lesquelles `Radicale_GKE` convient mieux à un usage plus intensif ou de
production.

Cependant, le job d'initialisation par défaut `seed-default-collections` est
une tâche du module Common partagée entre Cloud Run et GKE et ne monte que le
bucket GCS partagé `storage` — elle **ne peut pas** s'attacher au PVC bloc d'un
StatefulSet (un Job Kubernetes ne peut pas monter un PVC `ReadWriteOnce` déjà
détenu par un Pod en cours d'exécution). Ainsi :

- **Avec `stateful_pvc_enabled = true`** (le paramètre recommandé en
  production) : les écritures de la tâche d'amorçage aboutissent dans le bucket
  GCS par ailleurs inutilisé, et le « Default Calendar » / « Default Address
  Book » n'apparaîtront **pas** sur le système de fichiers adossé au PVC du pod
  en cours d'exécution. C'est sans conséquence — créez votre premier agenda via
  un véritable client CalDAV, ou avec `curl -X MKCOL` (dont le fonctionnement
  est confirmé), au lieu de compter sur les collections pré-amorcées.
- **Sans PVC** (mode Deployment adossé à GCS — qui n'est pas la configuration
  de production recommandée) : les écritures de la tâche d'amorçage aboutissent
  dans le même bucket que celui monté par le pod en cours d'exécution, si bien
  que les collections par défaut apparaissent.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de
déploiement. Seuls les paramètres propres à Radicale ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `radicale` | Nom de base des ressources. |
| `application_display_name` | `Radicale` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Se résout vers le build épinglé `RADICALE_VERSION=3.7.7` — les tags GHCR n'ont pas de préfixe `v`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5232` | Imposé via `Radicale_Common` ; cette variable n'est pas transmise à `App_GKE`. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Bornes de mise à l'échelle du HPA ; `max` est fixé à `1`, sans dérogation possible. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | **`true` recommandé** en production — offre au système de fichiers des collections de Radicale un véritable verrouillage de fichiers POSIX. Résout automatiquement `workload_type` en `StatefulSet`. |
| `stateful_pvc_mount_path` | `/var/lib/radicale` | Doit correspondre à la déclaration `VOLUME` de l'image de base. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard`, pas SSD — les collections sont de petits fichiers texte sans besoin d'IOPS élevées ; évite le quota `SSD_TOTAL_GB`, très restreint. |
| `stateful_fs_group` | `3000` | Rend le PVC accessible en écriture au groupe ; Radicale s'exécute avec l'UID 1000 / GID 2000. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Monté sur `/var/lib/radicale` via GCS FUSE **sauf si** `stateful_pvc_enabled = true`, auquel cas le PVC prend le relais sur le même chemin de montage. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Imposé par `Radicale_Common` — Radicale n'a aucune base de données, quelle qu'elle soit. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injectée par `Radicale_Common`) | Voir le §3 pour la réserve GKE+PVC. Fournir une liste personnalisée remplace entièrement cette valeur par défaut. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Redirection 302 non authentifiée de Radicale vers son interface web ; les deux types de sondes considèrent les codes 2xx–3xx comme sains. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du Service Kubernetes. |
| `storage_buckets` | Le bucket `storage` (inutilisé comme montage lorsque `stateful_pvc_enabled = true`). |
| `statefulset_name` | Nom du StatefulSet, lorsque `workload_type = "StatefulSet"`. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` en production | Medium | Sans cela, `/var/lib/radicale` est adossé à GCS FUSE — acceptable compte tenu du plafond d'une seule instance, mais ce n'est pas un véritable système de fichiers avec verrouillage POSIX. |
| S'attendre à des collections par défaut sur un déploiement adossé à un PVC | Créer le premier agenda via un véritable client CalDAV ou `curl -X MKCOL` | Medium | La tâche `seed-default-collections` ne peut pas monter le PVC `ReadWriteOnce` d'un StatefulSet, si bien que ses écritures aboutissent dans le bucket GCS inutilisé — les collections pré-amorcées n'apparaissent silencieusement pas sur le système de fichiers du pod en cours d'exécution. |
| `max_instance_count` | Laisser à `1` | **Critical** | Le backend de stockage de Radicale n'est pas conçu pour un accès concurrent par plusieurs instances ; augmenter cette valeur expose à une corruption des données. |
| `stateful_pvc_storage_class` | Laisser à `standard` (HDD) | Low–Medium | Passer à `standard-rwo`/`premium-rwo` (SSD) consomme le quota `SSD_TOTAL_GB`, bien plus restreint, sans réel bénéfice — le profil d'E/S de Radicale ne nécessite pas les IOPS d'un SSD. |
| Identifiant administrateur | À récupérer dans Secret Manager après le premier déploiement | **Critical** | Contrairement aux applications dotées d'un identifiant par défaut bien connu, Radicale génère un véritable secret — impossible de se connecter tant que vous n'avez pas récupéré `ADMIN_PASSWORD`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Radicale
partagée avec la variante Cloud Run est décrite dans
**[Radicale_Common](Radicale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Radicale sur GKE Autopilot](../labs/Radicale_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Radicale sur Google Cloud Run](Radicale_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Radicale Common — Configuration applicative partagée](Radicale_Common.md) — la configuration partagée par les deux cibles de déploiement.
