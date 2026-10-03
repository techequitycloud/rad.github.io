---
title: "Komga sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Komga sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Komga_CloudRun.md @ 15fd4c7 sha256:7c5eb37f5e21 -->

# Komga sur Google Cloud Run {#komga-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_CloudRun.png" alt="Komga sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga est un serveur multimédia gratuit, open-source et auto-hébergé pour les
collections de bandes dessinées, de mangas et de livres numériques (Kotlin/Java,
Spring Boot). Il offre une interface de lecture web épurée, des flux OPDS, des
collections, des listes de lecture et une recherche en texte intégral dans votre
bibliothèque. Ce module déploie Komga sur **Cloud Run v2** sur la base de
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Komga et sur la
manière de les explorer et de les utiliser à partir de la console Google Cloud
et de la ligne de commande. Pour les mécanismes communs à toutes les
applications Cloud Run — identité de service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Komga s'exécute comme un conteneur JVM unique sur Cloud Run v2. Le déploiement
relie un ensemble minimal de services Google Cloud — il n'y a pas de base de
données externe :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur JVM (Spring Boot), 1 vCPU / 1 GiB par défaut ; instance unique |
| Base de données | Aucune | Komga utilise une base de données SQLite embarquée sous `/config` — aucune instance Cloud SQL n'est créée |
| Stockage partagé | Filestore (NFS) | Monté à `/config` (`enable_nfs = true`) ; contient les bases de données SQLite et l'index |
| Stockage d'objets | Cloud Storage | Un bucket `storage`, monté à `/config` via GCS FUSE uniquement si NFS n'est pas |
| Secrets | Secret Manager | Aucun généré — Komga n'a pas de secret de service injectable |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Komga stocke son index de bibliothèque,
  ses utilisateurs, sa progression de lecture et ses paramètres dans une base de
  données SQLite embarquée — confirmé via le problème amont #1327 (demande de
  fonctionnalité ouverte et non implémentée pour le support d'une base de
  données externe). `database_type = "NONE"`.
- **Image officielle pré-construite.** `container_image_source = "prebuilt"` déploie
  `gotson/komga` directement — pas d'étape Cloud Build. `enable_image_mirroring = true`
  la met en miroir dans Artifact Registry (copie sensible au digest) pour éviter
  les limites de débit de Docker Hub.
- **Instance unique uniquement.** `min_instance_count = 1` et `max_instance_count = 1` —
  Komga sert une bibliothèque SQLite partagée à partir d'un seul volume ; ne pas
  dépasser 1 instance.
- **`/config` est la source unique de vérité.** La base de données SQLite
  (`database.sqlite`, mode WAL), l'index de recherche Lucene, le cache de vignettes et la
  file d'attente des tâches vivent tous sous `/config` (défini via le
  `KOMGA_CONFIGDIR` de l'image), sauvegardés par le partage NFS sur Cloud Run.
- **Pas de secrets générés.** Le compte administrateur est créé
  interactivement via l'assistant de configuration de première exécution de
  Komga à `/` — il n'y a pas de clé maîtresse ou de secret JWT à
  amorcer à l'avance.
- **Le point de terminaison de santé est `/actuator/health`.** Confirmé via des tests de
  conteneur locaux pour retourner `200 {"status":"UP"}` non authentifié. Le chemin
  versionné `/api/v1/actuator/health` est protégé par authentification (401) — ne pas y
  pointer les sondes.
- **Le dimensionnement du tas JVM est optionnel.** `jvm_heap_max` (vide par défaut)
  définit `-Xmx` via `JAVA_TOOL_OPTIONS` ; laisser vide pour laisser
  l'ergonomie JVM dimensionner le tas par rapport à `memory_limit`.
- **`/config` ne doit pas être sur GCS FUSE.** gcsfuse ne dispose pas du
  verrouillage de fichiers et du fichier de mémoire partagée dont le mode WAL de
  SQLite a besoin, et les deux bases de données y sont perdues. La valeur par
  défaut maintient `/config` sur NFS ; les propres vérifications de démarrage de
  Komga refusent une base de données sur tout système de fichiers réseau (elles
  testent le type de système de fichiers, pas si le verrouillage fonctionne) ;
  le module définit `KOMGA_DATABASE_CHECKLOCALFILESYSTEM` et `KOMGA_TASKSDB_CHECKLOCALFILESYSTEM` à `false`
  uniquement lorsque `/config` est sur NFS. `Komga_GKE` utilise un PVC de
  bloc à la place.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms des services et des ressources sont indiqués dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Komga {#a-cloud-run--the-komga-service}

Komga s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — l'état persistant de Komga {#b-cloud-storage--komgas-persistent-state}

Par défaut, `/config` est le partage **Filestore (NFS)** (`enable_nfs = true`,
`nfs_mount_path = "/config"`). Il contient les bases de données SQLite embarquées, l'index de
recherche Lucene, le cache de vignettes et les journaux — tout ce que Komga
persiste. Un bucket `storage` est également créé ; il est monté à
`/config` via GCS FUSE uniquement si NFS est désactivé ou monté ailleurs,
et cette configuration ne conserve pas les bases de données SQLite.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Komga n'a pas de secret de service généré — le compte administrateur est créé
via l'assistant de configuration web. Secret Manager ne contient que les
entrées que vous ajoutez vous-même via `secret_environment_variables`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Komga {#3-komga-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` — Komga exécute ses propres migrations de schéma Flyway
  contre la base de données SQLite embarquée au premier démarrage (confirmé via
  les journaux de conteneurs locaux : `org.flywaydb.core.FlywayExecutor`, `Successfully validated 90 migrations`).
- **Assistant de configuration de première exécution.** Ouvrez l'URL du service
  et complétez l'assistant de configuration à `/` pour créer
  l'utilisateur administrateur initial — il n'y a pas de credential amorcé et
  pas de chemin API/CLI pour en créer un de manière non interactive.
- **Ajouter une bibliothèque après la première connexion.** Une fois connecté,
  ajoutez une "bibliothèque" pointant vers un chemin multimédia monté (voir
  `gcs_volumes` pour un stockage supplémentaire de bandes dessinées/livres en
  lecture seule) et déclenchez une analyse. Il s'agit d'une étape manuelle de
  l'opérateur ; aucun job d'initialisation ne l'amorce.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/actuator/health` (non authentifié, `200 {"status":"UP"}` une fois prêt). N'utilisez
  **pas** `/api/v1/actuator/health` — confirmé via des tests locaux pour retourner
  `401
  Unauthorized` même lorsque l'application est entièrement saine.
- **Bibliothèque partagée unique, instance unique.** La base de données SQLite
  de Komga est un fichier unique sur un volume monté — l'exécution de plus d'une
  instance risque de corrompre la base de données par des écritures
  concurrentes. Maintenez `max_instance_count = 1`.
- **Dimensionnement du tas JVM.** Aucun plancher de mémoire officiel n'est
  documenté en amont ; le module définit `memory_limit = 1Gi` de manière
  conservative. Pour les très grandes bibliothèques (index Lucene lourd + cache
  de vignettes), augmentez `memory_limit` et définissez éventuellement
  `jvm_heap_max` pour limiter explicitement le `-Xmx` de la JVM.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Komga sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `komga` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Komga` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image, transmis directement comme tag `gotson/komga`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `gotson/komga` — pas d'étape de build. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmenter pour les très grandes bibliothèques. |
| `min_instance_count` | `1` | Maintenir à `1` pour éviter les démarrages à froid pendant la reconstruction de l'index Lucene au démarrage. |
| `max_instance_count` | `1` | **Ne pas augmenter** — Komga sert une bibliothèque SQLite partagée. |
| `container_port` | `25600` | Port HTTP par défaut de Komga. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Komga n'a pas de Cloud SQL — maintenir `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Komga dans Artifact Registry. |
| `jvm_heap_max` | `""` | JVM `-Xmx` optionnel via `JAVA_TOOL_OPTIONS` (par exemple `"512m"`, `"1g"`). |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface utilisateur de lecture. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'authentification propre de Komga. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Non applicable — Komga n'a pas de base de données SQL. `enable_custom_sql_scripts` et les
variables associées sont déclarées uniquement pour la parité de convention.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Provisionne une instance Cloud Filestore (NFS) montée dans le service. Nécessite l'environnement d'exécution gen2. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse supplémentaires — par exemple, un bucket de bibliothèque de bandes dessinées/livres séparé en lecture seule, monté en lecture seule. Le bucket `storage` est monté à `/config` uniquement lorsque NFS n'est pas. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Non applicable — `database_type` est fixé à `NONE`. Toutes les variables
liées à la base de données sont déclarées pour la parité de convention et
transmises à la fondation sans effet.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga n'a pas besoin de job d'initialisation par défaut. |
| `cron_jobs` | `[]` | Jobs Cloud Scheduler + Cloud Run planifiés, par exemple pour les tâches de maintenance de bibliothèque. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/actuator/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/actuator/health` | Sonde structurée alternative. |
| `health_check_config` | HTTP `/actuator/health` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/actuator/health" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `komga_url` | URL VPC interne pour le service (uniquement accessible à l'intérieur du VPC lorsque `ingress_settings = "internal"`). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `initialization_jobs` | Noms des jobs de configuration (vides par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification. La
> plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critique | Plusieurs instances écrivant simultanément le même fichier SQLite risquent de corrompre la base de données. |
| Chemin de la sonde de santé | `/actuator/health` | Critique | `/api/v1/actuator/health` est protégé par authentification (401) — l'utiliser comme chemin de sonde signifie que la révision/le pod ne devient jamais prêt même si Komga est entièrement sain. |
| `enable_nfs` / `nfs_mount_path` | `true` / `/config` | Critique | Déplacer `/config` hors de NFS le place sur GCS FUSE (ou un disque éphémère), où les bases de données SQLite ne sont pas persistantes. |
| Assistant de configuration de première exécution | Compléter rapidement après le déploiement | Élevé | Un assistant de configuration non réclamé laisse l'instance sans compte administrateur ; toute personne qui atteint l'URL en premier peut le réclamer. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid, y compris une reconstruction de l'index Lucene à chaque démarrage à froid. |
| `memory_limit` | `1Gi`, augmenter pour les grandes bibliothèques | Moyen | Une mémoire sous-dimensionnée peut provoquer un OOM-kill lors d'une analyse de grande bibliothèque (index Lucene + cache de vignettes conservés dans le tas JVM). |
| `container_image_source` | `prebuilt` | Moyen | Passer à `custom` sans Dockerfile dans `Komga_Common/scripts` fait échouer le build — Komga n'a pas besoin de build personnalisé. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Komga partagée avec la variante GKE est décrite dans
**[Komga_Common](Komga_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : Komga sur Cloud Run](../labs/Komga_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Komga sur GKE Autopilot](Komga_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Komga Common — Configuration d'application partagée](Komga_Common.md) — la configuration partagée par les deux cibles de déploiement.
