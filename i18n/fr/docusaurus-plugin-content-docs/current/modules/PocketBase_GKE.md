---
title: "PocketBase sur GKE Autopilot"
description: "Référence de configuration pour déployer PocketBase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PocketBase_GKE.md @ 3055034 sha256:b1fd706e1144 -->

# PocketBase sur GKE Autopilot {#pocketbase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PocketBase_GKE.png" alt="PocketBase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PocketBase est un backend open source tenant en un seul fichier — une base de données
SQLite intégrée avec une API REST en temps réel, une authentification intégrée, du stockage
de fichiers et un tableau de bord d'administration. Ce module déploie PocketBase sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par PocketBase et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise
à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

PocketBase s'exécute comme un unique binaire Go autonome. Sur GKE, il est planifié comme un
**StatefulSet** avec un Persistent Volume en mode bloc, afin que sa base de données SQLite
intégrée bénéficie d'un verrouillage de fichiers POSIX fiable. Le déploiement assemble un
ensemble de services volontairement minimal :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique dans un pod **StatefulSet**, 1 vCPU / 1 GiB par défaut, port **8090** |
| Base de données | **SQLite intégré** | Pas de Cloud SQL — la base de données réside sur un PVC en mode bloc à `/pb_data` |
| Stockage persistant | Persistent Disk (PVC en mode bloc) | Un PVC ReadWriteOnce par pod (20 GiB par défaut) monté à `/pb_data` |
| Cache et file d'attente | **Aucun** | PocketBase n'utilise pas Redis ; `enable_redis = false` |
| Secrets | Secret Manager | Aucun généré automatiquement — l'authentification réside dans SQLite ; secrets facultatifs pour votre propre usage |
| Entrée | Cloud Load Balancing | `LoadBalancer` par défaut (externe) ; PocketBase est un backend-as-a-service exposé publiquement, pas une charge de travail purement interne |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **La base de données est un SQLite intégré — il n'y a pas de Cloud SQL.** PocketBase
  stocke chaque enregistrement, jeton d'authentification et fichier téléversé sous
  `/pb_data`, qui est un **PVC en mode bloc** sur GKE.
- **StatefulSet + PVC en mode bloc par défaut.** `stateful_pvc_enabled = true` — sans
  `workload_type` explicite, la valeur se résout automatiquement en `StatefulSet`. Le
  stockage en mode bloc offre à SQLite le verrouillage de fichiers fiable dont il a besoin
  (SQLite sur GCS FUSE n'est pas fiable pour le verrouillage, ce qui explique pourquoi GKE
  utilise un PVC alors que Cloud Run utilise FUSE).
- **Le PVC est monté à `/pb_data`** (20 GiB par défaut). La couche Common définit
  `enable_gcs_storage_volume = false` lorsque le PVC est activé, il n'y a donc pas de double
  montage sur le même chemin.
- **Un seul réplica.** SQLite n'accepte qu'un seul rédacteur et le PVC est ReadWriteOnce ;
  `min_instance_count` et `max_instance_count` valent donc tous deux `1` par défaut.
  N'augmentez pas `max_instance_count`.
- **`service_type = LoadBalancer` par défaut** (accès externe). PocketBase est un
  backend-as-a-service exposé publiquement, doté d'un tableau de bord d'administration et
  d'une API REST ; il est donc accessible depuis l'extérieur du cluster dès l'installation.
  Définissez `service_type = "ClusterIP"` si vous le souhaitez purement interne, ou ajoutez
  un domaine personnalisé + un certificat géré.
- **Le compte administrateur est créé de manière interactive au premier lancement, sur
  `/_/`.** Aucun mot de passe administrateur n'est injecté. Créez le superutilisateur dès
  que l'application est accessible.
- **Aucun secret n'est généré automatiquement.** PocketBase émet et stocke lui-même toute
  l'authentification ; Secret Manager n'est utilisé que si vous ajoutez vos propres secrets.
- **Ni Redis, ni NFS.** Tout l'état réside dans l'unique PVC `/pb_data`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail PocketBase {#a-gke-autopilot--the-pocketbase-workload}

PocketBase s'exécute comme un pod **StatefulSet** sur Autopilot, qui facture le CPU et la
mémoire demandés par le pod. Le StatefulSet donne au pod une identité stable et le lie à son
PVC `/pb_data` d'un redémarrage à l'autre.

- **Console :** Kubernetes Engine → Workloads → sélectionnez le StatefulSet PocketBase pour
  voir le pod, les révisions et les événements. Kubernetes Engine → Services & Ingress
  indique comment il est exposé.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Base de données — SQLite intégré (pas de Cloud SQL) {#b-database--embedded-sqlite-no-cloud-sql}

Il n'y a **aucune instance Cloud SQL**. La base de données de PocketBase est un ensemble de
fichiers SQLite sur le PVC en mode bloc à `/pb_data`. Pour inspecter ou sauvegarder la base
de données, vous travaillez avec le contenu du PVC, et non avec un point de terminaison SQL.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims → le PVC PocketBase.
- **CLI :**
  ```bash
  # List the PVC bound to the PocketBase pod:
  kubectl get pvc -n "$NAMESPACE"
  # Inspect / copy the SQLite database out of the running pod for backup:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /pb_data
  kubectl cp "$NAMESPACE"/<pod-name>:/pb_data/data.db ./pb_data-backup.db
  ```

### C. Cloud Storage / stockage persistant — le volume `/pb_data` {#c-cloud-storage--persistent-storage--the-pb_data-volume}

Sur GKE, le répertoire `/pb_data` — la base de données SQLite, les fichiers téléversés et
les paramètres — est un **PVC en mode bloc** (ReadWriteOnce, 20 GiB par défaut), et non un
bucket GCS. Un bucket de données Cloud Storage est tout de même déclaré par la couche
Common, mais sur GKE le PVC fait foi et le montage FUSE est désactivé pour éviter un double
montage.

- **Console :** Kubernetes Engine → Storage ; Compute Engine → Disks (le PD sous-jacent).
- **CLI :**
  ```bash
  kubectl get pvc,pv -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>          # size, StorageClass, bound PV
  ```

Consultez [App_GKE](App_GKE.md) pour les modèles de PVC des StatefulSet, les StorageClasses
et les options CMEK.

### D. Secret Manager {#d-secret-manager}

**Aucun secret n'est généré automatiquement** pour PocketBase — son authentification est
stockée dans SQLite. Secret Manager n'est utilisé que si vous injectez vos propres secrets
(par exemple des identifiants SMTP ou des clés de sauvegarde externes) via
`secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un Service `LoadBalancer` (externe), ce qui
reflète le rôle de PocketBase en tant que backend-as-a-service exposé publiquement. Pour la
rendre purement interne, définissez `service_type = ClusterIP` ; un domaine personnalisé
avec un certificat géré par Google est également disponible, et une IP statique peut être
réservée pour que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE sont
envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs
sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application PocketBase {#3-pocketbase-application-behaviour}

- **Pas de tâche de base de données au premier déploiement.** PocketBase crée lui-même sa
  base de données SQLite, ses collections système et son schéma au premier démarrage, sous
  `/pb_data`. Il n'y a aucune tâche `db-init` à exécuter ni à surveiller.
- **Les migrations s'appliquent automatiquement au démarrage.** PocketBase exécute lui-même
  les migrations de schéma en attente à chaque démarrage ; la mise à niveau de
  `application_version` applique donc les changements de schéma sans étape de migration
  distincte. Sauvegardez toujours le PVC avant un changement de version.
- **Le superutilisateur administrateur est créé au premier lancement.** Dès que PocketBase
  est accessible, ouvrez `/_/` et créez le compte administrateur. Tant qu'il n'existe pas,
  quiconque atteint `/_/` peut se l'approprier — traitez cette étape de premier lancement
  comme urgente.
- **Le PVC `/pb_data` est le seul état durable.** La base de données SQLite, les fichiers
  téléversés et les paramètres résident tous sur le PVC en mode bloc. Il survit aux
  redémarrages et replanifications des pods ; protégez-le et sauvegardez-le selon un
  calendrier.
- **StatefulSet à réplica unique.** SQLite sérialise les écritures via un seul fichier et le
  PVC est ReadWriteOnce. `min_instance_count` et `max_instance_count` valent tous deux `1`
  par défaut ; n'augmentez pas `max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, le point
  de terminaison public et non authentifié de PocketBase (il renvoie HTTP `200` /
  `{"code":200,"message":"API is healthy."}`). Le premier démarrage est rapide, car il n'y a
  aucune base de données externe à attendre.
- **Vérifier l'état d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- \
    wget -qO- http://127.0.0.1:8090/api/health
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | sort
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à PocketBase ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `pocketbase` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image ; `latest` se résout en l'ARG de build épinglé `0.22.21`. Épinglez une version explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; 1 vCPU suffit largement pour l'unique binaire Go. |
| `memory_limit` | `1Gi` | Mémoire par pod ; PocketBase est léger. |
| `min_instance_count` | `1` | Laissez à 1 — GKE exige min ≥ 1 et SQLite n'accepte qu'un seul rédacteur. |
| `max_instance_count` | `1` | **Ne l'augmentez pas.** SQLite + un PVC ReadWriteOnce n'acceptent qu'un seul rédacteur ; >1 corrompt les données. |
| `container_port` | `8090` | PocketBase écoute sur le port 8090 (API HTTP + interface d'administration). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL Auth Proxy — PocketBase n'utilise aucune base de données externe. |
| `enable_image_mirroring` | `true` | Duplique/construit l'image PocketBase dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Externe par défaut (PocketBase est exposé publiquement) ; utilisez `ClusterIP` pour un accès purement interne. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en StatefulSet, car `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Réplica unique : l'affinité de session est inutile. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Fortement recommandé** — offre à la base SQLite un stockage en mode bloc durable avec un verrouillage fiable. |
| `stateful_pvc_size` | `20Gi` | Dimensionnez le PVC pour la base SQLite, les fichiers téléversés et une marge. |
| `stateful_pvc_mount_path` | `/pb_data` | Doit être le répertoire de données de PocketBase — ne le modifiez pas. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 15s | Sonde de démarrage ; rapide, car il n'y a aucune base de données externe à attendre. |
| `liveness_probe` | HTTP `/api/health`, délai de 30s | Sonde de vivacité sur le point de terminaison de santé public. |
| `uptime_check_config` | désactivé, chemin `/api/health` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — PocketBase persiste tout sur le PVC `/pb_data`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` / `db_user` | _(vide)_ | Sans effet — PocketBase utilise une base de données SQLite intégrée ; aucun rôle ni aucune base Cloud SQL n'est créé. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré (actif uniquement lorsque `application_domains` est défini). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à PocketBase. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration personnalisées (aucune par défaut). |
| `statefulset_name` | Nom du StatefulSet PocketBase. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt (false lors du premier apply d'un nouveau cluster inline). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du
> socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du
> plan — un type de charge de travail `Deployment` avec `stateful_pvc_enabled = true`, des
> valeurs de mémoire ResourceQuota en entiers nus, IAP sans identités autorisées, des valeurs
> de sonde ou de rétention hors plage. Une configuration invalide fait échouer le **plan**
> avec une erreur claire et nommée avant la création de toute ressource ; la plupart des
> erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critical | SQLite n'accepte qu'un seul rédacteur et le PVC est ReadWriteOnce ; un second réplica ne peut pas monter le volume et des rédacteurs concurrents corrompent la base de données. |
| `stateful_pvc_enabled` | `true` | Critical | Sans PVC en mode bloc, SQLite se rabat sur un stockage de type GCS FUSE au verrouillage peu fiable → corruption de la base de données. |
| Le PVC `/pb_data` | Ne jamais le supprimer ; le sauvegarder | Critical | Le PVC **est** la base de données et le stockage de fichiers — le supprimer détruit toutes les données. |
| `stateful_pvc_mount_path` | `/pb_data` (fixe) | Critical | Monter le PVC ailleurs conduit PocketBase à écrire sa base de données sur le stockage éphémère du pod, perdu au redémarrage. |
| Compte administrateur sur `/_/` | Le créer dès que l'accès est possible | Critical | Tant que le superutilisateur n'existe pas, quiconque atteint `/_/` peut se l'approprier et prendre le contrôle de l'instance. |
| Changement de `application_version` | Sauvegarder d'abord le PVC | High | PocketBase migre automatiquement le schéma au démarrage ; une mise à niveau interrompue peut laisser la base SQLite en pleine migration. |
| `workload_type` | laisser `null` (StatefulSet automatique) | High | Forcer `Deployment` avec `stateful_pvc_enabled = true` fait échouer la validation au moment du plan. |
| `service_type` | `LoadBalancer` (externe, la valeur par défaut) ou `ClusterIP` (interne) | High | Passer à `ClusterIP` alors qu'un accès externe est nécessaire rend l'application inaccessible depuis l'extérieur du cluster. |
| `enable_iap` | Uniquement pour les déploiements privés | High | IAP bloque toutes les requêtes non authentifiées, y compris les clients publics de l'API et l'interface d'administration. |
| `stateful_pvc_size` | `20Gi` (à augmenter en cas de nombreux téléversements) | Medium | Un PVC trop petit se remplit à mesure que les fichiers téléversés s'accumulent, et les PVC ne peuvent pas toujours être réduits. |
| `memory_limit` | `1Gi` | Low | PocketBase est léger ; le surprovisionnement ne fait qu'augmenter le coût sur Autopilot. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à PocketBase partagée avec la
variante Cloud Run est décrite dans **[PocketBase_Common](PocketBase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PocketBase sur GKE Autopilot](../labs/PocketBase_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [PocketBase sur Google Cloud Run](PocketBase_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [PocketBase Common — Configuration applicative partagée](PocketBase_Common.md) — la configuration partagée par les deux cibles de déploiement.
