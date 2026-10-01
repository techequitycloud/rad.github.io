---
title: "Synapse sur GKE Autopilot"
description: "Référence de configuration pour déployer Synapse sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Synapse_GKE.md @ 3055034 sha256:042dee3c2da7 -->

# Synapse sur GKE Autopilot {#synapse-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Synapse_GKE.png" alt="Synapse sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Synapse est le homeserver de référence de [Matrix](https://matrix.org/) — le serveur
Python open source, sous licence Apache 2.0, du protocole Matrix, un standard ouvert de
communication en temps réel décentralisée et fédérée (messagerie sécurisée et VoIP). Ce
module déploie Synapse sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée. Les utilisateurs se connectent au homeserver avec un client Matrix
tel que l'application web [Element](https://element.io/).

Ce guide se concentre sur les services cloud qu'utilise Synapse et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Synapse s'exécute comme une charge de travail web Python. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Python, 2 vCPU / 4 GiB par défaut, au moins 1 réplica |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Synapse ne prend pas en charge MySQL ; la base de données **doit** utiliser la collation `C` |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié provisionné automatiquement |
| Fichiers persistants | NFS (Filestore) | Clé de signature + dépôt de médias sous le répertoire de données ; activé par défaut |
| Secrets | Secret Manager | Secret partagé d'enregistrement généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire, avec la collation `C`.** Le moteur est imposé par la
  couche applicative partagée, et le job `db-init` du premier déploiement crée la base de
  données avec `LC_COLLATE='C' LC_CTYPE='C'` — Synapse refuse de démarrer avec toute
  autre collation.
- **Synapse gère lui-même son schéma.** Il n'y a pas de job de migration distinct ;
  Synapse crée et met à niveau son propre schéma automatiquement à chaque démarrage.
- **`homeserver.yaml` et la clé de signature sont générés au premier démarrage.** Le
  point d'entrée cloud génère la configuration ainsi qu'une clé de signature persistante
  dans le répertoire de données et raccorde le PostgreSQL de la plateforme avant de
  démarrer Synapse.
- **La clé de signature doit persister.** La régénérer casse la fédération et invalide
  toutes les sessions d'appareils ; le répertoire de données est donc adossé à un
  stockage NFS persistant (`enable_nfs = true` par défaut). Pour une durabilité par pod,
  un PVC de StatefulSet peut être utilisé.
- **`server_name` est fixé à `matrix.local`.** C'est le domaine présent dans chaque
  identifiant utilisateur (`@user:server_name`) et dans la fédération. `Synapse_GKE`
  n'expose pas d'entrée `server_name` — la valeur provient toujours de la valeur par
  défaut de `Synapse_Common`, de sorte qu'un déploiement de production nécessitant un
  vrai domaine impose actuellement de surcharger directement le module Common. Elle est
  immuable après le premier démarrage.
- **Le port du conteneur et toutes les sondes doivent être sur 8008.** L'écouteur client
  + fédération de Synapse est réglé sur `8008` dans la configuration générée ; le port du
  conteneur et les sondes Kubernetes de démarrage/liveness/readiness doivent tous cibler
  `8008`, sinon le pod ne devient jamais Ready alors même que le homeserver est en bonne
  santé.
- **Au moins 1 réplica est maintenu.** GKE ne descend pas à zéro, ce qui convient à un
  homeserver fédéré qui doit rester joignable. Un PodDisruptionBudget le maintient
  disponible pendant les mises à niveau des nœuds.
- **L'affinité de session est `ClientIP` par défaut.** Elle maintient les requêtes d'un
  client sur le même pod.
- **Redis n'est pas utilisé.** Synapse exécute un processus principal unique entièrement
  adossé à PostgreSQL.
- **Le premier utilisateur administrateur est créé pour vous.** L'inscription libre en
  libre-service est désactivée par défaut, mais le job d'initialisation `create-admin`
  enregistre le compte `admin` via `register_new_matrix_user` en utilisant le secret
  partagé d'enregistrement et le mot de passe superutilisateur généré (tous deux dans
  Secret Manager). Les autres utilisateurs sont créés de la même manière, hors bande.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Synapse {#a-gke-autopilot--the-synapse-workload}

Les pods Synapse sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'Horizontal Pod Autoscaling dimensionne le déploiement
entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Synapse
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Synapse stocke tout l'état du homeserver (comptes, salons, événements, clés d'appareils,
état de fédération) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods
l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur une boucle locale
`127.0.0.1` ; aucune IP publique n'est exposée. Au premier déploiement, un Job `db-init`
crée la base de données de l'application **avec la collation `C`** ainsi que
l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  # Verify the mandatory collation:
  #   SELECT datname, datcollate, datctype FROM pg_database WHERE datname = '<db-name>';
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe sont tous indiqués dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage et le répertoire de données persistant {#c-cloud-storage--the-persistent-data-directory}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement. L'état
d'exécution propre à Synapse — `homeserver.yaml`, les surcharges `conf.d`, la **clé de
signature** et le dépôt de médias — réside sous le répertoire de données
(`SYNAPSE_DATA_DIR = /data`), adossé au volume NFS (Filestore) monté sur le chemin de
montage configuré.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"          # if using a StatefulSet PVC
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un **secret partagé d'enregistrement** est généré automatiquement et stocké dans Secret
Manager ; il sert à `register_new_matrix_user` pour la création de comptes hors bande. Le
mot de passe de la base de données est géré séparément par le socle. Les secrets sont
matérialisés dans l'espace de noms via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~synapse"
  kubectl get secrets -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe. Le
trafic client et de fédération Matrix exige une accessibilité publique. Un domaine
personnalisé avec un certificat géré par Google (le domaine doit correspondre à
`server_name`) peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte optionnels sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Synapse {#3-synapse-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth
  Proxy et crée de manière idempotente le rôle de l'application et la base de données
  **avec la collation `C`** (`LC_COLLATE='C' LC_CTYPE='C' TEMPLATE template0`). Le job
  peut être relancé sans risque.
- **Pas de job de migration — schéma autogéré.** Synapse crée et met à niveau son schéma
  à chaque démarrage ; la mise à niveau de la version de l'application applique donc les
  modifications de schéma sans étape de migration distincte.
- **Configuration + clé de signature générées au premier démarrage.** Le point d'entrée
  cloud génère `homeserver.yaml` et une clé de signature persistante dans `/data`, écrit
  un extrait `conf.d` qui raccorde PostgreSQL (via le sidecar Auth Proxy sur `127.0.0.1`)
  et l'écouteur `0.0.0.0:8008`, puis lance Synapse. La clé de signature n'est générée
  qu'une seule fois — conservez `/data` sur un volume persistant (NFS par défaut, ou un
  PVC de StatefulSet).
- **`server_name` est immuable après le premier démarrage.** `Synapse_GKE` n'expose pas
  d'entrée `server_name` (il utilise toujours la valeur par défaut de `Synapse_Common`,
  `matrix.local`) ; modifier ultérieurement la valeur sous-jacente invalide chaque
  identifiant utilisateur, chaque session d'appareil et chaque relation de fédération.
- **Le port du conteneur et les sondes doivent être sur 8008.** Le port du conteneur du
  Deployment et les sondes de démarrage/liveness/readiness ciblent tous `8008` ; une
  incohérence signifie que la sonde frappe un port mort et que le pod ne devient jamais
  Ready.
- **Chemin de santé.** Les sondes ciblent par défaut `/` sur 8008 — Synapse y sert une
  page d'accueil non authentifiée ; `/health` (qui renvoie `OK`) fonctionne aussi comme
  chemin de sonde. Vérifiez que l'API client répond avec `GET /_matrix/client/versions` :
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  curl -s "http://${EXTERNAL_IP}/_matrix/client/versions"
  ```
- **Le job `create-admin` enregistre le premier utilisateur administrateur.** Il
  s'exécute après `db-init`, interroge `http://<service-name>/health` (le Service écoute
  sur le port 80 quel que soit le port 8008 du conteneur), puis exécute
  `register_new_matrix_user -u admin -a` avec le secret partagé d'enregistrement et le
  mot de passe superutilisateur généré. Il peut être relancé sans risque (« User ID
  already taken » est toléré). Lisez le mot de passe avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=secret-<prefix>-synapse-superuser-password --project "$PROJECT"
  ```
- **Créez d'autres utilisateurs** avec le même outil depuis l'intérieur d'un pod :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    register_new_matrix_user -c /data/homeserver.yaml -u alice -a http://localhost:8008
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Synapse ou notables pour lui sont listés ;
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
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `synapse` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Synapse Helpdesk` | Nom lisible. |
| `application_version` | `latest` | Tag de l'image Synapse ; épinglez une version précise (p. ex. `v1.119.0`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `8008` | Écouteur client + fédération de Synapse. Les sondes doivent correspondre. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; conservez 1 pour que le homeserver soit toujours joignable par la fédération. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `container_image_source` | `custom` | Build personnalisé léger `FROM matrixdotorg/synapse`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base Synapse dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | VPA pour l'ajustement automatique des requêtes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs `SYNAPSE_*` principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour le trafic client + fédération Matrix. |
| `workload_type` | `null` (auto) | `Deployment` ou `StatefulSet` ; s'il n'est pas défini, se résout en `Deployment` sauf si `stateful_pvc_enabled = true` (alors `StatefulSet`). |
| `session_affinity` | `ClientIP` | Le routage persistant maintient un client sur le même pod. |
| `network_tags` | `["nfsserver"]` | Obligatoire lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `60` | Secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy Kubernetes. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Active les modèles de PVC — utile pour donner à la clé de signature et aux médias une persistance par pod. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage du PVC dans le conteneur (le répertoire de données de Synapse). |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass Kubernetes des PVC. |
| `stateful_headless_service` | `null` (auto) | Crée un Service headless pour des noms DNS de pods stables. |
| `stateful_pod_management_policy` | `null` (→ `OrderedReady`) | Ordre de création des pods. |
| `stateful_update_strategy` | `null` (auto) | Stratégie de mise à jour (`RollingUpdate` ou `OnDelete`). |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` sur 8008, délai initial de 60s | Sonde de démarrage. Laissez le temps de la mise en place du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/` sur 8008, délai initial de 60s | Sonde de liveness. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring optionnel. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques optionnelles. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés : `db-init` (base de données en collation C + rôle) et `create-admin` (enregistre le superutilisateur `admin`). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires déployés aux côtés de Synapse. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir [App_GKE](App_GKE.md).
Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS persistant pour le répertoire de données (clé de signature + médias). |
| `nfs_mount_path` | `/opt/synapse/storage` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS configurés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets à provisionner — la valeur par défaut crée le bucket de données dédié. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Synapse utilise une file d'attente et un cache adossés à PostgreSQL — laissez `false` sauf en cas d'externalisation. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis (uniquement en cas d'externalisation). |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `synapse` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `synapse` | Utilisateur de base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption. |
| `rotation_propagation_delay_sec` | `90` | Secondes d'attente après la rotation avant le redémarrage progressif des pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + certificat géré (doit correspondre à `server_name`). |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `["nfsserver"]` | Tags de pare-feu ; `nfsserver` est obligatoire pour NFS. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP exige une authentification par identité Google
> pour **toutes** les requêtes entrantes, y compris la fédération Matrix et les clients
> externes. N'activez IAP que pour des homeservers privés, réservés aux administrateurs,
> qui ne sont pas fédérés.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Synapse. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une politique Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | `default-waf-policy` | Nom de la politique. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE (utile pour les médias). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL pour accéder à Synapse. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (optionnel). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage, une mémoire de ResourceQuota sans suffixe d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `server_name` (fixé à `matrix.local`) | Non exposé comme entrée de `Synapse_GKE` | Critical | Une vraie fédération et des identifiants utilisateur durables exigent un domaine personnalisé ; ce module n'a pas de variable `server_name`, donc une utilisation en production impose actuellement de surcharger directement `Synapse_Common`. Modifier la valeur sous-jacente après le premier démarrage invalide chaque identifiant utilisateur, chaque session d'appareil et chaque relation de fédération. |
| Persistance de la clé de signature (`enable_nfs` / PVC de StatefulSet) | persistante | Critical | Si le répertoire de données n'est pas persistant, un redémarrage de pod régénère la clé de signature, ce qui casse la fédération et invalide toutes les sessions d'appareils. |
| Collation de la base de données (`db-init`) | `C` (automatique) | Critical | Synapse refuse de démarrer avec toute collation autre que `C` ; ne contournez pas le job `db-init`. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `container_port` / port des sondes | `8008` | High | Des sondes sur tout autre port frappent un port mort et le pod ne devient jamais Ready alors même que Synapse est en bonne santé. |
| Chemin des sondes | `/` (par défaut) ou `/health` | High | Pointer une sonde vers un chemin authentifié de l'API Matrix renvoie 401/403 et le pod ne devient jamais Ready. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | High | En dessous de 2 GiB, Synapse subit des arrêts OOM sous une charge réelle de salons et de fédération. |
| `min_instance_count` | `1` | High | GKE exige un minimum ≥ 1 ; conserver 1 garantit que le homeserver est toujours joignable par la fédération. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes d'un client se dispersent entre les pods, ce qui perturbe les connexions de synchronisation de longue durée. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est nécessaire à la connectivité PostgreSQL ; sa désactivation est bloquée par une garde de validation au moment du plan. |
| `enable_iap` | uniquement pour les serveurs privés | High | IAP bloque la fédération et les clients externes ; à n'utiliser que pour les déploiements réservés aux administrateurs. |
| Mise à jour progressive sur des pods adossés à NFS | `Recreate` (automatique) | High | Deux pods utilisant le même répertoire de données + la même base de données peuvent entrer en concurrence ; le socle utilise `Recreate` pour les applications adossées à NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Medium | La désactivation permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Synapse, partagée avec
la variante Cloud Run, est décrite dans **[Synapse_Common](Synapse_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Synapse sur GKE Autopilot](../labs/Synapse_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Synapse sur Google Cloud Run](Synapse_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Synapse Common — Configuration applicative partagée](Synapse_Common.md) — la configuration partagée par les deux cibles de déploiement.
