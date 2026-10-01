---
title: "Budibase sur GKE Autopilot"
description: "Référence de configuration pour déployer Budibase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Budibase_GKE.md @ 3055034 sha256:8dc3b034b280 -->

# Budibase sur GKE Autopilot {#budibase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Budibase_GKE.png" alt="Budibase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Budibase est une plateforme low-code open source permettant de créer des outils internes,
des applications métier et des workflows à partir de vos données. Ce module déploie Budibase sur **GKE
Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Budibase et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Budibase s'exécute sous la forme d'un unique pod **tout-en-un**. L'image officielle `budibase/budibase`
regroupe **CouchDB + MinIO + Redis** ainsi que les applications/le worker/le proxy de Budibase, et
sert le HTTP sur le **port 80** — il n'y a aucune base de données gérée externe. Comme tout l'état
réside dans `/data`, la variante GKE s'exécute en tant que **StatefulSet** avec un PVC en mode bloc monté
sur `/data`. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod tout-en-un, 2 vCPU / 4 GiB par défaut ; s'exécute en **un seul** réplica (min = max = 1) |
| État persistant | Persistent Disk (PVC en mode bloc) | `stateful_pvc_enabled = true` → StatefulSet avec un PVC de 20 GiB monté sur `/data` |
| Base de données | Aucune (CouchDB intégré) | `database_type = "NONE"` — CouchDB, MinIO et Redis s'exécutent tous dans le pod |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement ; le stockage d'éléments propre à Budibase est le MinIO intégré |
| Cache et file d'attente | Redis intégré | S'exécute dans le pod sur l'interface loopback ; `enable_redis` est désactivé par défaut |
| Secrets | Secret Manager | Sept identifiants internes générés automatiquement, injectés comme variables d'environnement secrètes du service |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **StatefulSet avec un PVC en mode bloc sur `/data`.** `stateful_pvc_enabled = true` (par défaut),
  ce qui résout automatiquement `workload_type` en `StatefulSet`. Tous les documents CouchDB et
  objets MinIO persistent sur un PVC `standard-rwo` de 20 GiB monté sur `/data` ; les données
  survivent donc aux redémarrages de pod et aux redéploiements.
- **S'exécute en un seul réplica.** `min_instance_count = 1` et `max_instance_count = 1`.
  Le pod tout-en-un conserve tout son état sur son propre PVC ; plusieurs réplicas ne
  partageraient donc pas les données (split-brain).
- **Sept identifiants internes sont générés automatiquement** et stockés dans Secret
  Manager (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
  `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). Ils ne doivent jamais faire l'objet d'une
  rotation après le premier démarrage — les données de `/data` sont chiffrées avec eux et deviennent
  illisibles s'ils changent.
- **Le port 80 est fixe.** Le proxy nginx de l'image tout-en-un sert l'ensemble de l'application sur
  le port 80 ; `container_port` et les sondes du pod sont donc fixés à 80.
- **Aucune base de données externe ni job `db-init`.** Budibase provisionne lui-même CouchDB et
  MinIO au premier démarrage ; `database_type` vaut `NONE` par défaut.
- **LoadBalancer externe par défaut.** `service_type = "LoadBalancer"` expose une
  IP externe ; une IP statique et un domaine personnalisé peuvent y être ajoutés.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Budibase {#a-gke-autopilot--the-budibase-workload}

Budibase s'exécute sous la forme d'un pod **StatefulSet** sur Autopilot, qui facture le CPU et la mémoire
demandés par le pod. Comme il conserve tout son état sur son PVC, il s'exécute en un seul réplica.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Budibase pour voir
  le pod, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. État persistant (PVC en mode bloc sur `/data`) {#b-persistent-state-block-pvc-on-data}

Tout l'état de Budibase — le magasin de documents CouchDB et le magasin d'objets MinIO intégrés —
persiste sur un **Persistent Disk en mode bloc** provisionné via le modèle de PVC du StatefulSet
(`stateful_pvc_size = 20Gi`, `stateful_pvc_storage_class = standard-rwo`) et monté
sur `/data`. C'est ce qui fait de GKE la plateforme durable pour Budibase.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ; Compute
  Engine → Disks.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  # Confirm the /data mount inside the pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- df -h /data
  ```

### C. Magasin de données (CouchDB + MinIO intégrés) {#c-data-store-bundled-couchdb--minio}

Il n'y a **aucune instance Cloud SQL** — `database_type = "NONE"`. CouchDB et MinIO s'exécutent
**dans le pod** et persistent sur le PVC `/data`. Inspectez-les via le pod plutôt
que via une console de base de données gérée :

- **CLI :**
  ```bash
  # Confirm database_type=NONE and the bundled-service env in the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -Ei 'couch|minio|redis'
  ```

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Le stockage d'éléments/de pièces jointes propre à Budibase est le MinIO intégré sur `/data` ;
ce bucket GCS est disponible pour l'intégration du stockage au niveau du socle.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Redis (intégré) {#e-redis-bundled}

Redis s'exécute **dans le pod** sur l'interface loopback et s'authentifie avec le
`REDIS_PASSWORD` généré automatiquement. `enable_redis` est **désactivé par défaut** — n'activez pas
de Redis externe sauf pour externaliser délibérément le cache.

- **CLI :**
  ```bash
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep -i redis
  ```

### F. Secret Manager {#f-secret-manager}

Sept identifiants internes sont générés automatiquement et stockés dans Secret Manager,
puis injectés comme variables d'environnement secrètes du service : `INTERNAL_API_KEY`, `JWT_SECRET`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD` et
`COUCH_DB_PASSWORD`. Ils ne doivent jamais faire l'objet d'une rotation après le premier démarrage.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~budibase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et
[Budibase_Common](Budibase_Common.md) pour ce que protège chaque secret.

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = "LoadBalancer"`). Un domaine personnalisé avec un certificat géré par Google
peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Budibase {#3-budibase-application-behaviour}

- **Aucune initialisation de base de données externe.** Avec `database_type = "NONE"`, il n'y a pas de
  job `db-init`. Budibase provisionne lui-même ses CouchDB et MinIO intégrés au premier démarrage
  dans le pod. Seuls les `initialization_jobs` fournis par l'utilisateur sont pris en compte.
- **L'état persiste sur le PVC `/data`.** Les documents CouchDB et les objets MinIO sont
  écrits sur le PVC en mode bloc monté sur `/data` ; les données survivent donc aux redémarrages de pod,
  aux replanifications et aux mises à niveau de version. Dimensionnez le PVC généreusement
  (`stateful_pvc_size = 20Gi` par défaut) — il grossit avec les données et les pièces jointes des applications.
- **Les identifiants internes sont immuables après le premier démarrage.** Les sept secrets
  générés chiffrent les données de `/data`. Modifier `API_ENCRYPTION_KEY` corrompt toutes les
  données chiffrées stockées ; modifier `JWT_SECRET` invalide toutes les sessions ; modifier les
  identifiants MinIO ou CouchDB rompt l'accès aux magasins d'objets/de documents sur le PVC.
  N'effectuez de rotation que lors d'une réinitialisation planifiée.
- **Configuration au premier lancement.** Budibase auto-hébergé est livré **sans compte administrateur par défaut**.
  Accédez à l'URL du LoadBalancer après le déploiement et créez l'administrateur initial
  (e-mail + mot de passe) via l'écran de configuration avant toute utilisation.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine non authentifiée `/`,
  qui renvoie `200` une fois les services intégrés démarrés. Prévoyez jusqu'à ~8-9 minutes au
  premier démarrage (la sonde de démarrage utilise un délai initial de 60 secondes plus une fenêtre de 30 tentatives
  à une période de 15 secondes) — le pod doit démarrer CouchDB, MinIO, Redis et la couche applicative.
- **StatefulSet à réplica unique.** Conservez `min_instance_count = max_instance_count = 1` ;
  le magasin de données est lié à un seul PVC et ne peut pas être partagé entre réplicas.
- **Vérifier la charge de travail en cours d'exécution :**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- curl -s -o /dev/null -w '%{http_code}' localhost:80/
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Budibase ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `budibase` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `3.39.29` | Tag de l'image Budibase ; utilisé comme `FROM budibase/budibase:<tag>` pour le build de l'image enveloppe légère. Incrémentez-le pour déclencher un nouveau build. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_port` | `80` | Le proxy nginx de l'image tout-en-un sert l'ensemble de l'application sur le port 80 — container_port et les sondes doivent valoir 80. |
| `container_resources` | `2000m` / `4Gi` | CPU et mémoire par pod ; les CouchDB/MinIO/Redis intégrés et la couche applicative ont besoin d'une mémoire généreuse. |
| `min_instance_count` | `1` | Laissez à 1 — le magasin de données est lié à un seul PVC. |
| `max_instance_count` | `1` | Laissez à 1 — les réplicas ne partageraient pas `/data`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une IP externe pour l'interface. |
| `workload_type` | `null` → `StatefulSet` | Se résout automatiquement en `StatefulSet` car `stateful_pvc_enabled = true`. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | **Doit rester à true.** Budibase conserve tout son état dans `/data` ; un PVC en mode bloc y est monté. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; grossit avec les données et les pièces jointes des applications — dimensionnez généreusement. |
| `stateful_pvc_mount_path` | `/data` | Point de montage du PVC — le répertoire de données CouchDB + MinIO de Budibase. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass en mode bloc du PVC. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Redis s'exécute dans le pod ; laissez désactivé sauf pour externaliser le cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisés uniquement si un Redis externe est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Budibase intègre son propre CouchDB ; aucune base de données gérée externe n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Budibase. |
| `database_instance_name` / `database_name` / `database_user` | Renseignés uniquement si une base de données gérée est utilisée ; vides pour Budibase (`database_type = NONE`). |
| `database_password_secret` / `database_host` / `database_port` | Secret / point de terminaison / port de la base de données (inutilisés pour Budibase). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des éventuels jobs de configuration fournis par l'utilisateur et du job d'import (facultatif). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `workload_type = "Deployment"` associé à `stateful_pvc_enabled = true`, des `quota_memory_*` sans suffixe d'unité binaire, un `container_port` hors limites, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | `true` | Critical | S'il vaut false, Budibase ne dispose d'aucun `/data` durable — tout l'état CouchDB + MinIO est perdu à chaque redémarrage/replanification du pod. |
| `API_ENCRYPTION_KEY` (généré automatiquement) | Aucune rotation après le premier démarrage | Critical | Sa rotation corrompt toutes les données chiffrées stockées — elles ne peuvent plus être déchiffrées. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `COUCH_DB_PASSWORD` (générés automatiquement) | Aucune rotation après le premier démarrage | Critical | Leur rotation rompt l'accès aux magasins d'objets/de documents intégrés sur le PVC `/data`. |
| `max_instance_count` | `1` | Critical | Plusieurs réplicas ne peuvent pas partager l'unique PVC `/data` — split-brain et perte de données. |
| `JWT_SECRET` (généré automatiquement) | Rotation uniquement lors d'une fenêtre de maintenance | High | Sa rotation invalide toutes les sessions utilisateur actives et impose une reconnexion immédiate. |
| `workload_type` | `null` (auto → StatefulSet) | High | Forcer `Deployment` avec `stateful_pvc_enabled = true` fait échouer le plan ; un Deployment ne peut pas générer de PVC par pod. |
| `container_port` | `80` | High | Le proxy nginx sert l'application sur le port 80 ; tout autre port fait échouer les sondes et le pod ne passe jamais à l'état Ready. |
| `database_type` | `NONE` | High | Choisir un moteur externe provisionne une instance Cloud SQL inutilisée ; Budibase ne s'y connecte jamais. |
| `memory_limit` | `4Gi` | High | Exécuter CouchDB + MinIO + Redis + la couche applicative avec moins de ~2 GiB provoque des arrêts OOM au démarrage. |
| `stateful_pvc_size` | `20Gi`+ | Medium | Un sous-dimensionnement risque de remplir le PVC à mesure que les données/pièces jointes croissent, bloquant les écritures CouchDB/MinIO. |
| Premier compte administrateur | À créer immédiatement après le déploiement | High | Budibase auto-hébergé est livré sans administrateur par défaut — une instance non revendiquée peut être revendiquée par quiconque atteint l'URL. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Budibase, partagée avec la variante Cloud Run, est
décrite dans **[Budibase_Common](Budibase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Budibase sur GKE Autopilot](../labs/Budibase_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Budibase sur Google Cloud Run](Budibase_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Budibase Common — Configuration applicative partagée](Budibase_Common.md) — la configuration partagée par les deux cibles de déploiement.
