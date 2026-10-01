---
title: "Komga sur Google Cloud Run"
description: "Référence de configuration pour déployer Komga sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Komga_CloudRun.md @ 3055034 sha256:ef178ed6864b -->

# Komga sur Google Cloud Run {#komga-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Komga_CloudRun.png" alt="Komga sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Komga est un serveur multimédia libre, gratuit et auto-hébergé pour les collections
de bandes dessinées, de mangas et de livres numériques (Kotlin/Java, Spring Boot).
Il offre une interface web de lecture épurée, des flux OPDS, des collections, des
listes de lecture et une recherche en texte intégral dans votre bibliothèque. Ce
module déploie Komga sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Komga et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Komga s'exécute comme un unique conteneur JVM sur Cloud Run v2. Le déploiement
assemble un ensemble minimal de services Google Cloud — il n'y a pas de base de
données externe :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur JVM (Spring Boot), 1 vCPU / 1 GiB par défaut ; instance unique |
| Base de données | Aucune | Komga utilise une base de données SQLite intégrée sous `/config` — aucune instance Cloud SQL n'est créée |
| Stockage objet | Cloud Storage | Un bucket `storage` dédié, monté sur `/config` via GCS FUSE |
| Secrets | Secret Manager | Aucun généré — Komga n'a aucun secret de service injectable |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Komga stocke l'index de sa bibliothèque, les
  utilisateurs, la progression de lecture et les paramètres dans une base de données
  SQLite intégrée — confirmé par l'issue amont #1327 (demande de fonctionnalité
  ouverte et non implémentée pour la prise en charge d'une base externe).
  `database_type = "NONE"`.
- **Image précompilée officielle.** `container_image_source = "prebuilt"` déploie
  directement `gotson/komga` — sans étape Cloud Build. `enable_image_mirroring = true`
  la met en miroir dans Artifact Registry (copie tenant compte du digest) pour éviter les
  limites de débit de Docker Hub.
- **Instance unique uniquement.** `min_instance_count = 1` et
  `max_instance_count = 1` — Komga sert une seule bibliothèque SQLite partagée depuis
  un seul volume ; ne dépassez pas 1.
- **`/config` est la source de vérité unique.** La base de données SQLite
  (`database.sqlite`, mode WAL), l'index de recherche Lucene, le cache des vignettes
  et la file de tâches se trouvent tous sous `/config` (défini via la variable
  `KOMGA_CONFIGDIR` de l'image), adossé sur Cloud Run à un bucket Cloud Storage monté
  via GCS FUSE.
- **Aucun secret généré.** Le compte administrateur est créé de manière interactive
  via l'assistant de configuration initiale de Komga sur `/` — il n'y a ni clé
  maîtresse ni secret JWT à initialiser à l'avance.
- **Le point de terminaison de santé est `/actuator/health`.** Des tests locaux du
  conteneur ont confirmé qu'il renvoie `200 {"status":"UP"}` sans authentification.
  Le chemin versionné `/api/v1/actuator/health` exige une authentification (401) —
  n'y pointez pas les sondes.
- **Le dimensionnement du heap JVM est facultatif.** `jvm_heap_max` (vide par
  défaut) définit `-Xmx` via `JAVA_TOOL_OPTIONS` ; laissez-le vide pour que
  l'ergonomie de la JVM dimensionne le heap en fonction de `memory_limit`.
- **GCS FUSE a une latence réelle pour SQLite.** Pour des bibliothèques plus
  lourdes ou de production, préférez `Komga_GKE`, qui peut monter à la place un
  véritable PVC en mode bloc.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Komga {#a-cloud-run--the-komga-service}

Komga s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — l'état persistant de Komga {#b-cloud-storage--komgas-persistent-state}

Un bucket **Cloud Storage** dédié est monté sur `/config` via GCS FUSE. Il contient
la base de données SQLite intégrée, l'index de recherche Lucene, le cache des
vignettes et les journaux — tout ce que Komga conserve.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Secret Manager {#c-secret-manager}

Komga n'a aucun secret de service généré — le compte administrateur est créé via
l'assistant de configuration web. Secret Manager ne contient que les entrées que
vous ajoutez vous-même via `secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~komga"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut s'y
ajouter.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Komga {#3-komga-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a pas
  de job `db-init` — Komga exécute ses propres migrations de schéma Flyway sur la
  base SQLite intégrée au premier démarrage (confirmé par les journaux locaux du
  conteneur : `org.flywaydb.core.FlywayExecutor`,
  `Successfully validated 90 migrations`).
- **Assistant de configuration initiale.** Ouvrez l'URL du service et terminez
  l'assistant de configuration sur `/` pour créer l'utilisateur administrateur
  initial — il n'y a aucun identifiant pré-créé et aucun moyen par API ou CLI d'en
  créer un de manière non interactive.
- **Ajoutez une bibliothèque après la première connexion.** Une fois connecté,
  ajoutez une « bibliothèque » pointant vers un chemin multimédia monté (voir
  `gcs_volumes` pour un stockage supplémentaire de BD/livres principalement en
  lecture) et lancez une analyse. C'est une étape manuelle de l'opérateur ; aucun
  job d'initialisation ne la prépare.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/actuator/health` (sans authentification, `200 {"status":"UP"}` une fois prêt).
  N'utilisez **pas** `/api/v1/actuator/health` — des tests locaux ont confirmé qu'il
  renvoie `401
  Unauthorized` même lorsque l'application est entièrement saine.
- **Bibliothèque partagée unique, instance unique.** La base SQLite de Komga est un
  fichier unique sur un seul volume monté — exécuter plus d'une instance expose à
  sa corruption par des écritures concurrentes. Conservez `max_instance_count = 1`.
- **Dimensionnement du heap JVM.** Aucun plancher de mémoire officiel n'est
  documenté en amont ; le module fixe par prudence `memory_limit = 1Gi` par défaut.
  Pour de très grandes bibliothèques (index Lucene volumineux + cache des
  vignettes), augmentez `memory_limit` et définissez éventuellement `jvm_heap_max`
  pour borner explicitement le `-Xmx` de la JVM.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Komga ou notables pour Komga sont
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
| `application_name` | `komga` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Komga` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image, transmis tel quel comme tag de `gotson/komga`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `gotson/komga` — sans étape de build. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; à augmenter pour de très grandes bibliothèques. |
| `min_instance_count` | `1` | Conservez `1` pour éviter les démarrages à froid pendant la reconstruction de l'index Lucene au démarrage. |
| `max_instance_count` | `1` | **Ne pas augmenter** — Komga sert une seule bibliothèque SQLite partagée. |
| `container_port` | `25600` | Port HTTP par défaut de Komga. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Komga n'a pas de Cloud SQL — conservez `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Komga dans Artifact Registry. |
| `jvm_heap_max` | `""` | `-Xmx` facultatif de la JVM via `JAVA_TOOL_OPTIONS` (par ex. `"512m"`, `"1g"`). |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclarée pour la cohérence des conventions ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface de lecture. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google en amont de l'authentification propre de Komga. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Sans objet — Komga n'a pas de base de données SQL. `enable_custom_sql_scripts` et
les variables associées ne sont déclarées que pour la cohérence des conventions.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé par défaut. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires — par ex. un bucket de bibliothèque de BD/livres distinct, principalement en lecture, monté en lecture seule. Le bucket `storage` est ajouté automatiquement sur `/config`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

Sans objet — `database_type` est fixé à `NONE`. Toutes les variables liées à la base
de données sont déclarées pour la cohérence des conventions et transmises au socle
sans effet.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Komga n'a besoin d'aucun job d'initialisation par défaut. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs planifiés, par ex. pour des tâches de maintenance de la bibliothèque. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/actuator/health`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/actuator/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/actuator/health` | Sonde structurée alternative. |
| `health_check_config` | HTTP `/actuator/health` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/actuator/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `komga_url` | URL VPC interne du service (joignable uniquement depuis le VPC lorsque `ingress_settings = "internal"`). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs de configuration (vide par défaut). |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. La plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critique | Plusieurs instances écrivant simultanément dans le même fichier SQLite exposent à une corruption de la base. |
| Chemin de la sonde de santé | `/actuator/health` | Critique | `/api/v1/actuator/health` exige une authentification (401) — l'utiliser comme chemin de sonde signifie que la révision/le pod ne devient jamais Ready alors que Komga est entièrement sain. |
| `enable_gcs_storage_volume` (niveau Common) | `true` sur Cloud Run | Critique | Le désactiver sans montage de remplacement signifie que `/config` n'est pas persisté — tout l'état de la bibliothèque est perdu à chaque démarrage à froid. |
| Assistant de configuration initiale | À terminer rapidement après le déploiement | Élevé | Un assistant de configuration non réclamé laisse l'instance sans compte administrateur ; la première personne qui atteint l'URL peut se l'approprier. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid, y compris une reconstruction de l'index Lucene à chaque démarrage à froid. |
| `memory_limit` | `1Gi`, à augmenter pour les grandes bibliothèques | Moyen | Une mémoire sous-dimensionnée peut provoquer un arrêt OOM lors de l'analyse d'une grande bibliothèque (index Lucene + cache des vignettes conservés dans le heap JVM). |
| `container_image_source` | `prebuilt` | Moyen | Passer à `custom` sans Dockerfile dans `Komga_Common/scripts` fait échouer le build — Komga n'a besoin d'aucun build personnalisé. |
| GCS FUSE pour `/config` | Convient à un usage léger ; préférez un PVC GKE en production | Faible | Les fichiers WAL SQLite sous gcsfuse ont une latence plus élevée et une cohérence plus faible qu'un stockage en mode bloc. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Komga, partagée avec la variante GKE, est décrite dans
**[Komga_Common](Komga_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Komga sur Cloud Run](../labs/Komga_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Komga sur GKE Autopilot](Komga_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Komga Common — Configuration applicative partagée](Komga_Common.md) — la configuration partagée par les deux cibles de déploiement.
