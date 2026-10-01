---
title: "Node-RED sur Google Cloud Run"
description: "Référence de configuration pour déployer Node-RED sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/NodeRED_CloudRun.md @ 3055034 sha256:0a606e4f853d -->

# Node-RED sur Google Cloud Run {#node-red-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/NodeRED_CloudRun.png" alt="Node-RED sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Node-RED est un outil open source de programmation par flux qui permet de relier
des appareils IoT, des API et des services en ligne au moyen d'un éditeur visuel
dans le navigateur. Ce module déploie Node-RED sur **Cloud Run v2** en s'appuyant
sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Node-RED et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Node-RED s'exécute sous forme de conteneur Node.js sur Cloud Run v2 (gen2) et
écoute sur le port 1880. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique selon les requêtes |
| Stockage persistant des flux | Filestore (NFS) | Flux, identifiants et nœuds installés dans `/data` (nécessite gen2) |
| Stockage d'objets | Cloud Storage | Un bucket dédié aux données de l'application |
| Stockage du contexte | Redis (facultatif) | Désactivé par défaut ; permet de conserver le contexte entre les redémarrages et de le partager entre les instances |
| Secret des identifiants | Secret Manager | `NODE_RED_CREDENTIAL_SECRET`, généré automatiquement, chiffre les identifiants des flux |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est requise.** Node-RED stocke tout son état dans son
  répertoire `/data` ; `database_type` vaut `"NONE"` par défaut.
- **NFS est activé par défaut.** Le répertoire `/data` est monté depuis un partage
  Filestore (nécessite `execution_environment = "gen2"`) afin que les flux, les
  identifiants et les nœuds installés survivent aux redémarrages du conteneur et
  aux nouveaux déploiements.
- **La mise à l'échelle à zéro est prise en charge** (`min_instance_count = 0`).
  Définissez la valeur `1` pour les charges de travail de webhooks en production,
  afin d'éviter les délais de démarrage à froid et les webhooks manqués pendant la
  fenêtre de remontage NFS.
- **`max_instance_count = 1` par défaut.** Node-RED n'est pas conçu pour une mise à
  l'échelle horizontale active-active ; chaque instance possède son propre contexte
  en mémoire. N'augmentez cette valeur qu'en cas de stockage de contexte externe
  adossé à Redis.
- **`NODE_RED_CREDENTIAL_SECRET` est généré automatiquement.** Il chiffre tous les
  identifiants de flux stockés et est conservé dans Secret Manager. Sa rotation
  après le déploiement des flux rend les identifiants existants illisibles.
- **Les sondes de santé utilisent HTTP GET `/`**, qui renvoie l'interface de
  l'éditeur une fois Node-RED prêt (un délai initial de 30 secondes suffit).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Node-RED {#a-cloud-run--the-node-red-service}

Node-RED s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Filestore (NFS) — stockage persistant des flux {#b-filestore-nfs--persistent-flow-storage}

Node-RED stocke toutes ses données persistantes — flux (`flows.json`),
identifiants chiffrés (`flows_cred.json`), nœuds de palette installés et fichier de
paramètres — dans son répertoire `/data`. Un partage NFS Filestore est monté sur
`/data` (gen2 requis) afin que les données survivent aux redémarrages du conteneur
et aux nouvelles révisions du service.

- **Console :** Filestore → Instances pour le partage NFS.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Inspect the mounted volume from an active instance:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### C. Cloud Storage {#c-cloud-storage}

Un bucket GCS dédié est provisionné pour les données applicatives de Node-RED
(exports de flux, archives de sauvegarde). L'accès est accordé automatiquement au
compte de service.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options CMEK.

### D. Secret Manager — chiffrement des identifiants des flux {#d-secret-manager--flow-credential-encryption}

`NODE_RED_CREDENTIAL_SECRET` est généré automatiquement lors du déploiement et
stocké sous forme de secret Secret Manager. Node-RED utilise cette clé pour
chiffrer tous les identifiants stockés dans les flux. Ce module ne génère aucun
autre secret propre à l'application.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Redis (stockage facultatif du contexte) {#e-redis-optional-context-storage}

Lorsque `enable_redis = true`, Node-RED est configuré pour stocker le contexte des
flux à l'extérieur, dans Redis, ce qui permet aux données de contexte de persister
entre les redémarrages d'instance et d'être partagées entre plusieurs instances.
Redis est désactivé par défaut.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

Lorsque `enable_redis = true` et que `redis_host` est vide mais que
`enable_nfs = true`, l'IP du serveur NFS est utilisée comme hôte Redis ; sinon,
`redis_host` doit être défini explicitement.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être
ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud
Run sont envoyées à Cloud Monitoring, avec en option des tests de disponibilité et
des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Node-RED {#3-node-red-application-behaviour}

- **Ni base de données, ni job d'initialisation.** Node-RED stocke tout son état
  dans `/data`. Aucune instance Cloud SQL n'est provisionnée et aucun job
  d'initialisation de schéma n'est requis. Le premier démarrage crée
  automatiquement les fichiers de flux par défaut si `/data` est vide.
- **Chiffrement des identifiants des flux.** `NODE_RED_CREDENTIAL_SECRET` est
  injecté à l'exécution depuis Secret Manager. Cette clé chiffre le fichier
  `flows_cred.json` sur le partage NFS. Modifier la clé ou effectuer sa rotation
  après le déploiement des flux rend illisibles tous les identifiants stockés (clés
  d'API, mots de passe, jetons).
- **Mode sans échec.** `NODE_RED_ENABLE_SAFE_MODE` est toujours défini sur
  `"false"`, ce qui garantit que les flux s'exécutent au démarrage. Surchargez-le
  avec `"true"` via `environment_variables` pour démarrer Node-RED avec les flux
  désactivés à des fins de débogage.
- **Mise à l'échelle à zéro et démarrages à froid.** Avec `min_instance_count = 0`,
  Node-RED se met à l'échelle à zéro lorsqu'il est inactif. Lors d'une remontée en
  charge, le volume NFS doit être remonté avant que le contrôle de santé ne réussisse
  (environ 10–20 secondes). Les webhooks déclenchés pendant cette fenêtre peuvent
  être perdus. Définissez `min_instance_count = 1` pour les charges de travail de
  webhooks en production.
- **Sonde de santé.** Les sondes de démarrage et d'activité envoient toutes deux un
  HTTP GET à `/`, qui renvoie l'interface de l'éditeur une fois Node-RED prêt. Un
  délai initial de 30 secondes suffit.
- **Tâches planifiées.** Node-RED ne dispose d'aucune commande planifiée intégrée.
  Utilisez `cron_jobs` pour provisionner des jobs Cloud Run déclenchés par Cloud
  Scheduler pour les opérations de maintenance périodiques, comme les exports de
  flux ou les vidages de cache :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Accès à l'éditeur.** Rendez-vous à l'URL indiquée par la sortie `service_url`
  et connectez-vous. Pour les déploiements de production, activez IAP
  (`enable_iap = true`) pour contrôler l'accès par une authentification d'identité
  Google — l'éditeur donne accès à l'édition complète des flux et à la gestion des
  identifiants.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Node-RED ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `nodered` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Node-RED` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag d'image pour `nodered/node-red`. Épinglez une version précise (par ex. `4.0.9`) pour des déploiements reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU suffit pour la plupart des déploiements. |
| `memory_limit` | `1Gi` | Mémoire par instance ; passez à `2Gi` pour les flux qui traitent des charges utiles volumineuses. |
| `min_instance_count` | `0` | Nombre minimal d'instances. `0` active la mise à l'échelle à zéro ; définissez `1` pour les charges de travail de webhooks en production. |
| `max_instance_count` | `1` | Nombre maximal d'instances. Conservez `1`, sauf si les flux sont sans état ou adossés à Redis. |
| `execution_environment` | `gen2` | **Doit valoir `gen2` pour que les montages de volumes NFS fonctionnent.** |
| `timeout_seconds` | `300` | Durée maximale d'une requête avant le renvoi d'une erreur 504. |
| `cpu_always_allocated` | `false` | Lorsque `false`, le CPU est bridé au repos. Définissez `true` uniquement si des tâches en arrière-plan nécessitent un CPU en continu. |
| `enable_image_mirroring` | `true` | Copier l'image depuis Docker Hub vers Artifact Registry pour éviter les limites de débit. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements canary/blue-green. |
| `max_revisions_to_retain` | `7` | Révisions Cloud Run à conserver après chaque déploiement. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. Utilisez `"internal-and-cloud-load-balancing"` avec Cloud Armor pour les webhooks de production. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminement du trafic sortant via le connecteur VPC. |
| `enable_iap` | `false` | Exiger une connexion Google. Fortement recommandé en production. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `NODE_RED_CREDENTIAL_SECRET` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_rotation_period` | `2592000s` | Période de notification de rotation de Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes NFS automatiques (UTC). Laissez vide pour désactiver. |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto)_ | Instance NFS existante / nom de base d'une instance créée à la volée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_*` | désactivé | Sans objet pour Node-RED ; conservé pour la compatibilité de l'API. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + le WAF Cloud Armor. `application_domains` est facultatif — un certificat `nip.io` est dérivé s'il n'est pas défini. |
| `application_domains` | `[]` | Noms d'hôte personnalisés avec SSL géré par Google. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. Nécessite `enable_cloud_armor = true`. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour le répertoire `/data` de Node-RED. Fortement recommandé. Nécessite gen2. |
| `nfs_mount_path` | `/data` | Doit correspondre au répertoire de données natif de Node-RED. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Secret des identifiants {#group-12--credential-secret}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_password_length` | `32` | Longueur du `NODE_RED_CREDENTIAL_SECRET` généré automatiquement (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation automatique du secret des identifiants. La rotation de la clé rend illisibles les identifiants de flux existants. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer le service. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Node-RED ne nécessite aucun job d'initialisation. Fournissez des jobs personnalisés pour les imports de flux ou les installations de palette. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 30s | Sonde HTTP sur le chemin de l'éditeur Node-RED. |
| `liveness_probe` | HTTP `/`, délai de 30s | Sonde de vivacité — redémarre le conteneur si l'éditeur ne répond pas. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Stockage du contexte dans Redis {#group-21--redis-context-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour le stockage du contexte de Node-RED. |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` (sauf si `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service Node-RED. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Sans NFS, tous les flux, identifiants et nœuds installés sont perdus à chaque redémarrage d'instance ou nouveau déploiement. |
| `NODE_RED_CREDENTIAL_SECRET` (issu de `database_password_length`) | généré automatiquement | Critique | Chiffre tous les identifiants des flux. Effectuer la rotation de la clé ou la modifier après le déploiement des flux rend les identifiants existants définitivement illisibles. |
| `enable_auto_password_rotation` | `false` | Critique | La rotation automatique modifie la clé de chiffrement ; tous les identifiants de flux stockés deviennent inaccessibles. Ne l'activez qu'avec une procédure de rechiffrement en place. |
| `application_name` | défini une seule fois | Critique | Immuable après le premier déploiement ; le renommer recrée toutes les ressources GCP et déconnecte le partage NFS. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job de restauration. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2 ; utiliser gen1 provoque des échecs de montage et des erreurs au démarrage du conteneur. |
| `max_instance_count` | `1` | Élevé | Node-RED n'est pas conçu pour une mise à l'échelle active-active. Plusieurs instances sans contexte partagé produisent des états contradictoires. |
| `min_instance_count` | `1` pour les webhooks | Élevé | La mise à l'échelle à zéro provoque des démarrages à froid de 10–20 secondes ; les webhooks déclenchés pendant le remontage NFS sont perdus. |
| `nfs_mount_path` | `/data` | Élevé | Doit correspondre au répertoire de données natif de Node-RED. Le modifier redirige les écritures vers un stockage éphémère. |
| `database_type` | `NONE` | Élevé | La définir sur `MYSQL` ou `POSTGRES` provisionne un sidecar Cloud SQL inutile. |
| `enable_redis` sans `redis_host` | définir `redis_host` explicitement | Élevé | Sans repli sur NFS, un hôte Redis vide provoque des échecs du stockage du contexte. |
| `enable_iap` | `true` en production | Élevé | L'éditeur donne accès à l'édition complète des flux et à la gestion des identifiants ; il ne doit pas être accessible publiquement. |
| `ingress_settings` | `internal-and-cloud-load-balancing` en production | Moyen | `"internal"` bloque tous les webhooks externes ; `"all"` expose directement le service sans WAF. |
| `memory_limit` | `1Gi` | Moyen | Les flux qui traitent des charges utiles volumineuses ou utilisent des nœuds de traitement d'images peuvent nécessiter `2Gi`. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Node-RED, partagée avec la variante GKE, est décrite dans
**[NodeRED_Common](NodeRED_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NodeRED sur Cloud Run](../labs/NodeRED_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Node-RED sur GKE Autopilot](NodeRED_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [NodeRED Common — Configuration applicative partagée](NodeRED_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [n8n sur Google Cloud Run](N8N_CloudRun.md), [Activepieces sur Google Cloud Run](Activepieces_CloudRun.md), [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md), [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) dans la solution **Workflow Automation Hub**.
