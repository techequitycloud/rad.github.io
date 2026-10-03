---
title: "Trilium sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Trilium sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Trilium_GKE.md @ 15fd4c7 sha256:5876ded22250 -->

# Trilium sur GKE Autopilot {#trilium-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_GKE.png" alt="Trilium sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (le fork **TriliumNext** activement maintenu — pas le
`zadam/trilium` archivé) est une application de prise de notes open source,
hiérarchique et auto-hébergée, avec une base de données SQLite intégrée. Ce
module déploie Trilium sur **GKE Autopilot** par-dessus la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Trilium et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Trilium s'exécute comme un seul pod Node.js/Express sur GKE Autopilot. Le
déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 GiB par défaut — mais voir les notes de scaling ci-dessous |
| Base de données | Aucune (SQLite intégré) | L'intégralité du magasin de documents de Trilium est un seul fichier SQLite, `document.db`, sur le volume persistant |
| Stockage persistant | PVC de bloc (par défaut) | PVC StatefulSet à `/home/node/trilium-data` ; définissez `stateful_pvc_enabled = false` pour revenir à un volume GCS FUSE |
| Secrets | Secret Manager | Aucun généré — Trilium n'a pas de credential piloté par des variables d'environnement |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut (Trilium est une interface web orientée navigateur) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun moteur de base de données à gérer.** `database_type = "NONE"` — il n'y a pas
  d'instance Cloud SQL, pas de chaîne de connexion, et rien à sauvegarder
  séparément du volume de données.
- **Réplica unique uniquement.** `min_instance_count = max_instance_count = 1`. La base de données SQLite
  intégrée de Trilium ne prend pas en charge l'écriture multi-utilisateurs —
  l'exécution de plusieurs pods risque de corrompre la base de données en
  raison d'écritures concurrentes.
- **`service_type = "LoadBalancer"` par défaut.** Trilium est une interface web orientée
  navigateur, elle est donc exposée en externe dès le départ (contrairement aux
  charges de travail de type base de données, qui sont par défaut
  `ClusterIP`).
- **Aucun credential pré-rempli.** Trilium n'a **pas** de démarrage
  d'authentification piloté par des variables d'environnement. Lors de la
  première visite, l'application elle-même présente un écran "Set Password" ;
  complétez-le avant de partager l'URL.
- **La sonde de santé est `/api/health-check`, pas `/`.** Le chemin racine
  (`/`) renvoie une redirection 302 vers l'écran de
  configuration/connexion. Seul `/api/health-check` renvoie un
  `200 {"status":"ok"}` non authentifié — confirmé en direct via des tests de
  conteneur locaux.
- **PVC de bloc par défaut.** `stateful_pvc_enabled = true` (par défaut) maintient le
  fichier SQLite intégré, qui s'exécute en mode WAL, hors de GCS FUSE — SQLite
  ne prend pas en charge WAL sur un système de fichiers réseau. La valeur par
  défaut `stateful_pvc_storage_class` est `"standard"` (HDD `pd-standard`) — Trilium n'a pas
  besoin d'IOPS SSD, et le HDD utilise le quota `DISKS_TOTAL_GB` beaucoup plus
  important au lieu du quota `SSD_TOTAL_GB` restreint.
- **`fsGroup`/`mount_options` défini à 1000.** Le conteneur de Trilium
  s'exécute en tant qu'utilisateur `node`, uid/gid 1000 (confirmé via
  `docker run ... id node`) ; sans correspondance de propriété, le volume est monté avec
  la propriété root et l'application ne démarre pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Trilium {#a-gke-autopilot--the-trilium-workload}

Trilium s'exécute comme un seul pod (un StatefulSet par défaut, car
`stateful_pvc_enabled = true` ; un déploiement si vous désactivez le PVC). Comme il doit
rester à un seul réplica, il n'y a pas d'autoscaling horizontal significatif à
observer.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Trilium pour les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour l'autoscaling Autopilot et le type de charge de
travail (Déploiement vs StatefulSet).

### B. Cloud Storage / PVC de bloc — le répertoire de données Trilium {#b-cloud-storage--block-pvc--the-trilium-data-directory}

L'état complet de l'application (SQLite `document.db`, pièces jointes,
historique des révisions, paramètres) se trouve sous `/home/node/trilium-data`, sur un
PVC de bloc StatefulSet par défaut (`stateful_pvc_enabled = true`), ou sur un volume GCS
FUSE si le PVC est désactivé.

- **Console :** Cloud Storage → Buckets (mode GCS FUSE) ; Kubernetes Engine →
  Stockage (mode PVC).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"          # GCS FUSE mode
  kubectl get pvc -n "$NAMESPACE"                             # PVC mode
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de
Cloud Load Balancing. Un domaine personnalisé avec un certificat géré par Google
peut être activé, et une adresse IP statique peut être réservée afin que
l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés et
les adresses IP statiques.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des tests de disponibilité
et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Trilium {#3-trilium-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.**
  Trilium crée et migre son propre schéma SQLite lors de la première visite web,
  via son propre assistant de configuration — il n'y a pas de job
  `db-init` géré par Terraform à inspecter.
- **Écran "Set Password" lors de la première exécution.** La navigation vers
  l'URL racine pour la première fois présente un formulaire de configuration de
  mot de passe (pas d'administrateur/nom d'utilisateur par défaut — Trilium est
  une application mono-utilisateur). Il n'y a pas de credential pré-rempli dans
  Secret Manager à consulter.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/health-check`, qui renvoie `200 {"status":"ok"}` une fois que le serveur HTTP
  écoute.
- **Contrainte d'écriture unique.** Ne jamais augmenter `max_instance_count` au-dessus
  de `1` — la base de données SQLite intégrée n'est pas sûre pour
  les écritures concurrentes de plusieurs pods.
- **Compromis PVC vs GCS FUSE.** Le PVC de bloc (par défaut) offre un
  verrouillage de fichier POSIX réel et le mappage de mémoire partagée dont le
  mode WAL de SQLite a besoin, au prix de la consommation de quota de disque
  régional (atténué ici en utilisant par défaut le HDD, pas le SSD). GCS FUSE
  n'a pas besoin de quota de disque mais n'est pas un système de fichiers
  supporté pour SQLite WAL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Trilium sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard et leurs valeurs par
défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `trilium` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image Docker ; mappé en interne à un ARG de build épinglé (`TRILIUM_VERSION`). |
| `enable_password` | `false` | Réservé pour la parité avec d'autres modules d'édition mono-utilisateur. **Sans effet** — Trilium n'a pas de démarrage de mot de passe piloté par des variables d'environnement. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod ; Trilium est léger, n'augmentez que pour de très grandes collections de notes. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Maintenez les deux à 1** — pas de support multi-écrivain sur la base de données SQLite intégrée. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Trilium dans Artifact Registry avant le déploiement. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Trilium est une interface web orientée navigateur, exposée en externe par défaut. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`, sinon `Deployment`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Gardez `true` — verrouillage de fichier POSIX réel et support WAL pour le document.db SQLite. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |
| `stateful_pvc_mount_path` | `/home/node/trilium-data` | Chemin de montage du conteneur. |
| `stateful_pvc_storage_class` | `standard` | HDD par défaut — pas besoin d'IOPS SSD ; maintient les déploiements hors du quota `SSD_TOTAL_GB` restreint. |
| `stateful_fs_group` | `1000` | Correspond à l'uid/gid de Trilium (l'utilisateur `node`). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non référencé — Trilium n'a pas de base de données SQL (uniquement SQLite intégré). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/health-check`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel sur `/api/health-check`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Trilium. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | L'augmenter risque de corrompre la base de données SQLite intégrée par des écritures concurrentes. |
| `stateful_fs_group` / GCS mount_options | `1000` | Critique | Un uid/gid incorrect monte le répertoire de données avec la propriété root ; le processus Trilium non-root ne démarre pas. |
| Étape "Set Password" à la première visite | Compléter immédiatement | Critique | Une instance Trilium sans mot de passe sur une IP de LoadBalancer publique est accessible par n'importe qui tant que le mot de passe n'est pas défini. |
| `startup_probe` / `liveness_probe` chemin | `/api/health-check` | Élevé | Pointer les sondes vers `/` entraîne une redirection 302, que la plupart des vérifications de santé HTTP traitent comme un échec, empêchant le pod de devenir Prêt. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Moyen | `standard-rwo` (SSD) utilise inutilement le quota `SSD_TOTAL_GB` restreint pour une charge de travail sans besoin d'IOPS. |
| `service_type` | `LoadBalancer` pour une utilisation normale | Moyen | Définir `ClusterIP` rend l'interface utilisateur de prise de notes inaccessible depuis un navigateur sans un port-forward. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Trilium
partagée avec la variante Cloud Run est décrite dans
**[Trilium_Common](Trilium_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Trilium sur GKE Autopilot](../labs/Trilium_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Trilium sur Google Cloud Run](Trilium_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Trilium Common — Configuration d'application partagée](Trilium_Common.md) — la configuration partagée par les deux cibles de déploiement.
