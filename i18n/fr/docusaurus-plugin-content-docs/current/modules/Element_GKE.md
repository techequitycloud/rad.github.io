---
title: "Element sur GKE Autopilot"
description: "Référence de configuration pour déployer Element sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Element_GKE.md @ 3055034 sha256:3a40dd8f7847 -->

# Element sur GKE Autopilot {#element-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Element_GKE.png" alt="Element sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Element est le principal client web open source (AGPLv3) pour
[Matrix](https://matrix.org/) — une application de messagerie et de collaboration
auto-hébergée, chiffrée de bout en bout. Ce module déploie Element sur **GKE Autopilot**
en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Element est une **application monopage (SPA) statique servie par nginx** : le navigateur
communique directement avec un serveur d'accueil (homeserver) Matrix (tel que Synapse ou
Dendrite) via HTTPS, de sorte que le pod lui-même ne conserve aucun état côté serveur —
ni base de données, ni Redis, ni volume persistant, ni secrets.

Ce guide se concentre sur les services cloud utilisés par Element et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, entrée,
mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Element s'exécute comme une charge de travail web nginx sans état. Le déploiement
assemble un ensemble volontairement réduit de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods SPA statique nginx, 500m vCPU / 512 MiB par défaut, mise à l'échelle automatique horizontale |
| Build du conteneur | Cloud Build + Artifact Registry | Image personnalisée légère `FROM vectorim/element-web` avec un point d'entrée générant `config.json` à l'exécution |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé + certificat géré en option |
| Secrets | — | **Aucun.** Element ne nécessite aucun secret |
| Base de données | — | **Aucune.** C'est le serveur d'accueil Matrix qui conserve tout l'état, pas Element |
| Stockage d'objets | — | **Aucun.** Element est sans état (ni PVC, ni bucket, ni NFS) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Element est sans état.** L'ensemble de l'état des conversations, des clés de
  chiffrement et des médias réside sur le serveur d'accueil Matrix et dans le navigateur
  de l'utilisateur. Element lui-même ne stocke rien côté serveur ; la charge de travail
  est donc un simple `Deployment`, sans base de données, Redis, PVC, bucket GCS ni
  secret Secret Manager.
- **Le serveur d'accueil relève de la configuration d'exécution.** `homeserver_url` /
  `homeserver_name` sont écrits dans `/app/config.json` par le point d'entrée du
  conteneur à chaque démarrage, de sorte qu'une même image peut pointer vers n'importe
  quel serveur d'accueil sans nouveau build. Les laisser vides revient par défaut au
  serveur public `matrix.org`.
- **Build personnalisé avec version épinglée.** `container_image_source = "custom"`
  construit une image légère au-dessus de `vectorim/element-web`.
  `application_version = "latest"` se résout vers le tag éprouvé épinglé `v1.11.86` via
  un ARG de build propre à l'application, `ELEMENT_VERSION`. `App_GKE` définit
  `imagePullPolicy=Always` pour le tag personnalisé réutilisé, afin que les nouveaux
  builds soient effectivement téléchargés.
- **Au moins 1 réplica est maintenu** (GKE ne descend pas à zéro), de sorte que
  l'interface du client est toujours accessible. Aucune affinité de session n'est
  nécessaire, car Element est sans état.
- **Port 80.** nginx sert la SPA sur le port 80 ; les sondes ciblent `/`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Element {#a-gke-autopilot--the-element-workload}

Les pods Element sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods (Horizontal Pod
Autoscaling) dimensionne le déploiement entre le nombre minimal et le nombre maximal de
réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Element pour voir les pods et les événements. Kubernetes Engine → Services & Ingress
  affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Image de conteneur — Cloud Build et Artifact Registry {#b-container-image--cloud-build--artifact-registry}

L'image Element est construite par Cloud Build à partir d'un Dockerfile léger qui ajoute
un point d'entrée générant `config.json` au-dessus de `vectorim/element-web`, puis
poussée vers Artifact Registry. `application_version = "latest"` construit la version
épinglée `v1.11.86`.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le pipeline de build, la mise en miroir des images
et le comportement `imagePullPolicy=Always` pour les tags personnalisés réutilisés.

### C. Réseau et entrée {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique est réservée par défaut afin que l'adresse
soit conservée d'un redéploiement à l'autre.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### D. Identity-Aware Proxy (facultatif) {#d-identity-aware-proxy-optional}

Element est livré ouvert par défaut afin que les utilisateurs puissent se connecter
auprès du serveur d'accueil. Pour restreindre à vos identités Google le simple
chargement de l'interface du client, activez IAP
(`enable_iap = true`) avec un client OAuth.

- **Console :** Security → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le câblage IAP + BackendConfig.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les flux stdout/stderr du pod (journaux d'accès/d'erreurs nginx) sont envoyés vers Cloud
Logging ; les métriques GKE sont envoyées vers Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Element {#3-element-application-behaviour}

- **Génération de la configuration à l'exécution.** Le point d'entrée du conteneur écrit
  `/app/config.json` à chaque démarrage à partir de `HOMESERVER_URL` /
  `HOMESERVER_NAME`, puis passe la main à nginx. Changer de serveur d'accueil revient à
  redéployer avec de nouvelles valeurs d'environnement — sans reconstruire l'image.
- **Ni base de données, ni migrations, ni job d'initialisation.** Element sert des
  assets statiques ; le pod est prêt (Ready) dès que nginx écoute sur le port 80.
- **La connexion est un échange entre le navigateur et le serveur d'accueil.** Element
  authentifie l'utilisateur directement auprès du serveur d'accueil Matrix configuré ;
  il n'y a aucune session côté serveur dans le pod et rien à pré-remplir dans Secret
  Manager.
- **Vérifiez le serveur d'accueil injecté.** Confirmez que l'environnement du pod en
  cours d'exécution correspond au serveur d'accueil voulu, et que le LoadBalancer
  répond :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep HOMESERVER
  kubectl get svc -n "$NAMESPACE" <service-name> -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Ensuite, `curl -s http://<external-ip>/config.json` doit renvoyer le JSON contenant
  votre `base_url`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, auquel nginx
  répond immédiatement et sans authentification.
- **Mise à niveau d'Element.** Augmentez `application_version` (ou épinglez un tag
  `element-web` plus récent) et redéployez ; une nouvelle image est construite et, comme
  `imagePullPolicy=Always` est défini pour le tag personnalisé réutilisé, le déploiement
  télécharge les nouvelles couches.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Element ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `element` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Element ; `latest` construit la version épinglée `v1.11.86`. Épinglez un tag `element-web` précis en production. |
| `homeserver_url` | `""` | URL de base du serveur d'accueil Matrix écrite dans `config.json`. Vide → `matrix.org`. |
| `homeserver_name` | `""` | Nom du serveur Matrix (identité de délégation) annoncé par Element. Vide → `matrix.org`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image Element légère via Cloud Build. |
| `container_image` | `""` | Remplacez-la par l'URI d'une image préconstruite ou mise en miroir. |
| `enable_image_mirroring` | `true` | Met l'image en miroir dans Artifact Registry avant le déploiement. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne descend pas à zéro. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. |
| `container_port` | `80` | nginx écoute sur le port 80. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | Limites de CPU et de mémoire — Element est léger. |
| `enable_cloudsql_volume` | `false` | Aucune base de données — le sidecar Auth Proxy n'est pas déployé. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires fusionnés avec les valeurs injectées `HOMESERVER_URL` / `HOMESERVER_NAME`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Element n'en a besoin d'aucune. |
| `secret_rotation_period` / `secret_propagation_delay` | _(défini)_ | Notification de rotation / délai de propagation. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Element est sans état ; le socle résout automatiquement cette valeur en Deployment. |
| `session_affinity` | `None` | Aucun routage persistant nécessaire — Element ne conserve aucune session côté serveur. |
| `namespace_name` | `""` | Espace de noms de la charge de travail ; vide signifie qu'il est dérivé automatiquement du nom du service. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Hérité et **non utilisé par Element** (Deployment sans état). `stateful_pvc_enabled`
(valeur par défaut `null`), `stateful_pvc_size`, `stateful_pvc_mount_path`,
`stateful_pvc_storage_class`, `stateful_headless_service`,
`stateful_pod_management_policy`, `stateful_update_strategy`, `stateful_fs_group`.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Impose un ResourceQuota sur l'espace de noms. |
| `quota_cpu_requests` / `quota_cpu_limits` | _(défini)_ | Quota CPU de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | _(défini)_ | Quota mémoire de l'espace de noms. **Doivent utiliser des unités binaires** (`4Gi`, `8192Mi`). |
| `quota_max_pods` / `quota_max_services` / `quota_max_pvcs` | _(défini)_ | Plafonds d'objets de l'espace de noms. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` / `topology_spread_strict` | _(défini)_ | Répartit les pods entre les zones/nœuds. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 10 s, 6 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/` délai de 15 s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | _(défini)_ | Sondes d'infrastructure au niveau d'App_GKE. |
| `uptime_check_config` | désactivé — `/` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Element ne déclare aucun job d'initialisation. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services annexes (sidecar) ou auxiliaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir [App_GKE](App_GKE.md).
Entrées principales : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

Hérité et **désactivé par défaut** — Element est sans état. `enable_nfs` (`false`),
`nfs_mount_path`, `nfs_volume_name`, `nfs_instance_name`, `nfs_instance_base_name`.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Crée les buckets GCS définis dans `storage_buckets`. Désactivé — Element est sans état et n'en déclare aucun. |
| `storage_buckets` | `[]` | Buckets supplémentaires. Element n'en déclare aucun. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

Hérité d'[App_GKE](App_GKE.md) et **sans effet** — une SPA statique n'a ni cache ni
file d'attente côté serveur. `enable_redis`, `redis_host`, `redis_port`, `redis_auth`.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

Hérité d'[App_GKE](App_GKE.md) et **sans effet** — `Element_Common` définit
`database_type = "NONE"`. Aucune instance Cloud SQL, aucun utilisateur ni mot de passe
n'est créé.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

Hérité et **sans effet pour Element** (il n'y a rien à sauvegarder). `backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`.

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Hérité ; non utilisé par Element. `enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root`.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour des noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `static_ip_name` / `network_tags` / `network_name` | _(défini)_ | Nom de l'IP, tags des nœuds, réseau VPC. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Remarque :** activer IAP exige une authentification par identité Google avant même
> le chargement de l'interface du client. Les utilisateurs s'authentifient ensuite
> auprès du serveur d'accueil ; IAP est une barrière d'accès externe, et non un
> remplacement de la connexion Matrix.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Element. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE — intéressant pour les assets statiques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
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
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Element. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Element). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (aucun pour Element). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, une charge de travail `Deployment` avec `stateful_pvc_enabled = true`, des valeurs `quota_memory_*` exprimées en entiers nus. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `homeserver_url` / `homeserver_name` | Votre véritable serveur d'accueil, ou vide pour matrix.org | Élevé | Un serveur d'accueil erroné ou injoignable empêche les utilisateurs de se connecter — l'interface se charge mais l'authentification échoue. |
| `application_version` | Épinglez un véritable tag `element-web` | Élevé | `latest` n'est pas un tag `element-web` valide ; le module épingle `v1.11.86`, mais un ARG de build brut `latest` défini à la main échouerait avec `MANIFEST_UNKNOWN`. |
| `container_image_source` | `custom` | Élevé | `prebuilt` avec une image dépourvue du point d'entrée `config.json` livre un Element pointant vers le mauvais serveur d'accueil. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; le garde-fou de validation rejette les valeurs invalides. Conserver 1 garantit que l'interface est toujours accessible. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_iap` | À activer pour protéger l'interface | Moyen | Sans IAP, toute personne disposant de l'URL peut charger le client (il lui faut toutefois des identifiants du serveur d'accueil pour se connecter). |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| Entrées Base de données / Redis / Sauvegarde / NFS | Laisser la valeur par défaut | Faible | Sans effet pour Element ; les définir n'a aucune incidence. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Element, partagée avec
la variante Cloud Run, est décrite dans **[Element_Common](Element_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Element sur GKE Autopilot](../labs/Element_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Element sur Google Cloud Run](Element_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Element Common — Configuration applicative partagée](Element_Common.md) — la configuration partagée par les deux cibles de déploiement.
