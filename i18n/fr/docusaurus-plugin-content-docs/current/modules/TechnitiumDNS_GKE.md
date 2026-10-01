---
title: "TechnitiumDNS sur GKE Autopilot"
description: "Référence de configuration pour déployer TechnitiumDNS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/TechnitiumDNS_GKE.md @ 3055034 sha256:87a29cf169a8 -->

# TechnitiumDNS sur GKE Autopilot {#technitiumdns-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_GKE.png" alt="TechnitiumDNS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Précision sur le périmètre :** ce module déploie **uniquement la console d'administration web et l'API REST** de Technitium
> (port 5380/HTTP). La fonction principale de résolveur DNS de Technitium (port 53/udp+tcp) **ne peut pas** être exposée
> via le modèle Gateway HTTP(S) standard de ce module — aucun LoadBalancer L4 UDP/TCP brut sur le port 53 n'est
> provisionné. Aucun client, où qu'il soit, ne peut interroger ce déploiement en tant que résolveur DNS. Consultez les §1 et §7 ci-dessous pour
> l'explication complète.

Technitium DNS Server est un serveur DNS faisant autorité et récursif, auto-hébergé, open source et multiplateforme
(.NET), doté d'une console d'administration web complète et d'une API REST pour gérer les zones, les enregistrements,
le blocage des publicités et des traqueurs par DNS, la redirection conditionnelle et le DNS-over-HTTPS/TLS. Ce module déploie
l'image officielle `technitium/dns-server` sur **GKE Autopilot**, sans modification, au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud qu'utilise TechnitiumDNS et sur la manière de les explorer et de les exploiter depuis la
console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

TechnitiumDNS s'exécute comme une unique charge de travail web préconstruite. Le déploiement assemble un ensemble volontairement restreint
de services Google Cloud — TechnitiumDNS n'a lui-même aucune dépendance à une base de données ou à un cache :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul Deployment, 500m vCPU / 512 MiB par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; zones, paramètres et journaux sont des fichiers plats locaux, aucun Cloud SQL provisionné |
| Persistance | Cloud Storage (GCS FUSE, par défaut) ou PVC bloc (StatefulSet) | Bucket de configuration monté sur `/etc/dns` ; passez à un PVC bloc StatefulSet pour un véritable périphérique bloc |
| Stockage d'objets | Cloud Storage | Un bucket « config » créé automatiquement (c'est aussi la couche de persistance ci-dessus) |
| Cache / file d'attente | **Aucun** | Pas de Redis ; TechnitiumDNS n'a besoin d'aucun cache externe |
| Secrets | Secret Manager | Un secret généré automatiquement : `DNS_SERVER_ADMIN_PASSWORD` |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe (console web uniquement) ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — TechnitiumDNS conserve les zones, les paramètres et
  les journaux sous forme de fichiers plats locaux sous `/etc/dns`. Les variables liées à la base de données existent par souci d'exhaustivité mais
  sont inertes.
- **Persistant par défaut via GCS FUSE.** `workload_type = "Deployment"` avec un volume monté depuis GCS sur
  `/etc/dns` — la configuration survit aux redémarrages des pods. Passez à un **PVC bloc StatefulSet**
  (`stateful_pvc_enabled = true` avec `stateful_pvc_mount_path = "/etc/dns"`) pour un véritable périphérique bloc
  offrant de meilleures garanties de verrouillage en écriture ; le module désactive alors automatiquement le volume GCS.
- **Un seul réplica par défaut** (`min_instance_count = 1`, `max_instance_count = 1`) — une console
  d'administration à faible trafic n'a pas besoin de mise à l'échelle horizontale.
- **Exposé via un Service LoadBalancer** (`service_type = "LoadBalancer"`) avec une IP **éphémère**
  (`reserve_static_ip = false`) par défaut, ce qui préserve le quota d'IP statiques du projet, souvent limité — la
  console n'intègre aucune URL auto-référencée dans sa configuration de démarrage.
- **Le point de terminaison de santé est `/`**, la page racine non authentifiée de la console, qui renvoie HTTP 200 avec
  le HTML complet de la console dès que le serveur s'est lié à son port.
- **La variante GKE s'exécute dans son propre espace de noms de tenant.** Donnez à `TechnitiumDNS_GKE` un
  `tenant_id` distinct (par ex. `"gke"`) s'il est déployé aux côtés de `TechnitiumDNS_CloudRun` sur le même
  tenant, afin d'éviter une collision de noms.
- **Un secret généré automatiquement.** `DNS_SERVER_ADMIN_PASSWORD` initialise le compte `admin` lors du
  tout premier démarrage uniquement ; les redémarrages ultérieurs l'ignorent.
- **Pas de résolveur DNS.** Consultez le §7 ci-dessous — c'est le point le plus important à comprendre avant de
  déployer ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont indiqués
dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail TechnitiumDNS {#a-gke-autopilot--the-technitiumdns-workload}

Les pods TechnitiumDNS sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés par les pods.
Par défaut, la charge de travail est un `Deployment` sans état avec un seul réplica ; passer à un `StatefulSet`
provisionne un PVC bloc par pod pour disposer d'un véritable périphérique bloc sur `/etc/dns`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail TechnitiumDNS pour voir les pods et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment ou StatefulSet)
sont gérés.

### B. Persistance — le bucket Cloud Storage de configuration (ou PVC bloc) {#b-persistence--the-config-cloud-storage-bucket-or-block-pvc}

TechnitiumDNS n'a **aucune instance Cloud SQL**. Toutes les zones, les paramètres, la base d'authentification et les journaux résident sous
`/etc/dns`. Par défaut, ce répertoire s'appuie sur un bucket Cloud Storage monté via GCS FUSE ; passez à un PVC bloc
StatefulSet pour un véritable périphérique bloc :

- **Console :** Cloud Storage → Buckets (volume GCS) ; Kubernetes Engine → Storage → PersistentVolumeClaims
  (PVC bloc).
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-config"
  kubectl get pvc -n "$NAMESPACE"                                # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /etc/dns           # config/zone location
  ```

Consultez [App_GKE](App_GKE.md) pour le pilote CSI GCS FUSE et les modèles de PVC StatefulSet.

### C. Secret Manager {#c-secret-manager}

TechnitiumDNS génère exactement un secret au moment du déploiement : le mot de passe administrateur initial.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe au moyen d'un Service
LoadBalancer — il s'agit de la **console web**, et non d'un point de terminaison DNS. Un domaine personnalisé avec un certificat
géré par Google peut être activé pour la console ; aucune IP statique n'est réservée par défaut (définissez
`reserve_static_ip = true` pour une adresse stable d'un redéploiement à l'autre).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE à Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application TechnitiumDNS {#3-technitiumdns-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** TechnitiumDNS n'a ni base de données externe ni étape de migration. Il
  lit et écrit des fichiers plats locaux sous `/etc/dns` dès son démarrage.
- **Initialisation de l'administrateur au premier démarrage.** `DNS_SERVER_ADMIN_PASSWORD` n'est appliqué que lorsque
  `/etc/dns/auth.config` n'existe pas encore. À chaque redémarrage ou redéploiement ultérieur, le fichier
  `auth.config` persisté prévaut.
- **`imagePullPolicy = Always` n'est PAS imposé pour ce module** — l'image est tirée à neuf (préconstruite,
  résolue par digest) plutôt qu'à partir d'un tag construit sur mesure ou mis en miroir ; le problème de cache obsolète d'App_GKE pour les images
  reconstruites ne s'applique donc pas ici de la même manière ; une montée de version exige toujours un nouveau `application_version`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui renvoie HTTP 200 avec le HTML complet de la console
  dès que le serveur s'est lié au port 5380. Vérifiez depuis l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code} %{size_download}\n' \
    http://<service-name>.$NAMESPACE.svc.cluster.local/
  ```
- **Connexion.** Accédez à l'IP externe ou au nom d'hôte dans un navigateur, connectez-vous en tant que `admin` avec le mot de passe
  stocké dans Secret Manager, puis modifiez-le immédiatement depuis la page de gestion des utilisateurs de la console (Technitium ne
  relit pas `DNS_SERVER_ADMIN_PASSWORD` après le premier démarrage).
- **API REST.** Toutes les actions de la console sont également disponibles via l'API REST, à l'aide d'un jeton de session obtenu
  via `/api/user/login`. Consultez la
  [documentation de l'API de Technitium](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **Aucune résolution DNS depuis ce déploiement.** Consultez le §7 ci-dessous.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à
TechnitiumDNS ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; utilisez une valeur distincte (par ex. `"gke"`) aux côtés de la variante CloudRun sur le même tenant. |
| `application_name` | `technitiumdns` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image TechnitiumDNS (par ex. `latest`, `13.5.1`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle telle quelle ; `custom` est accepté pour la compatibilité future. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (GKE n'offre pas de mise à zéro pour les Deployments). |
| `max_instance_count` | `1` | Nombre maximal de réplicas. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | CPU et mémoire par pod. |
| `container_port` | `5380` | Port par défaut de la console web. |
| `workload_type` | `Deployment` | Valeur par défaut sans état ; `StatefulSet` pour un PVC bloc durable par pod. |
| `enable_cloudsql_volume` | `false` | Désactivé — TechnitiumDNS n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Met en miroir l'image TechnitiumDNS dans Artifact Registry. |

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google. **Fortement recommandé** — nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `DNS_SERVER_*` supplémentaires (par ex. `DNS_SERVER_FORWARDERS`, `DNS_SERVER_DOMAIN`). |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager (secrets supplémentaires ; `DNS_SERVER_ADMIN_PASSWORD` est déjà câblé). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `None` | Un seul réplica par défaut ; aucune affinité nécessaire. |

### Groupe 7 — StatefulSet (stockage durable de la configuration) {#group-7--statefulset-durable-config-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC bloc par pod sur `/etc/dns` au lieu du volume GCS FUSE. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/etc/dns` | Chemin de montage du PVC bloc. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass du PVC. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/` | Sonde de démarrage ciblant la page racine publique de la console. |
| `health_check_config` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Inutile par défaut — le volume GCS sur `/etc/dns` persiste déjà l'état. |
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires ; le bucket de configuration sur `/etc/dns` est ajouté automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de configuration créé automatiquement. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | TechnitiumDNS n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `technitiumdns` | Inertes — aucune base de données n'est provisionnée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — TechnitiumDNS ne dépend pas de Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `false` | IP éphémère par défaut pour préserver le quota d'IP statiques ; définissez `true` pour une adresse de production stable. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `service_url` | URL d'accès à la console web (pas un point de terminaison DNS). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs du point de terminaison de base de données — inutilisés avec `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de configuration). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des éventuels jobs de configuration et d'import (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle
> [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP
> sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`,
> `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. Le propre
> `validation.tf` de la variante GKE applique ces garde-fous. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à ce que ce soit un résolveur DNS | Ne faites pas pointer les paramètres DNS des clients vers ce déploiement | **Critique** | Le port 53/udp+tcp n'est jamais exposé par le modèle Gateway HTTP(S) de ce module — les requêtes DNS vers ce déploiement échouent tout simplement ; seules la console web et l'API sont joignables. |
| `enable_iap` | `true` pour tout usage au-delà d'un test rapide | Critique | Sans IAP, la console n'est protégée que par son propre mot de passe administrateur, sur l'internet public. |
| Rotation de `DNS_SERVER_ADMIN_PASSWORD` | Modifiez le mot de passe depuis la console après la première connexion | Élevé | Technitium ne relit jamais la variable d'environnement après le premier démarrage — faire tourner uniquement la valeur dans Secret Manager ne change PAS le mot de passe effectif de la console. |
| `stateful_pvc_mount_path` | `/etc/dns` | Élevé | Monter le PVC ailleurs que sur `/etc/dns` laisse le véritable chemin de configuration non persisté. |
| `enable_cloudsql_volume` | `false` | Élevé | Définir `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à joindre — rejeté par le garde-fou au moment du plan. |
| Identifiants de `enable_iap` | Définissez `iap_oauth_client_id` et `_secret` ensemble | Élevé | Activer IAP sans ces deux valeurs est rejeté au moment du plan par le garde-fou de validation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `reserve_static_ip` | `true` en production | Moyen | Une IP éphémère peut changer lors de la recréation du Service, ce qui casse toute URL de console mise en favori ou codée en dur. |
| `application_version` | Épinglez une version explicite en production | Faible | `latest` suit les versions amont ; épinglez explicitement pour maîtriser le calendrier des mises à niveau. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling, ingress et
certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à TechnitiumDNS, partagée avec la variante Cloud Run,
est décrite dans **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : TechnitiumDNS sur GKE Autopilot](../labs/TechnitiumDNS_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [TechnitiumDNS sur Google Cloud Run](TechnitiumDNS_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [TechnitiumDNS Common — Configuration applicative partagée](TechnitiumDNS_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md) et [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Zero-trust Network & DNS**.
