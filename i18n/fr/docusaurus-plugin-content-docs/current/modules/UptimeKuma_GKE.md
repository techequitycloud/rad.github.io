---
title: "Uptime Kuma sur GKE Autopilot"
description: "Référence de configuration pour déployer Uptime Kuma sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/UptimeKuma_GKE.md @ 3055034 sha256:9600b3e59785 -->

# Uptime Kuma sur GKE Autopilot {#uptime-kuma-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_GKE.png" alt="Uptime Kuma sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma est un outil auto-hébergé de supervision de la disponibilité des
sites web, des API, des ports TCP, des enregistrements DNS et bien plus, avec un
tableau de bord épuré, des pages de statut publiques et plus de 90 canaux de
notification. Ce module déploie Uptime Kuma sur **GKE Autopilot** en s'appuyant
sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Uptime Kuma v1 se distingue parmi les applications de ce dépôt : il stocke
**tout son état dans une base de données SQLite intégrée** sous `/app/data` — il
n'y a ni base de données externe, ni cache Redis, ni secret applicatif à gérer.

Ce guide se concentre sur les services cloud utilisés par Uptime Kuma et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Uptime Kuma s'exécute sous la forme d'une unique charge de travail web Node.js,
tirée directement de l'image officielle de Docker Hub. Le déploiement assemble
un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods construits sur mesure à partir de `louislam/uptime-kuma`, sur le port 3001, 1 vCPU / 512Mi par défaut |
| Base de données | Aucune (SQLite intégré) | `database_type = "NONE"` — aucune instance Cloud SQL n'est provisionnée |
| Persistance des fichiers | Cloud Filestore (NFS) | La base de données SQLite et les fichiers téléversés sont conservés sous `/app/data`, partagé entre les pods |
| Stockage d'objets | Cloud Storage | Aucun provisionné par défaut — `storage_buckets = []` |
| Secrets | Secret Manager | Aucun — Uptime Kuma n'a pas de secret applicatif ; les identifiants administrateur sont stockés dans sa propre base SQLite |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type = "NONE"` est fixé par
  `UptimeKuma_Common` ; `enable_cloudsql_volume = false` et aucun job `db-init`
  ne s'exécute. Uptime Kuma crée son schéma SQLite au premier démarrage.
- **NFS est obligatoire pour la persistance.** `enable_nfs = true`, monté sur
  `/app/data` (le chemin dans le conteneur est fixe — ne le modifiez pas). Sans
  le volume NFS, la base de données SQLite et tout l'historique des moniteurs
  sont éphémères et perdus lors de la recréation d'un pod.
- **Ni Redis, ni secrets applicatifs.** `UptimeKuma_Common` renvoie
  `secret_ids = {}` ; il n'y a rien à injecter depuis Secret Manager.
- **Le build personnalisé corrige SQLite pour la sécurité sur NFS.** `container_image_source =
  "custom"` construit via Cloud Build une fine image `FROM louislam/uptime-kuma:<application_version>`
  (tag par défaut `1`, la branche stable v1/SQLite). Uptime Kuma définit
  inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans
  `server/database.js`, non configurable par variable d'environnement) ; WAL repose sur un
  verrouillage par plages d'octets en mémoire partagée entre le fichier de base de données et son fichier annexe `-wal`,
  que le volume `/app/data` adossé à NFS ne fournit pas de manière fiable, ce qui a
  provoqué des erreurs `SQLITE_CORRUPT` constatées. Le build fait passer ce PRAGMA en
  mode `DELETE`, qui n'a besoin que du verrouillage standard du fichier entier, que NFS gère
  correctement. L'image construite est ensuite mise en miroir par défaut dans Artifact Registry
  (`enable_image_mirroring = true`) pour éviter les limites de débit de Docker Hub.
- **`container_port = 3001`** — le port natif d'Uptime Kuma.
- **Un seul réplica, par défaut et obligatoirement.** `min_instance_count = 1`,
  `max_instance_count = 1`. SQLite est une base de données à écrivain unique ;
  ne dépassez pas 1 réplica partageant le même fichier de base de données monté via NFS.
- **`tenant_id` reçoit un suffixe `-gke`** lorsque la variante appelle
  `UptimeKuma_Common`, afin qu'une variante CloudRun et une variante GKE sur le même
  `tenant_id` n'entrent pas en collision sur les noms gérés par Common.
- **La configuration au premier lancement se fait entièrement dans l'application.** Il n'existe pas de compte administrateur par défaut —
  Uptime Kuma vous invite à en créer un lors du premier accès.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Uptime Kuma {#a-gke-autopilot--the-uptime-kuma-workload}

Les pods Uptime Kuma sont planifiés sur Autopilot, qui facture la CPU et la
mémoire réellement demandées par les pods. La charge de travail est déployée en
tant que `Deployment` (`workload_type` vaut `Deployment` par défaut ; un
`StatefulSet` fonctionne aussi avec le volume NFS s'il est sélectionné).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Uptime Kuma pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud Filestore (NFS) — l'unique couche de persistance {#b-cloud-filestore-nfs--the-only-persistence-layer}

Comme Uptime Kuma n'a pas de base de données externe, **tout l'état durable** —
moniteurs, historique des vérifications, configuration des notifications, pages
de statut et compte administrateur — réside dans un unique fichier SQLite sur le
volume NFS monté sur `/app/data`. Le montage NFS est donc la ressource la plus
importante à protéger pour ce module : le perdre, c'est tout perdre.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

Consultez [App_GKE](App_GKE.md) pour le provisionnement et la découverte du NFS,
ainsi que le modèle de VM NFS partagée ou intégrée.

### C. Cloud Storage {#c-cloud-storage}

Aucun bucket GCS n'est provisionné par défaut pour Uptime Kuma
(`storage_buckets = []` dans `UptimeKuma_Common`) ; toute la persistance repose
sur NFS. Définissez explicitement `create_cloud_storage`/`storage_buckets` si
vous avez besoin d'un bucket pour des sauvegardes exportées ou de l'automatisation.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### D. Secret Manager {#d-secret-manager}

Uptime Kuma ne requiert **aucun secret applicatif** — `secret_ids = {}`. La
sortie de mot de passe de base de données exposée par le socle est inutilisée
(il n'y a pas d'instance Cloud SQL). Seuls les secrets du socle que vous ajoutez
explicitement via `secret_environment_variables` apparaîtront ici.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~uptimekuma"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements). Un domaine personnalisé avec un
certificat géré par Google peut être activé via
`enable_custom_domain`/`application_domains`.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les IP statiques. Vérifiez également que le chemin de sortie GKE permet au pod
d'atteindre les points de terminaison externes que vous configurez dans Uptime
Kuma pour la supervision.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging. Des tests de
disponibilité et des règles d'alerte Cloud Monitoring sont disponibles en option
(`uptime_check_config.enabled =
false` par défaut) — notez qu'il s'agit d'un
test de disponibilité Google Cloud *portant sur le service Uptime Kuma
lui-même*, distinct des moniteurs que vous configurez dans Uptime Kuma.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Uptime Kuma {#3-uptime-kuma-application-behaviour}

- **Aucun job d'initialisation.** `initialization_jobs` est vide par défaut —
  Uptime Kuma crée lui-même son schéma SQLite au premier démarrage sur le volume
  `/app/data` vide. Les jobs fournis par l'utilisateur restent pris en compte
  s'il y en a.
- **La configuration au premier lancement est manuelle et se fait dans l'application.**
  Lors du premier accès à l'URL du service, Uptime Kuma affiche son assistant de
  configuration pour créer le compte administrateur initial — il n'existe aucun
  identifiant par défaut ou généré automatiquement à récupérer dans Secret Manager.
- **Chemin de santé.** Les sondes par défaut de démarrage et de vivacité sont
  toutes deux des requêtes **HTTP** `GET /` sur le port `3001` (démarrage : délai
  initial de 30 s, période de 10 s, seuil d'échec de 30 ; vivacité : délai initial
  de 30 s, période de 30 s, seuil d'échec de 3). Le test de disponibilité Cloud
  Monitoring facultatif cible lui aussi `GET /`.
- **SQLite à écrivain unique sur NFS.** Exécuter plus d'un réplica sur le même
  fichier SQLite `/app/data` expose à des conflits de verrouillage de la base de
  données ou à une corruption ; conservez `min_instance_count = max_instance_count = 1`
  à moins que le comportement de verrouillage de fichiers du serveur NFS face à
  des écrivains SQLite concurrents n'ait été vérifié séparément.
- **Inspectez la configuration en cours d'exécution et le volume de données :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i uptime
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /app/data
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Uptime Kuma ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 2 — Identité de l'application et de la base de données {#group-2--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `1` | Tag de l'image `louislam/uptime-kuma` ; `"1"` correspond à la branche stable v1 (SQLite intégré). |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit via Cloud Build une fine image personnalisée qui fait passer le `journal_mode` codé en dur de SQLite de `WAL` à `DELETE` pour la sécurité sur NFS (voir la Vue d'ensemble). Conservez `custom`. |
| `container_port` | `3001` | Port natif d'Uptime Kuma. |
| `enable_cloudsql_volume` | `false` | Inutilisé — Uptime Kuma n'a pas de base de données externe. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Conservez les deux à `1` — un seul écrivain SQLite. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Limites de CPU/mémoire par pod. |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour le tableau de bord Uptime Kuma. |
| `workload_type` | `null` → `Deployment` | Deployment ; `StatefulSet` fonctionne aussi avec le volume NFS s'il est sélectionné explicitement. |
| `session_affinity` | (valeur par défaut du socle) | Pas de surcharge propre à l'application ; Uptime Kuma n'a pas d'état serveur par session au-delà de la base SQLite. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `{ enabled=true, path="/" }` (HTTP, port 3001) | Sonde de démarrage. |
| `health_check_config` | `{ enabled=true, path="/" }` (HTTP, port 3001) | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring portant sur le service lui-même (et non un moniteur Uptime Kuma). |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Obligatoire.** L'unique mécanisme de persistance de la base de données SQLite intégrée. |
| `nfs_mount_path` | `/app/data` | Fixé par la structure de stockage de l'application — ne le modifiez pas. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `"NONE"` | Fixé par `UptimeKuma_Common`. Aucune instance Cloud SQL n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Uptime Kuma. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Présentes pour la parité des sorties avec les autres modules ; **sans signification pour Uptime Kuma** — aucune instance Cloud SQL n'est provisionnée (`database_type = "NONE"`). |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs d'initialisation créés (vide par défaut) et job d'import facultatif. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre
> sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous
> forme d'entiers nus, un `container_port`/`backup_retention_days` hors plage.
> Une configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous
> sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critical | Le désactiver supprime l'unique couche de persistance — la base de données SQLite intégrée (tous les moniteurs, l'historique et le compte administrateur) devient éphémère et est perdue à chaque recréation de pod. |
| `nfs_mount_path` | `/app/data` | Critical | Le modifier éloigne du volume persistant le chemin de données codé en dur d'Uptime Kuma ; l'application écrit SQLite dans un chemin qui n'est pas réellement le partage NFS monté. |
| `max_instance_count` | `1` | High | SQLite est à écrivain unique ; exécuter plus d'un réplica sur le même fichier de base de données monté via NFS expose à des conflits de verrouillage ou à une corruption. |
| `database_type` | `"NONE"` | Low | Uptime Kuma l'ignore — il ne se connecte jamais à Cloud SQL — mais le modifier provisionnera tout de même, via le socle, une instance Cloud SQL inutilisée et facturée. |
| `container_port` | `3001` | High | Uptime Kuma écoute sur le port 3001 ; diriger le Service ou les sondes vers un autre port rend la charge de travail inaccessible et fait échouer les sondes. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS, les favoris et toute intégration externe de page de statut. |
| Configuration administrateur initiale | À effectuer immédiatement après le déploiement | Medium | L'assistant de configuration est accessible à quiconque trouve l'URL avant la création d'un compte administrateur — ne laissez pas longtemps une instance fraîchement déployée avec une IP publique sans configuration. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | S'applique aux sauvegardes gérées par le socle ; comme le véritable état d'Uptime Kuma est le fichier SQLite hébergé sur NFS, vérifiez séparément la couverture des sauvegardes NFS/Filestore plutôt que de vous fier uniquement à ce paramètre. |
| `container_image_source` | `custom` (par défaut) | Critical | Définir `"prebuilt"` ignore l'étape Cloud Build et déploie l'image en amont non corrigée — Uptime Kuma écrit alors SQLite en mode WAL sur NFS, ce qui a provoqué des corruptions de base de données `SQLITE_CORRUPT` constatées. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et
Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Uptime Kuma
partagée avec la variante Cloud Run est décrite dans
**[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Uptime Kuma sur GKE Autopilot](../labs/UptimeKuma_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Uptime Kuma Common — Configuration applicative partagée](UptimeKuma_Common.md) — la configuration partagée par les deux cibles de déploiement.
