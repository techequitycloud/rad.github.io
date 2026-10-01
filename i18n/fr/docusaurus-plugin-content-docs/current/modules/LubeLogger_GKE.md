---
title: "LubeLogger sur GKE Autopilot"
description: "Référence de configuration pour déployer LubeLogger sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LubeLogger_GKE.md @ 3055034 sha256:4a8631d10011 -->

# LubeLogger sur GKE Autopilot {#lubelogger-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_GKE.png" alt="LubeLogger sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger est un outil gratuit et open source de suivi de l'entretien des véhicules
et de la consommation de carburant, construit sur ASP.NET Core (.NET) et livré sous
la forme d'une image de conteneur unique avec une base de données LiteDB intégrée.
Ce module déploie LubeLogger sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise LubeLogger et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LubeLogger s'exécute sous la forme d'un unique pod ASP.NET Core, idéalement en tant
que **StatefulSet doté d'un véritable PVC de stockage bloc**. Le déploiement assemble
un ensemble minimal de services Google Cloud — la configuration par défaut ne
comporte aucune base de données gérée :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod ASP.NET Core, 1 vCPU / 1 GiB par défaut, fixé à un seul réplica |
| Base de données | Aucune (par défaut) | Le mode par défaut de LubeLogger utilise un fichier de base de données LiteDB intégré — aucune instance Cloud SQL n'est créée |
| Stockage objet / stockage bloc | Cloud Storage + Persistent Disk | Un PVC bloc (recommandé, `stateful_pvc_enabled = true`) sur `/App/data`, plus un petit bucket GCS `dpkeys` pour les clés ASP.NET Core Data Protection (toujours adossé à GCS) |
| Cache et file d'attente | Aucun | LubeLogger n'utilise pas Redis et n'a ni worker en arrière-plan ni file d'attente |
| Secrets | Aucun | Aucun secret n'est généré — le premier compte est créé par inscription en libre-service |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données externe par défaut.** `database_type = "NONE"` — le
  fichier de base de données LiteDB intégré de LubeLogger fait foi. LubeLogger prend
  aussi en charge un backend Postgres externe facultatif via une unique variable
  d'environnement DSN `POSTGRES_CONNECTION`, mais ce module ne câble pas Cloud SQL
  pour cela.
- **Le PVC de stockage bloc est la disposition recommandée.**
  `stateful_pvc_enabled = true` (par défaut) exécute LubeLogger en tant que
  StatefulSet avec un PVC par pod monté sur `/App/data` — un véritable périphérique
  bloc garantit un verrouillage de fichiers fiable pour la base de données LiteDB
  intégrée, contrairement à GCS FUSE.
- **Une seule instance.** `min_instance_count = 1` et `max_instance_count = 1` — le
  mode par défaut de LubeLogger sert un unique fichier de base de données partagé
  depuis un seul volume ; exécuter plusieurs réplicas sur le même fichier le
  corrompt.
- **S'exécute en root ; aucun fsGroup nécessaire.** Vérifié directement sur l'image
  en cours d'exécution — l'image officielle de LubeLogger ne comporte aucune
  directive `USER`, si bien que `stateful_fs_group` vaut `0` par défaut (non
  défini).
- **Sécurisé par défaut.** `EnableAuth = "true"` remplace la valeur par défaut de
  `appsettings.json` de LubeLogger, qui laisse l'accès entièrement ouvert. Aucun
  compte administrateur n'est pré-créé — la première personne qui remplit le
  formulaire d'inscription sur `/Login` obtient l'accès.
- **Image préconstruite, sans étape de build.** Le module déploie directement
  l'image officielle `ghcr.io/hargata/lubelogger` (mise en miroir dans Artifact
  Registry par défaut) — aucun Dockerfile ni Cloud Build n'intervient.
- **Accessible de l'extérieur par défaut.** `service_type = "LoadBalancer"` —
  LubeLogger est une application web exposée au public, et non une charge de
  travail purement interne.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LubeLogger {#a-gke-autopilot--the-lubelogger-workload}

LubeLogger s'exécute sous la forme d'un unique pod (StatefulSet par défaut),
qu'Autopilot facture en fonction du CPU et de la mémoire demandés.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  LubeLogger pour voir le pod, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Stockage persistant — PVC bloc et Cloud Storage {#b-persistent-storage--block-pvc-and-cloud-storage}

La disposition par défaut (`stateful_pvc_enabled = true`) provisionne par pod un
**PVC adossé à Persistent Disk** monté sur `/App/data` — il contient le fichier de
base de données LiteDB intégré et les photos/reçus/documents téléversés. Un petit
bucket **Cloud Storage** distinct (`dpkeys`) est toujours monté via GCS FUSE sur le
chemin fixe `/root/.aspnet/DataProtection-Keys`, indépendamment du PVC.

- **Console :** Kubernetes Engine → Storage (PVC) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
  ```

Voir [App_GKE](App_GKE.md) pour les options de StorageClass, de CMEK et de montage
GCS Fuse.

### C. Réseau et ingress {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur les IP statiques.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties stdout/stderr du pod sont acheminées vers Cloud Logging ; les métriques
GKE vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte sont
disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LubeLogger {#3-lubelogger-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Il n'y a pas
  de job `db-init` — LubeLogger initialise lui-même son fichier de base de données
  LiteDB et son arborescence (`config/`,
  `documents/`, `images/`, `temp/`, `themes/`, `translations/` sous `/App/data`) au
  premier démarrage.
- **Aucun identifiant administrateur fixe.** Ouvrez le service, allez sur `/Login`
  et soumettez le formulaire **Register** (inscription) — il devient le compte
  utilisable. Faites-le immédiatement après le premier déploiement :
  `EnableAuth = "true"` restreint le reste de l'application, mais l'inscription
  elle-même reste ouverte à quiconque peut atteindre l'URL tant qu'aucun premier
  compte n'existe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/Login` — la
  page publique et non authentifiée de LubeLogger. La racine de l'application `/`
  est protégée par `[Authorize]` et ferait échouer une sonde non authentifiée, même
  sur un conteneur en bonne santé.
- **Postgres externe facultatif.** LubeLogger prend en charge une unique variable
  d'environnement DSN `POSTGRES_CONNECTION`
  (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`)
  pour utiliser une base de données Postgres externe à la place du fichier LiteDB
  intégré. Ce module ne provisionne pas Cloud SQL pour cette option.
- **Une seule instance, toujours.** `max_instance_count` est fixé à `1` — le mode
  par défaut de LubeLogger ne prend en charge ni le verrouillage distribué ni
  l'écriture multiple pour sa base de données intégrée.
- **S'exécute en root.** Vérifié via `docker inspect`/`docker exec` sur l'image
  réelle — aucune directive `USER`, le processus s'exécute avec l'uid 0. Cela
  compte si vous ajoutez un jour un `securityContext` restreint — la configuration
  par défaut n'en requiert aucun.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à LubeLogger ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Labels appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lubelogger` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag d'image sur `ghcr.io/hargata/lubelogger`. Comme l'image est préconstruite (et non construite sur mesure), cette valeur sélectionne directement la version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Maintenu à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`** — le mode par défaut de LubeLogger sert un unique fichier de base de données partagé. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `1Gi` | Mémoire par pod. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Le mode par défaut de LubeLogger n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image LubeLogger dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés avec la valeur par défaut du module `EnableAuth = "true"`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. Utilisez-la pour `POSTGRES_CONNECTION` si vous câblez le backend Postgres externe facultatif. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LubeLogger est une application web exposée au public ; l'accès externe est donc la valeur par défaut. |
| `workload_type` | `null` (auto → `StatefulSet`) | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Aucun routage persistant n'est nécessaire — un seul réplica. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds et des pods ; pertinents uniquement si `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes d'attente après SIGTERM avant SIGKILL (laisse LubeLogger vider ses écritures). |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Recommandé pour LubeLogger — un véritable PVC bloc garantit un verrouillage de fichiers fiable pour la base de données LiteDB intégrée. |
| `stateful_pvc_size` | `20Gi` | Taille de stockage du PVC par pod — dimensionnée pour la base de données LiteDB, les documents et reçus téléversés, et la marge. |
| `stateful_pvc_mount_path` | `/App/data` | Chemin de montage du PVC dans le conteneur — doit correspondre au répertoire de données de LubeLogger. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC ; utilisez `premium-rwo` pour davantage d'IOPS. |
| `stateful_headless_service` | `null` | Crée un Service headless pour des noms DNS de pod stables. |
| `stateful_pod_management_policy` | `null` | Ordre de création des pods : `OrderedReady` ou `Parallel`. |
| `stateful_update_strategy` | `null` | Stratégie de mise à jour : `RollingUpdate` ou `OnDelete`. |
| `stateful_fs_group` | `0` | Laissé non défini — l'image officielle de LubeLogger s'exécute en root et n'a besoin d'aucun fsGroup pour écrire sur le PVC. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota Kubernetes dans le namespace de l'application. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Exige un suffixe binaire (par ex. `4Gi`, `8192Mi`) par convention lorsqu'il est défini. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/Login`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/Login` | Sonde d'infrastructure au niveau d'App_GKE. |
| `health_check_config` | HTTP `/Login` | Sonde de vivacité au niveau d'App_GKE. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Le mode par défaut de LubeLogger n'a besoin d'aucun job d'initialisation. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de LubeLogger. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS `storage` et `dpkeys`. |
| `storage_buckets` | `[]` | Buckets supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires via le pilote CSI. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes à conserver dans Artifact Registry. |
| `delete_untagged_images` | `true` | Supprime automatiquement les images sans tag. |
| `image_retention_days` | `30` | Nombre de jours après lequel les images deviennent éligibles à la suppression. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` (valeur par défaut de la fondation) | Transmise pour compatibilité ; `LubeLogger_GKE` la force à `false` — LubeLogger n'a pas besoin de Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le mode par défaut de LubeLogger n'a pas de base de données Cloud SQL. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre LubeLogger. |
| `storage_buckets` | Buckets Cloud Storage créés (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `statefulset_name` | Nom du StatefulSet. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Le mode par défaut de LubeLogger sert un unique fichier de base de données intégré et partagé depuis un seul volume ; plus d'un réplica expose à une corruption de la base par des écritures concurrentes. Imposé par une garde de validation au moment du plan. |
| `stateful_pvc_enabled` | `true` | High | Un véritable PVC bloc garantit un verrouillage de fichiers fiable ; revenir à GCS FUSE pour `/App/data` (en passant ce paramètre à `false`) expose à une contention sur les verrous en cas d'écritures concurrentes. |
| `stateful_pvc_mount_path` | `/App/data` | Critical | Doit correspondre au répertoire de données réel de LubeLogger — un mauvais chemin signifie que la base de données et les fichiers téléversés sont écrits dans le stockage éphémère du pod et perdus à chaque redémarrage. |
| Buckets `storage`/`dpkeys`, ou le PVC | Ne jamais les supprimer | Critical | Perdre `/App/data` (PVC ou bucket `storage`) fait perdre tous les dossiers de véhicules ; perdre `dpkeys` invalide toutes les sessions de connexion existantes (récupérable — impose seulement une nouvelle connexion). |
| `EnableAuth` | `true` (par défaut) | Critical | Le passer à `false` rétablit le mode d'accès entièrement ouvert de LubeLogger — toute personne disposant de l'URL peut consulter et modifier toutes les données sans aucune connexion. |
| Inscription au premier lancement | À effectuer immédiatement après le déploiement | High | Tant qu'aucun premier compte n'est inscrit, le formulaire d'inscription est accessible à quiconque peut atteindre l'URL. |
| Chemin de `startup_probe`/`liveness_probe` | `/Login` | Critical | Pointer les sondes sur `/` (ou sur tout chemin protégé par `[Authorize]`) fait échouer la sonde sur un pod par ailleurs en bonne santé — il ne devient jamais Ready. |
| `workload_type` | laisser `null` (auto) | High | Définir `workload_type = "Deployment"` avec `stateful_pvc_enabled = true` échoue au moment du plan — un modèle de PVC exige un StatefulSet. |
| `database_type` | `NONE` (par défaut) | High | Le mode par défaut de LubeLogger ignore entièrement ce paramètre ; le modifier ne connecte pas LubeLogger à une instance Cloud SQL — utilisez plutôt `POSTGRES_CONNECTION` pour l'option Postgres externe facultative. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent la planification de tous les pods du namespace. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer le pod pendant la maintenance sans aucune protection. |
| `service_type` | `LoadBalancer` (par défaut) | Medium | La valeur `ClusterIP` rend l'interface web publique injoignable depuis l'extérieur du cluster. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à LubeLogger,
partagée avec la variante Cloud Run, est décrite dans
**[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LubeLogger sur GKE Autopilot](../labs/LubeLogger_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LubeLogger sur Google Cloud Run](LubeLogger_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [LubeLogger Common — Configuration applicative partagée](LubeLogger_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) dans la solution **Home & Life Management**.
