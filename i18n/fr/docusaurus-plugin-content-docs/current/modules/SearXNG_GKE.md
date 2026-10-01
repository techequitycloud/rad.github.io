---
title: "SearXNG sur GKE Autopilot"
description: "Référence de configuration pour déployer SearXNG sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SearXNG_GKE.md @ 3055034 sha256:ea047322fd52 -->

# SearXNG sur GKE Autopilot {#searxng-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_GKE.png" alt="SearXNG sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG est un métamoteur de recherche auto-hébergé et respectueux de la vie privée, qui
agrège les résultats de plus de 70 services de recherche sans pister les utilisateurs ni
afficher de publicités. Ce module déploie SearXNG sur **GKE Autopilot** en s'appuyant sur
le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par SearXNG et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée,
mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

SearXNG s'exécute sous forme de charge de travail web Python/Flask légère. Le
déploiement assemble un ensemble minimal de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python/Flask, 500m de CPU / 512 MiB par défaut, mise à l'échelle automatique horizontale |
| Cache / limitation de débit | Redis | Facultatif — désactivé par défaut ; stocke les compteurs du limiteur. La limitation de débit nécessite aussi `enable_limiter = true` |
| Secrets | Secret Manager | `SEARXNG_SECRET` (clé de session) généré automatiquement et injecté via le pilote CSI |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** SearXNG est entièrement sans état — il
  agrège les résultats de recherche au moment de la requête et ne stocke rien.
- **Ni NFS ni Cloud Storage ne sont provisionnés.** SearXNG n'a ni téléversements ni
  fichiers partagés.
- **`min_instance_count` est fixé à 1.** GKE ne prend pas en charge la mise à l'échelle à
  zéro ; le module maintient toujours au moins un pod en cours d'exécution.
- **Le limiteur est désactivé par défaut, et Redis seul ne l'active pas.** L'image RAD
  fixe `server.limiter: false` afin que l'API JSON reste utilisable par des appelants
  internes de serveur à serveur. Pour un déploiement invocable publiquement, définissez À
  LA FOIS `enable_redis = true` et `enable_limiter = true`, et exemptez les appelants de
  confiance via `limiter_pass_ips`, pour bénéficier de la limitation de débit et de la
  détection des bots contre les abus des moteurs en amont.
- **`SEARXNG_SECRET` est généré automatiquement** et stocké dans Secret Manager. Tous les
  réplicas de pods partagent la même valeur via le pilote CSI — ne la remplacez pas par
  une valeur aléatoire propre à chaque pod.
- **Les sondes de santé ciblent `/healthz`.** Le point de terminaison de santé intégré de
  SearXNG renvoie 200 lorsque l'application est prête.
- **`session_affinity = "None"`.** SearXNG est sans état ; les requêtes sont donc
  réparties uniformément entre les pods.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail SearXNG {#a-gke-autopilot--the-searxng-workload}

Les pods SearXNG sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le minimum (fixé à 1) et le maximum configuré.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail SearXNG
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cache Redis (facultatif) {#b-redis-cache-optional}

`enable_redis = true` provisionne le backend Redis dans lequel le limiteur conserve ses
compteurs par adresse IP ; c'est `enable_limiter = true` qui active réellement la
détection des bots (le plan échoue si vous l'activez sans Redis), et `limiter_pass_ips`
exempte les appelants internes de confiance. Remarque historique : Redis seul était
autrefois présenté comme suffisant — il ne l'a jamais été, car l'image RAD fixait
`server.limiter: false`.

Lorsque `enable_redis = true`, SearXNG utilise Redis pour la limitation de débit par
adresse IP et la détection des bots. C'est fortement recommandé pour les déploiements
exposés au public, afin d'éviter l'épuisement des quotas d'API des moteurs de recherche
en amont. Lorsque `redis_host` est laissé vide et que Redis est activé, le module utilise
`127.0.0.1` par défaut (un pod Redis en sidecar).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping        # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET {#c-secret-manager--searxng_secret}

`SearXNG_Common` génère automatiquement la clé de session `SEARXNG_SECRET` et la stocke
dans Secret Manager. Cette clé signe les cookies de session et les paramètres de requête
HMAC de SearXNG ; tous les réplicas de pods doivent partager la même valeur. Elle est
injectée dans les pods à l'exécution via le pilote Kubernetes Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP Cloud Load Balancing
externe. Un domaine personnalisé avec un certificat géré par Google peut être activé, et
une adresse IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN
et les adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application SearXNG {#3-searxng-application-behaviour}

- **Entièrement sans état.** SearXNG récupère les résultats auprès de moteurs de
  recherche externes au moment de la requête et ne stocke rien localement. Aucune
  migration de base de données ni job d'initialisation ne s'exécute.
- **Aucun job de configuration au premier déploiement.** Comme il n'y a pas de base
  de données, le déploiement se termine sans étape db-init — le pod est prêt dès que le
  conteneur démarre.
- **`SEARXNG_SECRET` est stable.** La clé de session est générée une seule fois et
  persiste dans Secret Manager lors des redémarrages et des mises à jour progressives. Sa
  rotation invalide toutes les sessions utilisateur actives ; évitez-la en production
  sauf si la sécurité l'exige.
- **`SEARXNG_BIND_ADDRESS` est injecté automatiquement** avec la valeur `0.0.0.0:8080`,
  afin que SearXNG écoute sur toutes les interfaces, sur son port natif.
- **`ENABLE_REDIS` est injecté automatiquement** ; **`REDIS_URL` ne l'est que lorsque
  `enable_redis = true`** (il est entièrement omis dans le cas contraire, afin qu'un
  client ne puisse pas prendre une valeur vide pour un point de terminaison réel). L'URL
  est dérivée de `redis_host`, `redis_port` et, s'il est défini, `redis_auth` — une
  instance Memorystore avec AUTH activé rejette une URL sans mot de passe.
- **`SEARXNG_LIMITER` et `SEARXNG_LIMITER_PASS_IPS` sont injectés automatiquement** à
  partir de `enable_limiter` et `limiter_pass_ips` ; le point d'entrée les substitue dans
  `server.limiter` et écrit `/etc/searxng/limiter.toml`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/healthz` (HTTP GET), auquel SearXNG répond une fois l'application entièrement
  initialisée.
- **Démarrages rapides.** SearXNG démarre en moins de 5 secondes — sans connexion à une
  base de données ni migration de schéma. La sonde de démarrage utilise un délai initial
  court de 10 secondes.
- **L'affinité de session vaut `None`.** Comme l'état de session est stocké dans le
  cookie signé avec `SEARXNG_SECRET` (et éventuellement dans Redis), aucun routage
  persistant n'est nécessaire.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à SearXNG ou notables pour lui sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et
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
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `searxng` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `SearXNG Search` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `latest` | Tag de l'image SearXNG ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_resources` | `{ cpu_limit="500m", memory_limit="512Mi" }` | Limites de CPU et de mémoire par pod. SearXNG est léger ; 500m / 512 MiB suffisent pour un trafic modéré. |
| `min_instance_count` | `1` _(fixé en interne)_ | Nombre minimal de réplicas. Fixé à 1 — GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `3` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `8080` | Port HTTP natif de SearXNG. |
| `container_image_source` | `prebuilt` | Utilise l'image officielle de SearXNG (`prebuilt`) ou la construit à partir des sources (`custom`). |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry avant le déploiement. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |
| `enable_cloudsql_volume` | `false` | **Laissez false** — SearXNG n'utilise pas de base de données. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="" }` | Paramètres supplémentaires. `SEARXNG_BIND_ADDRESS`, `ENABLE_REDIS` et `REDIS_URL` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager pour des secrets supplémentaires (par exemple les clés d'API des moteurs en amont). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `None` | SearXNG est sans état ; une répartition uniforme est préférable. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` (SearXNG est sans état — laissez null). |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

SearXNG est sans état — laissez toutes les variables `stateful_pvc_*` à leurs valeurs par
défaut (`null`). Consultez [App_GKE](App_GKE.md) pour savoir quand ce groupe s'applique.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones pour les déploiements de production. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Point de terminaison de santé intégré de SearXNG ; la sonde de démarrage prévoit un délai initial de 10s. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG ne nécessite aucun job d'initialisation — laissez vide. |
| `cron_jobs` | `[]` | Tâches planifiées facultatives (par exemple le préchauffage du cache). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | SearXNG est sans état — NFS n'est pas requis. Laissez false. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG est sans état — aucun bucket GCS n'est requis. Laissez false. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Provisionne le backend Redis dont le limiteur a besoin. N'active PAS la limitation de débit à lui seul. |
| `enable_limiter` | `false` | Active le limiteur de détection des bots. Nécessite `enable_redis`. À définir à true sur toute instance invocable publiquement. |
| `limiter_pass_ips` | `[]` | Plages CIDR sources exemptées de la détection des bots, pour des appelants internes de confiance tels que n8n. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser `127.0.0.1` par défaut lorsque Redis est activé ; définissez l'adresse IP Memorystore pour une instance gérée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Imposé — SearXNG n'utilise pas de base de données. Ne le modifiez pas. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

SearXNG est sans état — il n'y a aucune donnée applicative à sauvegarder. Les variables
de sauvegarde sont héritées de l'interface du socle mais n'ont aucune utilité pratique.
Consultez [App_GKE](App_GKE.md).

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Sans objet pour SearXNG (pas de base de données). Consultez
[App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une entrée pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant SearXNG (déploiements internes). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'entrée. Recommandé pour les déploiements exposés au public. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à SearXNG. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour SearXNG). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails de la connexion GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SEARXNG_SECRET` (généré automatiquement) | généré automatiquement | Critique | Si un secret personnalisé propre à chaque pod est injecté à la place, chaque pod signe les cookies avec une clé différente, ce qui invalide les sessions d'un réplica à l'autre. Utilisez toujours la valeur générée automatiquement dans Secret Manager. |
| `database_type` | `NONE` | Critique | Passer à un véritable type de base de données provisionne une instance Cloud SQL inutilisée et casse le démarrage. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont interprétés comme des octets par Kubernetes et bloquent toute planification des pods. |
| `enable_redis` | `true` pour les déploiements publics | Élevé | Stocke les compteurs du limiteur. Nécessaire mais PAS suffisant — associez-le à `enable_limiter = true`. |
| `enable_limiter` | `true` pour les déploiements publics | Élevé | Sans lui, le limiteur reste désactivé quelle que soit la configuration de Redis, et une instance invocable publiquement est exposée à un moissonnage qui épuise les quotas des moteurs en amont. |
| `redis_host` | Adresse IP Memorystore ou valeur explicite | Élevé | Lorsque `enable_redis = true` et `redis_host = ""`, le module utilise `127.0.0.1` par défaut — il n'y a pas de sidecar Redis dans la configuration GKE par défaut, donc la limitation de débit est désactivée sans aucun message. |
| `vpc_egress_setting` (via le socle) | garantir l'accès sortant à internet | Élevé | SearXNG récupère les résultats auprès de moteurs externes ; l'accès sortant à internet ne doit pas être bloqué. |
| `application_version` | épinglée (pas `latest`) | Moyen | Utiliser `latest` rend les déploiements non reproductibles ; une nouvelle version de SearXNG peut modifier le schéma de configuration. |
| `enable_cloud_armor` | `true` pour les déploiements publics | Moyen | Sans Cloud Armor, le point de terminaison public n'a aucune protection WAF/DDoS. |
| `enable_iap` | `true` pour un usage strictement interne | Moyen | Pour les déploiements de recherche internes, IAP restreint l'accès aux comptes Google authentifiés. |
| `pdb_min_available` vs `min_instance_count` | garder une marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être évincé). |
| `stateful_pvc_enabled` | `null` | Faible | SearXNG est sans état — provisionner un PVC engendre un coût inutile et il reste inutilisé. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à SearXNG partagée avec la
variante Cloud Run est décrite dans **[SearXNG_Common](SearXNG_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SearXNG sur GKE Autopilot](../labs/SearXNG_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [SearXNG sur Google Cloud Run](SearXNG_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [SearXNG Common — Configuration applicative partagée](SearXNG_Common.md) — la configuration partagée par les deux cibles de déploiement.
