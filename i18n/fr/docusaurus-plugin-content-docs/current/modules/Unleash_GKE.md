---
title: "Unleash sur GKE Autopilot"
description: "Référence de configuration pour déployer Unleash sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Unleash_GKE.md @ 3055034 sha256:ec171c4c561c -->

# Unleash sur GKE Autopilot {#unleash-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Unleash_GKE.png" alt="Unleash sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Unleash est une plateforme open source, sous licence Apache 2.0, de gestion des
feature flags et des bascules de fonctionnalités, pour la livraison progressive, les
tests A/B et les déploiements graduels. Ce module déploie Unleash sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Unleash et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Unleash s'exécute comme une charge de travail web Node.js. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Unleash ne prend en charge ni MySQL ni d'autres moteurs |
| Secrets | Secret Manager | Jeton d'API administrateur d'amorçage généré automatiquement (`INIT_ADMIN_API_TOKENS`) ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Unleash est sans état.** Toutes les données de flags, de bascules, de stratégies,
  de segments et d'audit résident dans PostgreSQL : `workload_type = Deployment`,
  `session_affinity = None`, et n'importe quel pod peut traiter n'importe quelle
  requête. NFS et le stockage objet sont désactivés.
- **Aucun backend Redis ni file d'attente.** Unleash n'a besoin ni de cache ni de file
  d'attente ; il se met à l'échelle horizontalement en dirigeant davantage de pods vers
  la même base de données.
- **`INIT_ADMIN_API_TOKENS` est généré automatiquement** et stocké dans Secret Manager,
  puis matérialisé dans l'espace de noms via le pilote Secret Store CSI. Unleash
  enregistre ce jeton d'API administrateur à accès total (`*:*`) dans sa base de
  données au premier démarrage.
- **Au moins 1 réplica est maintenu** (`min_instance_count = 1` ; GKE ne prend pas en
  charge la mise à l'échelle à zéro) afin que l'API Unleash reste joignable pour les
  clients SDK.
- **`DATABASE_URL` est assemblée au démarrage du pod** à partir des variables `DB_*`
  injectées par la plateforme. Sur GKE, le sidecar cloud-sql-proxy écoute sur
  `127.0.0.1` avec un TLS déjà terminé : le point d'entrée utilise donc le chemin de
  boucle locale (SSL désactivé vers la boucle locale).
- **Le point de terminaison de santé est `/health`** — un point de terminaison public,
  sans authentification, qui renvoie 200. L'Admin API sous `/api/admin/*` exige un
  jeton.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Unleash {#a-gke-autopilot--the-unleash-workload}

Les pods Unleash sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre les nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Unleash pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Unleash stocke toutes les données applicatives (projets, feature flags, stratégies,
segments, jetons d'API, utilisateurs et journal des modifications/d'audit) dans une
instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de manière privée via
le sidecar **Cloud SQL Auth Proxy** ; aucune IP publique n'est exposée. Lors du premier
déploiement, un Job d'initialisation crée la base de données et l'utilisateur de
l'application, et Unleash applique ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
voir [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Un jeton d'API administrateur d'amorçage est généré automatiquement et stocké dans
Secret Manager, puis matérialisé dans l'espace de noms sous le nom
`INIT_ADMIN_API_TOKENS` via le pilote Secret Store CSI. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-token"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP
statique peut être réservée pour que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN
et les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Unleash {#3-unleash-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données et l'utilisateur de l'application, puis accorde les privilèges. Le job peut
  être relancé sans risque ; il ne crée **pas** de tables.
- **Migrations de schéma au démarrage.** Unleash applique automatiquement ses propres
  migrations de schéma à chaque démarrage : la mise à niveau de la version de
  l'application applique donc les modifications de schéma sans étape de migration
  distincte.
- **`DATABASE_URL` est composée à l'exécution.** Le point d'entrée de l'image
  personnalisée assemble la chaîne de connexion à partir des variables `DB_*`
  injectées et utilise le chemin de boucle locale du cloud-sql-proxy sur GKE.
  Inspectez les variables injectées lors du débogage :
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')
  kubectl get pod "$POD" -n "$NAMESPACE" -o jsonpath='{.spec.containers[0].env[*].name}' | tr ' ' '\n' | grep -iE 'DB_|DATABASE'
  ```
- **Jeton d'API administrateur d'amorçage.** `INIT_ADMIN_API_TOKENS` enregistre un
  jeton d'API administrateur à accès total (`*:*`) au premier démarrage, afin que la
  CI, l'Unleash CLI et les backends des SDK puissent appeler l'Admin API sans
  connexion à l'interface.
- **Identifiants par défaut de l'interface.** L'interface d'administration est livrée
  avec un compte de premier lancement bien connu — `admin` / `unleash4all`. Changez le
  mot de passe immédiatement après la première connexion.
- **Accessibilité pour les webhooks et les SDK.** La valeur par défaut
  `service_type = LoadBalancer` expose une IP externe pour les clients SDK et la CI.
  Définissez un domaine personnalisé via `application_domains` et réservez une IP
  statique pour que l'adresse survive aux redéploiements.
- **Chemin de santé.** Les sondes de démarrage et de vivacité (liveness) ciblent
  `/health` — un point de terminaison public, sans authentification, qui ne répond 200
  que lorsque le serveur est initialisé et connecté à PostgreSQL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Unleash ou notables pour lui sont listés ;
toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `unleash` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Unleash` | Nom lisible affiché dans la console. |
| `application_version` | `5.7.0` | Tag de l'image `unleashorg/unleash-server` ; `latest` est remplacé par un tag figé au moment du build. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Cloud Build encapsule `unleashorg/unleash-server` avec le point d'entrée DATABASE_URL. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod ; empreinte légère d'Unleash. |
| `container_port` | `4242` | Unleash écoute sur le port 4242. |
| `min_instance_count` | `1` | minReplicas du HPA ; conservez une valeur ≥ 1 (GKE ne permet pas la mise à l'échelle à zéro). |
| `max_instance_count` | `10` | maxReplicas du HPA. |
| `workload_type` | `Deployment` | Sans état — aucun StatefulSet nécessaire. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `DATABASE_URL` est assemblée à l'exécution — ne la définissez pas ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `None` | Sans état — n'importe quel pod traite n'importe quelle requête ; aucune affinité nécessaire. |
| `namespace_name` | `""` | Laissez vide pour une génération automatique. |
| `network_tags` | `[]` | Tags réseau des nœuds/pods pour les règles de pare-feu. |
| `termination_grace_period_seconds` | `30` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé pour Unleash (sans état). `stateful_pvc_enabled` vaut `null` par défaut ;
laissez les entrées StatefulSet à leurs valeurs par défaut.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota dans l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des suffixes binaires** (`4Gi`, `8192Mi`) — les entiers nus sont des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai de 30 s, 30 tentatives | Sonde de démarrage. Marge pour les migrations du premier démarrage. |
| `health_check_config` | HTTP `/health`, délai de 30 s | Sonde de vivacité (liveness). |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés à côté d'Unleash. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir [App_GKE](App_GKE.md).
Principales entrées : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — Unleash est sans état. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (inutilisé par défaut). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS supplémentaires. |
| `storage_buckets` | `[]` | Vide — Unleash est sans état. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Unleash nécessite PostgreSQL ; `Unleash_Common` provisionne PostgreSQL 15. |
| `application_database_name` | `unleash` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `unleash` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16 à 64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** activer IAP impose une authentification par identité Google pour
> **toutes** les requêtes entrantes, y compris les appels SDK et CI authentifiés par
> jeton vers l'API Unleash. N'activez IAP que si l'API n'a pas besoin d'être atteinte
> directement par des clients SDK.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Unleash. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR bénéficiant d'un accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (détecte automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Unleash. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Unleash). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | État de la CI/CD et dépôt connecté. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `deployment_id` / `project_id` | Identifiants de nommage et de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES` (→ PostgreSQL 15) | Critique | Tout autre moteur empêche le démarrage d'Unleash — il ne prend en charge que PostgreSQL. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données des flags. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critique | L'activer sans `backup_file` valide fait échouer le job d'import. |
| Chemin de `startup_probe_config` / `health_check_config` | `/health` | Élevé | Diriger une sonde vers `/api/admin/*` renvoie 401/403 et le pod ne devient jamais Ready. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. Conserver 1 maintient l'API joignable. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est nécessaire à la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `session_affinity` | `None` | Faible | Unleash est sans état ; l'affinité est inutile et n'apporte rien. |
| `enable_iap` | uniquement en l'absence de trafic SDK | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les appels SDK/CI authentifiés par jeton vers l'API Unleash. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| Identifiants par défaut de l'interface `admin` / `unleash4all` | À modifier à la première connexion | Élevé | Conserver le mot de passe par défaut expose le contrôle administrateur complet de tous les flags. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Unleash, partagée avec
la variante Cloud Run, est décrite dans **[Unleash_Common](Unleash_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Unleash sur GKE Autopilot](../labs/Unleash_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Unleash sur Google Cloud Run](Unleash_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Unleash Common — Configuration applicative partagée](Unleash_Common.md) — la configuration partagée par les deux cibles de déploiement.
