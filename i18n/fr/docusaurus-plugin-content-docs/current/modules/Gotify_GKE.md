---
title: "Gotify sur GKE Autopilot"
description: "Référence de configuration pour déployer Gotify sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gotify_GKE.md @ 3055034 sha256:beaac2f37a1b -->

# Gotify sur GKE Autopilot {#gotify-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gotify_GKE.png" alt="Gotify sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gotify est un serveur open source (sous licence MIT) auto-hébergé permettant d'envoyer
et de recevoir des notifications push en temps réel. Les applications publient des
messages via une API REST simple et les clients les reçoivent instantanément via des
flux WebSocket. Ce module déploie Gotify sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Gotify et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gotify s'exécute sous la forme d'une charge de travail web Go à binaire unique. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, requête de 1 vCPU / 512 MiB par défaut ; réplica unique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — ce module n'utilise jamais le SQLite intégré de Gotify |
| Secrets | Secret Manager | Mot de passe administrateur généré automatiquement (`GOTIFY_DEFAULTUSER_PASS`) ; mot de passe de la base de données |
| Build du conteneur | Cloud Build + Artifact Registry | Encapsule `ghcr.io/gotify/server` avec un point d'entrée de mappage de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES"` est la valeur par
  défaut du module ; le mode SQLite de Gotify n'est pas utilisé, aucun PVC par pod
  n'est donc nécessaire.
- **Le conteneur écoute sur le port 80.** `container_port = 80` et le point d'entrée
  définit `GOTIFY_SERVER_PORT = 80`.
- **Un seul réplica est la valeur par défaut sûre.** `min = max = 1`. Le bus de
  messages de Gotify est interne au processus : un flux client ne reçoit que les
  messages remis au pod auquel il est connecté. Dépasser un réplica sans couche de
  diffusion externe fait perdre des messages à certains abonnés.
- **Deployment sans état.** `workload_type = "Deployment"` et
  `session_affinity = "None"` — n'importe quel pod peut traiter n'importe quelle
  requête, car tous les messages résident dans PostgreSQL.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret
  Manager, puis injecté sous la forme `GOTIFY_DEFAULTUSER_PASS`. L'administrateur
  initial (`admin`) n'est créé que lors de la première initialisation de la base de
  données.
- **Aucun stockage objet n'est provisionné** (`storage_buckets = []`,
  `enable_nfs = false`).
- **L'image est construite sur mesure.** `container_image_source = "custom"` encapsule
  `ghcr.io/gotify/server` et mappe les variables `DB_*` de la plateforme vers la
  configuration `GOTIFY_DATABASE_*` (GORM) de Gotify ; sur GKE, `DB_HOST` vaut
  `127.0.0.1` via le sidecar cloud-sql-proxy. `latest` est épinglé sur la base `2.9.1`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gotify {#a-gke-autopilot--the-gotify-workload}

Les pods Gotify sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Le module conserve un réplica unique afin que le bus
de messages interne au processus distribue les messages à chaque client connecté.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Gotify pour consulter les pods et les événements. Kubernetes Engine →
  Services et entrées affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gotify stocke toutes les données de l'application (messages, applications, clients,
utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods s'y
connectent de manière privée via le sidecar **Cloud SQL Auth Proxy** (boucle locale
`127.0.0.1`) ; aucune IP publique n'est exposée. Lors du premier déploiement, une
tâche d'initialisation crée la base de données et le rôle de l'application ; Gotify
applique ensuite son propre schéma par auto-migration GORM au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent tous dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le mot de passe administrateur (`GOTIFY_DEFAULTUSER_PASS`) est généré automatiquement
et stocké dans Secret Manager, puis matérialisé dans l'espace de noms via le pilote
Secret Store CSI. Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotify"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration CSI et la rotation.

### D. Build du conteneur et Artifact Registry {#d-container-build--artifact-registry}

L'image personnalisée encapsule `ghcr.io/gotify/server` avec un point d'entrée de
mappage de la base de données. Cloud Build la construit et la pousse vers Artifact
Registry ; `enable_image_mirroring = true` duplique l'image de base amont dans
Artifact Registry afin d'éviter les limites de débit des registres.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing.
Un domaine personnalisé avec un certificat géré par Google peut être activé, et une
IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud
CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées vers Cloud Monitoring, avec un test de
disponibilité sur `/health` et des règles d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gotify {#3-gotify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Elle se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données et le rôle de l'application, puis accorde les privilèges. La tâche peut être
  relancée sans risque.
- **Schéma par auto-migration GORM.** Gotify crée et migre ses propres tables à chaque
  démarrage — il n'existe pas de tâche de migration distincte. La mise à niveau de la
  version de l'application applique automatiquement les modifications de schéma.
- **Le compte administrateur n'est initialisé qu'une fois.**
  `GOTIFY_DEFAULTUSER_NAME = admin` et le secret `GOTIFY_DEFAULTUSER_PASS` créent
  l'administrateur initial uniquement lors de la première initialisation de la base de
  données. Récupérez le mot de passe dans Secret Manager et modifiez-le après la
  première connexion.
- **L'envoi et la réception sont authentifiés par jeton.** Après vous être connecté,
  créez une *application* (qui fournit un jeton d'application) pour envoyer des
  messages via `POST /message?token=<apptoken>`, et utilisez un jeton *client* pour
  vous abonner via le WebSocket à `/stream?token=<clienttoken>`. Vérifiez l'état de
  santé sans jeton :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>/health
  ```
- **Diffusion WebSocket sur un réplica unique.** Le bus de messages étant interne au
  processus, conservez `max_instance_count = 1` sauf si vous ajoutez une couche de
  diffusion externe — sinon un message envoyé à un pod n'est pas remis aux clients
  connectés en flux à un autre.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` — le
  point de terminaison public qui renvoie `{"health":"green","database":"green"}` dès
  que PostgreSQL est joignable. La sonde de démarrage par défaut accorde environ
  5 minutes au premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gotify ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
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
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotify` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Gotify` | Nom lisible affiché dans la console. |
| `application_description` | `Gotify push notification server on GKE Autopilot` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de l'image ; `latest` correspond à la base épinglée `2.9.1`. Épinglez une version en production. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | `custom` construit l'image d'encapsulation qui mappe la base de données ; `prebuilt` déploie une URI d'image que vous configurez. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Requêtes et limites de CPU/mémoire par pod. |
| `container_port` | `80` | Gotify écoute sur le port 80. |
| `min_instance_count` | `1` | minReplicas du HPA. |
| `max_instance_count` | `1` | maxReplicas du HPA. Conservez 1 — le bus de messages interne au processus ne diffuse pas entre les pods. |
| `workload_type` | `Deployment` | Deployment sans état ; aucun StatefulSet n'est nécessaire. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les flux de longue durée. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité. |
| `enable_image_mirroring` | `true` | Duplique `ghcr.io/gotify/server` dans Artifact Registry. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GOTIFY_*` supplémentaires. La connexion à la base de données et `GOTIFY_DEFAULTUSER_PASS` sont injectés automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `None` | Adapté à Gotify sans état — aucune session par pod n'est nécessaire. |
| `namespace_name` | `""` | Généré automatiquement s'il est vide. |
| `network_tags` | `[]` | Tags réseau des nœuds/pods pour les règles de pare-feu. |
| `termination_grace_period_seconds` | `30` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Crée un ResourceQuota pour l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Doivent utiliser des suffixes binaires (`4Gi`, `8192Mi`) — des entiers seuls sont interprétés en octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health`, délai de 30 s, 30 échecs | Sonde de démarrage. `Gotify_GKE` mappe cette variable vers le `startup_probe` propre à la charge de travail Gotify (via `Gotify_Common`) ; c'est donc la valeur qui conditionne réellement la disponibilité — elle accorde environ 5 minutes au premier démarrage. |
| `health_check_config` | HTTP `/health`, délai de 30 s | Sonde de vivacité. Mappée de la même façon vers le `liveness_probe` de la charge de travail. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 11 — Tâches et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires aux côtés de Gotify. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration standard Cloud Build / Cloud Deploy d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut ; ne l'activez que pour rendre persistant le stockage sur disque des images et plugins de Gotify. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Gotify est sans état dans ce module. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Gotify utilise PostgreSQL géré. |
| `application_database_name` | `gotify` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gotify` | Rôle de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP exige une authentification par identité
> Google pour **toutes** les requêtes entrantes, y compris les appels à l'API
> d'envoi/réception authentifiés uniquement par jeton. N'activez IAP que si ces
> appelants peuvent également présenter une identité Google.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Gotify. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés pour l'accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (découvre automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `service_url` | URL externe de l'équilibreur de charge GKE. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `project_id` / `deployment_id` | ID du projet / suffixe du déploiement. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / rôle de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Gotify). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | État du CI/CD et dépôt connecté. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt (relancez l'apply sur un nouveau cluster inline). |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, des réplicas `min > max`, `enable_cloudsql_volume` avec `database_type = "NONE"`, un `backup_retention_days` hors plage, des unités de mémoire de quota non binaires. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Dépasser 1 sans diffusion externe fait perdre des messages aux clients connectés en flux à d'autres pods (bus de messages interne au processus). |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et détruit tous les messages. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans sauvegarde valide fait échouer la tâche d'import. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers seuls sont interprétés en octets et bloquent la planification de tous les pods de l'espace de noms. |
| `container_port` | `80` | High | Gotify écoute sur le port 80 ; un port différent fait échouer la sonde de démarrage et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation est bloquée par un garde-fou au moment du plan lorsque `database_type` est défini. |
| `min_instance_count` | `1` | High | GKE exige min ≥ 1 ; conserver 1 garantit que le service reste toujours joignable. |
| `enable_iap` | uniquement lorsque les appelants présentent une identité | High | IAP bloque les appels à l'API d'envoi/réception authentifiés uniquement par jeton. |
| `GOTIFY_DEFAULTUSER_PASS` (généré automatiquement) | Modifier le mot de passe administrateur après la première connexion | High | Le mot de passe d'initialisation ne s'applique qu'à la première initialisation ; le laisser inchangé constitue une exposition permanente d'identifiants. |
| `enable_pod_disruption_budget` | `true` | Medium | Sa désactivation permet à GKE d'évincer le pod pendant la maintenance, ce qui interrompt les flux actifs. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Gotify partagée avec
la variante Cloud Run est décrite dans **[Gotify_Common](Gotify_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gotify sur GKE Autopilot](../labs/Gotify_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Gotify sur Google Cloud Run](Gotify_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gotify Common — Configuration applicative partagée](Gotify_Common.md) — la configuration partagée par les deux cibles de déploiement.
