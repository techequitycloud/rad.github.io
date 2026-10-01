---
title: "Trilium sur GKE Autopilot"
description: "Référence de configuration pour déployer Trilium sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Trilium_GKE.md @ 3055034 sha256:feae49268b2b -->

# Trilium sur GKE Autopilot {#trilium-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_GKE.png" alt="Trilium sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (le fork **TriliumNext**, activement maintenu — et non le dépôt archivé
`zadam/trilium`) est une application open source de prise de notes hiérarchique,
auto-hébergée, dotée d'une base de données SQLite intégrée. Ce module déploie Trilium
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Trilium et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Trilium s'exécute sous forme d'un unique pod Node.js/Express sur GKE Autopilot. Le
déploiement assemble un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 GiB par défaut — mais voir les remarques sur la mise à l'échelle ci-dessous |
| Base de données | Aucune (SQLite intégré) | L'intégralité du magasin de documents de Trilium est un unique fichier SQLite, `document.db`, sur le volume persistant |
| Stockage d'objets | Cloud Storage (par défaut) ou PVC bloc | Volume GCS FUSE, ou PVC de StatefulSet pour les grandes collections de notes |
| Secrets | Secret Manager | Aucun secret généré — Trilium n'a aucun identifiant défini par variable d'environnement |
| Entrée | Cloud Load Balancing | LoadBalancer externe par défaut (Trilium est une interface web destinée au navigateur) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun moteur de base de données à gérer.** `database_type = "NONE"` — il n'y a
  ni instance Cloud SQL, ni chaîne de connexion, ni rien à sauvegarder séparément du
  volume de données.
- **Un seul réplica.** `min_instance_count = max_instance_count = 1`. La base de
  données SQLite intégrée de Trilium ne prend pas en charge plusieurs rédacteurs —
  exécuter plus d'un pod expose à une corruption de la base de données par des
  écritures concurrentes.
- **`service_type = "LoadBalancer"` par défaut.** Trilium est une interface web
  destinée au navigateur ; elle est donc exposée en externe d'office (contrairement
  aux charges de travail de type base de données, qui utilisent `ClusterIP` par
  défaut).
- **Aucun identifiant pré-créé.** Trilium n'a **aucun** amorçage d'authentification
  piloté par variable d'environnement. À la première visite, l'application affiche
  elle-même un écran « Set Password » ; terminez-le avant de partager l'URL.
- **La sonde de santé est `/api/health-check`, et non `/`.** Le chemin racine (`/`)
  renvoie une redirection 302 vers l'écran de configuration/connexion. Seul
  `/api/health-check` renvoie un `200 {"status":"ok"}` non authentifié — confirmé en
  conditions réelles par des tests de conteneur en local.
- **PVC bloc recommandé pour les grandes collections de notes.** Définissez
  `stateful_pvc_enabled = true` pour éviter le surcoût d'E/S et les particularités de
  verrouillage de GCS FUSE sur le fichier SQLite intégré. La valeur par défaut de
  `stateful_pvc_storage_class` est `"standard"` (HDD `pd-standard`) — Trilium n'a pas
  besoin des IOPS d'un SSD, et le HDD puise dans le quota `DISKS_TOTAL_GB`, bien plus
  large, plutôt que dans le quota serré `SSD_TOTAL_GB`.
- **`fsGroup`/`mount_options` définis à 1000.** Le conteneur de Trilium s'exécute en
  tant qu'utilisateur `node`, uid/gid 1000 (confirmé via `docker run ... id node`) ;
  sans propriété correspondante, le volume est monté avec root comme propriétaire et
  l'application ne parvient pas à démarrer.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Trilium {#a-gke-autopilot--the-trilium-workload}

Trilium s'exécute sous forme d'un pod unique (Deployment par défaut, ou StatefulSet
lorsque `stateful_pvc_enabled = true`). Comme il doit rester à exactement un réplica,
il n'y a pas de mise à l'échelle automatique horizontale significative à observer.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Trilium pour les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la mise à l'échelle d'Autopilot et le type de
charge de travail (Deployment ou StatefulSet).

### B. Cloud Storage / PVC bloc — le répertoire de données de Trilium {#b-cloud-storage--block-pvc--the-trilium-data-directory}

L'intégralité de l'état de l'application (le fichier SQLite `document.db`, les pièces
jointes, l'historique des révisions, les paramètres) réside sous
`/home/node/trilium-data`, monté soit via GCS FUSE (par défaut), soit via un PVC bloc
de StatefulSet (`stateful_pvc_enabled = true`, recommandé pour les grandes
collections de notes).

- **Console :** Cloud Storage → Buckets (mode GCS FUSE) ; Kubernetes Engine →
  Storage (mode PVC).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"          # GCS FUSE mode
  kubectl get pvc -n "$NAMESPACE"                             # PVC mode
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### C. Réseau et entrée {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés et
l'IP statique.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
de GKE sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Trilium {#3-trilium-application-behaviour}

- **Aucune tâche de configuration de base de données au premier déploiement.**
  Trilium crée et migre son propre schéma SQLite lors de la première visite web, via
  son propre assistant de configuration — il n'existe aucune tâche `db-init` gérée
  par Terraform à inspecter.
- **Écran « Set Password » au premier lancement.** La première visite de l'URL racine
  affiche un formulaire de définition du mot de passe (aucun administrateur ni nom
  d'utilisateur par défaut — Trilium est une application mono-utilisateur). Aucun
  identifiant pré-créé n'est à rechercher dans Secret Manager.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent
  `/api/health-check`, qui renvoie `200 {"status":"ok"}` dès que le serveur HTTP est
  à l'écoute.
- **Contrainte d'un rédacteur unique.** N'augmentez jamais `max_instance_count`
  au-delà de `1` — la base de données SQLite intégrée ne supporte pas sans risque des
  rédacteurs concurrents provenant de plusieurs pods.
- **Compromis PVC ou GCS FUSE.** GCS FUSE (par défaut) est la solution la plus simple
  et ne nécessite aucune planification de quota supplémentaire ; un PVC bloc de
  StatefulSet offre un véritable verrouillage de fichiers POSIX et un surcoût d'E/S
  plus faible pour les grandes collections, au prix d'une consommation du quota de
  disque régional (atténuée ici par l'utilisation par défaut d'un HDD plutôt que d'un
  SSD).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Trilium ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `trilium` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Docker ; associé en interne à un ARG de build épinglé (`TRILIUM_VERSION`). |
| `enable_password` | `false` | Réservé par souci de cohérence avec les autres modules d'éditeurs mono-utilisateur. **Sans effet** — Trilium n'a aucun amorçage de mot de passe piloté par variable d'environnement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; Trilium est léger, n'augmentez cette valeur que pour de très grandes collections de notes. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Gardez les deux à 1** — la base de données SQLite intégrée ne prend pas en charge plusieurs rédacteurs. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Trilium dans Artifact Registry avant le déploiement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Trilium est une interface web destinée au navigateur, exposée en externe par défaut. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`, sinon en `Deployment`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | `true` recommandé pour les grandes collections de notes — véritable verrouillage de fichiers POSIX sur le fichier SQLite document.db. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/home/node/trilium-data` | Chemin de montage dans le conteneur. |
| `stateful_pvc_storage_class` | `standard` | HDD par défaut — aucun besoin d'IOPS SSD ; évite aux déploiements de consommer le quota serré `SSD_TOTAL_GB`. |
| `stateful_fs_group` | `1000` | Correspond à l'uid/gid de Trilium (l'utilisateur `node`). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non utilisé — Trilium n'a pas de base de données SQL (SQLite intégré uniquement). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/health-check`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/api/health-check`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Trilium. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | L'augmenter expose à une corruption de la base de données SQLite intégrée par des rédacteurs concurrents. |
| `stateful_fs_group` / mount_options GCS | `1000` | Critical | Un uid/gid incorrect monte le répertoire de données avec root comme propriétaire ; le processus Trilium non root ne parvient pas à démarrer. |
| Étape « Set Password » de la première visite | À terminer immédiatement | Critical | Une instance Trilium sans mot de passe défini, exposée sur une IP LoadBalancer publique, est accessible à tous jusqu'à ce que le mot de passe soit défini. |
| Chemin de `startup_probe` / `liveness_probe` | `/api/health-check` | High | Faire pointer les sondes sur `/` renvoie une redirection 302, que la plupart des contrôles de santé HTTP considèrent comme un échec, ce qui empêche le pod de devenir Ready. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Medium | `standard-rwo` (SSD) puise inutilement dans le quota serré `SSD_TOTAL_GB` pour une charge de travail sans besoin d'IOPS. |
| `service_type` | `LoadBalancer` pour un usage normal | Medium | La valeur `ClusterIP` rend l'interface de prise de notes inaccessible depuis un navigateur sans redirection de port (port-forward). |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Trilium partagée
avec la variante Cloud Run est décrite dans **[Trilium_Common](Trilium_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Trilium sur GKE Autopilot](../labs/Trilium_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Trilium sur Google Cloud Run](Trilium_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Trilium Common — Configuration applicative partagée](Trilium_Common.md) — la configuration partagée par les deux cibles de déploiement.
