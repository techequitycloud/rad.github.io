---
title: "Uptime Kuma sur GKE Autopilot"
description: "Référence de configuration pour le déploiement d'Uptime Kuma sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/UptimeKuma_GKE.md @ 15fd4c7 sha256:c42b85c1beda -->

# Uptime Kuma sur GKE Autopilot {#uptime-kuma-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_GKE.png" alt="Uptime Kuma sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma est un outil de surveillance de la disponibilité auto-hébergé pour
les sites web, les API, les ports TCP, les enregistrements DNS, et plus encore,
avec un tableau de bord clair, des pages d'état publiques et plus de 90 canaux
de notification. Ce module déploie Uptime Kuma sur **GKE Autopilot** en
s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Uptime Kuma v1 est inhabituel parmi les applications de ce dépôt : il stocke
**tout l'état dans une base de données SQLite embarquée** sous `/app/data` — il n'y a pas de base de données externe, pas de cache Redis, et pas de secret d'application à gérer.

Ce guide se concentre sur les services cloud qu'Uptime Kuma utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Uptime Kuma s'exécute comme une seule charge de travail web Node.js tirée
directement de l'image officielle de Docker Hub. Le déploiement relie un
ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods personnalisés basés sur `louislam/uptime-kuma` sur le port 3001, 1 vCPU / 512 Mio par défaut |
| Base de données | Aucune (SQLite embarquée) | `database_type = "NONE"` — aucune instance Cloud SQL n'est provisionnée |
| Persistance des fichiers | Cloud Filestore (NFS) | La base de données SQLite et les téléchargements persistent sous `/app/data`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Aucun provisionné par défaut — `storage_buckets = []` |
| Secrets | Secret Manager | Aucun — Uptime Kuma n'a pas de secret d'application ; les identifiants d'administrateur résident dans sa propre base de données SQLite |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe avec une IP statique réservée ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **Pas de base de données externe.** `database_type = "NONE"` est fixé par
  `UptimeKuma_Common` ; `enable_cloudsql_volume = false` et aucun job
  `db-init` ne s'exécute. Uptime Kuma crée son schéma SQLite au premier
  démarrage.
- **NFS est obligatoire pour la persistance.** `enable_nfs = true`, monté à
  `/app/data` (le chemin du conteneur est fixe — ne le modifiez pas). Sans le
  volume NFS, la base de données SQLite et tout l'historique des moniteurs
  sont éphémères et perdus lors de la recréation du pod.
  Alternativement, `stateful_pvc_enabled = true` (désactivé par défaut) déplace le même
  chemin `/app/data` sur un PVC de bloc par pod, le support plus robuste pour
  SQLite ; le montage NFS est alors abandonné, car un chemin ne peut pas avoir
  deux montages de volume.
- **Pas de Redis, pas de secrets d'application.** `UptimeKuma_Common` produit
  `secret_ids = {}` ; il n'y a rien à injecter depuis Secret Manager.
- **La build personnalisée corrige SQLite pour la sécurité NFS.** `container_image_source =
  "custom"` construit une image légère `FROM louislam/uptime-kuma:<application_version>`
  (tag par défaut `1`, la ligne v1 stable/SQLite) via Cloud Build. Uptime Kuma
  définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans
  `server/database.js`, non configurable via une variable d'environnement) ; WAL repose sur
  le verrouillage de plage d'octets en mémoire partagée entre le fichier DB et son
  fichier sidecar `-wal`, ce que le volume `/app/data` basé sur NFS ne fournit pas de manière fiable et a
  produit des erreurs `SQLITE_CORRUPT` observées. La build corrige ce PRAGMA en mode
  `DELETE`, qui ne nécessite qu'un verrouillage de fichier entier standard que NFS gère
  correctement. L'image construite est ensuite mise en miroir dans Artifact Registry par défaut
  (`enable_image_mirroring = true`) pour éviter les limites de débit de Docker Hub.
- **`container_port = 3001`** — le port natif d'Uptime Kuma.
- **Réplica unique par défaut et requis.** `min_instance_count = 1`,
  `max_instance_count = 1`. SQLite est une base de données à écrivain unique ; ne pas
  dépasser 1 réplica partageant le même fichier de base de données monté sur NFS.
- **`tenant_id` reçoit un suffixe `-gke`** lorsque la variante appelle
  `UptimeKuma_Common`, de sorte qu'une variante Cloud Run et GKE sur le même
  `tenant_id` n'entrent pas en collision sur la dénomination commune.
- **La configuration initiale est entièrement intégrée à l'application.** Il n'y a pas de compte
  administrateur par défaut — Uptime Kuma vous invite à en créer un lors du
  premier accès.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Uptime Kuma {#a-gke-autopilot--the-uptime-kuma-workload}

Les pods Uptime Kuma sont planifiés sur Autopilot, qui facture le CPU/la
mémoire que les pods demandent réellement. La charge de travail est déployée
en tant que `Deployment`
(`workload_type` par défaut à `Deployment` ; un `StatefulSet` fonctionne également avec
le volume NFS si sélectionné).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Uptime Kuma pour les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud Filestore (NFS) — la seule couche de persistance {#b-cloud-filestore-nfs--the-only-persistence-layer}

Parce qu'Uptime Kuma n'a pas de base de données externe, **tout l'état durable** —
moniteurs, historique des vérifications, configuration des notifications, pages
d'état et compte administrateur — réside dans un seul fichier SQLite sur le
volume NFS monté à `/app/data`. Cela fait du montage NFS la ressource la plus
importante à protéger pour ce module : le perdre, c'est tout perdre.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

Voir [App_GKE](App_GKE.md) pour le provisionnement NFS, la découverte et le
modèle de VM NFS partagé vs. intégré.

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket GCS n'est provisionné pour Uptime Kuma par défaut
(`storage_buckets = []` dans `UptimeKuma_Common`) ; toute la persistance est sur NFS.
Définissez `create_cloud_storage`/`storage_buckets` explicitement si vous avez besoin d'un bucket
pour les sauvegardes exportées ou l'automatisation.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### D. Secret Manager {#d-secret-manager}

Uptime Kuma ne nécessite **aucun secret d'application** — `secret_ids = {}`. Le
mot de passe de la base de données affiché par la Fondation est inutilisé (il
n'y a pas d'instance Cloud SQL). Seuls les secrets au niveau de la Fondation
que vous ajoutez explicitement via `secret_environment_variables` apparaîtront ici.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré
par Google peut être activé via `enable_custom_domain`/`application_domains`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques. Confirmez également que le chemin de sortie GKE
permet au pod d'atteindre les points de terminaison externes que vous
configurez Uptime Kuma pour surveiller.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging. Des
tests de disponibilité et des politiques d'alerte Cloud Monitoring
facultatifs sont disponibles (`uptime_check_config.enabled =
false` par défaut) — notez qu'il s'agit d'un test de disponibilité Google Cloud *sur le service Uptime
Kuma lui-même*, distinct des moniteurs que vous configurez dans Uptime Kuma.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Uptime Kuma {#3-uptime-kuma-application-behaviour}

- **Pas de job d'initialisation.** `initialization_jobs` est vide par défaut —
  Uptime Kuma crée son schéma SQLite lui-même au premier démarrage sur le
  volume `/app/data` vide. Les jobs fournis par l'utilisateur sont toujours
  honorés s'ils sont fournis.
- **La configuration initiale est manuelle et intégrée à l'application.** Lors du premier accès à l'URL du
  service, Uptime Kuma affiche son assistant de configuration pour créer le
  compte administrateur initial — il n'y a pas d'identifiants par défaut ou
  générés automatiquement à récupérer depuis Secret Manager.
- **Chemin de santé.** Les sondes de démarrage et de vivacité par défaut sont toutes deux
  **HTTP** `GET /api/entry-page` sur le port `3001` — `/` est toujours un 302, que la vérification de santé de la passerelle
  considère comme non saine (démarrage : délai initial de 30 s, période de 10 s, seuil
  d'échec de 30 ; vivacité : délai initial de 30 s, période de 30 s, seuil
  d'échec de 3). La vérification de disponibilité Cloud Monitoring facultative cible également `GET /`.
- **SQLite à écrivain unique sur NFS.** L'exécution de plus d'un réplica sur le même
  fichier SQLite `/app/data` risque une contention ou une corruption de verrouillage de base de données ;
  gardez `min_instance_count = max_instance_count = 1` à moins que le
  comportement de verrouillage de fichier du serveur NFS sous des écrivains SQLite
  concurrents n'ait été vérifié séparément.
- **Inspectez la configuration en cours d'exécution et le volume de données :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i uptime
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Uptime Kuma sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 2 — Identité de l'application et de la base de données {#group-2--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `1` | Tag de l'image `louislam/uptime-kuma` ; `"1"` est la ligne stable v1 (SQLite embarqué). |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une image personnalisée légère via Cloud Build qui corrige le `journal_mode` codé en dur de SQLite de `WAL` à `DELETE` pour la sécurité NFS (voir Vue d'ensemble). Gardez `custom`. |
| `container_port` | `3001` | Port natif d'Uptime Kuma. |
| `enable_cloudsql_volume` | `false` | Inutilisé — Uptime Kuma n'a pas de base de données externe. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Gardez les deux à `1` — écrivain SQLite unique. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Limites CPU/mémoire par pod. |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour le tableau de bord Uptime Kuma. |
| `workload_type` | `null` → `Deployment` | Déploiement ; `StatefulSet` fonctionne également avec le volume NFS si explicitement sélectionné. |
| `session_affinity` | (Valeur par défaut de la fondation) | Pas de surcharge spécifique à l'application ; Uptime Kuma n'a pas d'état de serveur par session au-delà de la base de données SQLite. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/api/entry-page" }` (HTTP, port 3001) | Sonde de démarrage. |
| `health_check_config` | `{ enabled=true, path="/api/entry-page" }` (HTTP, port 3001) | Sonde de vivacité. Doit retourner un 200 littéral — elle est mise en miroir dans la vérification de santé de la passerelle. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring sur le service lui-même (pas un moniteur Uptime Kuma). |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Obligatoire.** Le seul mécanisme de persistance pour la base de données SQLite embarquée. |
| `nfs_mount_path` | `/app/data` | Fixé par la disposition de stockage de l'application — ne pas modifier. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `"NONE"` | Fixé par `UptimeKuma_Common`. Aucune instance Cloud SQL n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe de l'équilibreur de charge (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Uptime Kuma. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Présent pour la parité de sortie avec d'autres modules ; **non significatif pour Uptime Kuma** — aucune instance Cloud SQL n'est provisionnée (`database_type = "NONE"`). |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs d'initialisation créés (vides par défaut) et job d'importation facultatif. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de dénomination. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un
> `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités
> autorisées, `quota_memory_*` donné comme des entiers bruts, un
> `container_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Le désactiver supprime la seule couche de persistance — la base de données SQLite embarquée (tous les moniteurs, l'historique et le compte administrateur) est éphémère et perdue à chaque recréation de pod. |
| `nfs_mount_path` | `/app/data` | Critique | Le modifier éloigne le chemin de données codé en dur d'Uptime Kuma du volume persistant ; l'application écrit SQLite vers un chemin qui n'est pas réellement le partage NFS monté. |
| `max_instance_count` | `1` | Élevé | SQLite est à écrivain unique ; l'exécution de plus d'un réplica sur le même fichier de base de données monté sur NFS risque une contention ou une corruption de verrouillage. |
| `database_type` | `"NONE"` | Faible | Uptime Kuma l'ignore — il ne se connecte jamais à Cloud SQL — mais le modifier provisionnera toujours une instance Cloud SQL inutilisée et facturée via la Fondation. |
| `container_port` | `3001` | Élevé | Uptime Kuma écoute sur le port 3001 ; pointer le service/les sondes vers un autre port rend la charge de travail inaccessible et les sondes échouent. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS, les favoris et tout intégration de page d'état externe. |
| Configuration admin initiale | Terminer immédiatement après le déploiement | Moyen | L'assistant de configuration est accessible à quiconque trouve l'URL avant la création d'un compte administrateur — ne laissez pas une instance fraîchement déployée avec une IP publique non configurée pendant longtemps. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | S'applique aux sauvegardes gérées par la Fondation ; étant donné que l'état réel d'Uptime Kuma est le fichier SQLite hébergé sur NFS, vérifiez la couverture de sauvegarde NFS/Filestore séparément plutôt que de vous fier uniquement à ce paramètre. |
| `container_image_source` | `custom` (par défaut) | Critique | Définir `"prebuilt"` ignore l'étape Cloud Build et déploie l'image amont non patchée — Uptime Kuma écrit alors SQLite en mode WAL sur NFS, ce qui a produit des corruptions de base de données `SQLITE_CORRUPT` observées. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Uptime
Kuma partagée avec la variante Cloud Run est décrite dans
**[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Uptime Kuma sur GKE Autopilot](../labs/UptimeKuma_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Uptime Kuma Common — Configuration d'application partagée](UptimeKuma_Common.md) — la configuration partagée par les deux cibles de déploiement.
