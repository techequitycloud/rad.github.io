---
title: "Audiobookshelf sur Google Cloud Run"
description: "Référence de configuration pour déployer Audiobookshelf sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Audiobookshelf_CloudRun.md @ 3055034 sha256:55e9ee249818 -->

# Audiobookshelf sur Google Cloud Run {#audiobookshelf-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Audiobookshelf_CloudRun.png" alt="Audiobookshelf sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Audiobookshelf est un serveur auto-hébergé de livres audio et de podcasts — il organise votre bibliothèque audio, diffuse vers l'interface web et les applications mobiles officielles, et synchronise la progression d'écoute de chaque utilisateur. Ce module déploie Audiobookshelf sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Audiobookshelf et sur la façon de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Audiobookshelf s'exécute comme un conteneur Node.js sur Cloud Run v2. Fait inhabituel dans ce catalogue, il n'a besoin **d'aucune base de données externe, d'aucun Redis et d'aucun secret applicatif** — l'empreinte du déploiement est volontairement réduite :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, limité à une seule instance |
| Base de données | Aucune | Audiobookshelf embarque sa propre base de données SQLite sous `/data/config` — pas de Cloud SQL |
| État persistant | Cloud Storage (GCS FUSE) | Un bucket `storage` dédié monté sur `/data` (gen2 requis) |
| Image de conteneur | Cloud Build + Artifact Registry | Wrapper léger construit `FROM ghcr.io/advplyr/audiobookshelf` et mis en miroir dans votre registre |
| Secrets | Secret Manager | Aucun secret applicatif — l'utilisateur administrateur est créé dans l'interface web lors du premier lancement |
| Ingress | URL Cloud Run / Cloud Load Balancing | **Vaut `all` par défaut** (internet public) ; équilibreur de charge HTTPS externe facultatif |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** `database_type = "NONE"` et `enable_cloudsql_volume = false` sont fixés par `Audiobookshelf_Common` ; Audiobookshelf crée et migre sa base de données SQLite interne au premier démarrage. Aucun job `db-init` ne s'exécute.
- **Un seul montage persistant couvre tout.** `CONFIG_PATH = /data/config` (base SQLite + configuration de l'application) et `METADATA_PATH = /data/metadata` (pochettes, métadonnées en cache) sont tous deux redirigés sous `/data`, qui repose sur un bucket GCS provisionné automatiquement et monté via GCS FUSE. Perdre ce bucket, c'est perdre tout l'état d'Audiobookshelf.
- **Instance unique.** `min_instance_count = 1` et `max_instance_count = 1` — une bibliothèque SQLite partagée doit être servie par exactement un rédacteur. N'augmentez pas le maximum.
- **L'ingress vaut `all` par défaut.** L'URL `run.app` est accessible publiquement depuis un navigateur d'emblée, conformément à la valeur par défaut du socle `App_CloudRun`. Définissez `ingress_settings = "internal"` (ou placez le service derrière l'équilibreur de charge) pour restreindre l'accès au seul VPC.
- **Image personnalisée (wrapper léger).** Cloud Build encapsule l'image amont `ghcr.io/advplyr/audiobookshelf` afin qu'elle soit mise en miroir dans Artifact Registry. Le Dockerfile lit l'ARG de build propre à l'application `AUDIOBOOKSHELF_VERSION` ; `application_version = "latest"` correspond à la version épinglée `2.17.0`.
- **Aucun secret généré.** L'utilisateur **root** initial est créé de manière interactive dans l'interface web lors du premier lancement, et les jetons d'API sont émis ensuite dans l'interface — `Audiobookshelf_Common` expose des `secret_ids` vides.
- **Les sondes de santé ciblent `/healthcheck`**, le point de terminaison d'Audiobookshelf qui renvoie 200 sans authentification (démarrage : délai initial de 15 s, 10 échecs tolérés ; vivacité : délai de 30 s, 3 échecs).
- **Pas de Redis.** `enable_redis` est explicitement forcé à `false` dans l'appel au socle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Audiobookshelf {#a-cloud-run--the-audiobookshelf-service}

Audiobookshelf s'exécute comme un service Cloud Run v2 limité à une seule instance. Chaque déploiement crée une révision immuable ; le trafic bascule vers la plus récente qui est saine.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le bucket d'état `/data` {#b-cloud-storage--the-data-state-bucket}

Tout l'état d'Audiobookshelf — la base de données SQLite, la configuration de l'application, les pochettes et les métadonnées en cache — réside sous `/data`, qui repose sur un bucket **Cloud Storage** dédié (suffixe `storage`) monté dans le conteneur via **GCS FUSE**. L'environnement d'exécution gen2 est requis pour les montages FUSE. Des buckets multimédias supplémentaires (par exemple une bibliothèque de livres audio en lecture seule) peuvent être rattachés via `gcs_volumes`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  gcloud storage ls gs://<storage-bucket>/config/   # SQLite DB + app config
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Cloud Build et Artifact Registry — l'image de conteneur {#c-cloud-build--artifact-registry--the-container-image}

Le module construit une image wrapper légère `FROM ghcr.io/advplyr/audiobookshelf:${AUDIOBOOKSHELF_VERSION}` via Cloud Build et la stocke dans l'Artifact Registry du locataire, ce qui protège les déploiements des limites de débit du registre amont et épingle la version.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>/audiobookshelf" --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Audiobookshelf lui-même n'a besoin d'aucun secret injecté — il n'y a ni mot de passe de base de données, ni clé maîtresse, ni secret JWT. Secret Manager reste disponible pour les éventuelles `secret_environment_variables` personnalisées que vous ajoutez.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Par défaut `ingress_settings = "all"` — le service est accessible publiquement, conformément à la valeur par défaut du socle `App_CloudRun`. Définissez `ingress_settings = "internal"` pour restreindre le service aux appelants situés dans le VPC, ou activez l'équilibreur de charge HTTPS externe (`enable_cloud_armor`) avec un domaine personnalisé pour une configuration en frontal.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run vers Cloud Monitoring, avec un test de disponibilité facultatif (désactivé par défaut — il ne peut réussir que contre un point de terminaison accessible publiquement) et des règles d'alerte.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Audiobookshelf {#3-audiobookshelf-application-behaviour}

- **Premier démarrage autonome.** Au premier lancement, Audiobookshelf crée sa base de données SQLite et son arborescence de répertoires sous `CONFIG_PATH`/`METADATA_PATH` — aucun job d'initialisation, de migration ni provisionnement de base de données n'intervient. Comme les deux chemins se trouvent sous le montage persistant `/data`, la base de données survit aux déploiements de révisions, aux mises à niveau de version et aux événements de mise à l'échelle.
- **Assistant de configuration au premier lancement.** Ouvrez l'URL du service (`/`) — Audiobookshelf vous invite à créer de manière interactive l'utilisateur **root** initial. Il n'existe pas d'amorçage de l'administrateur par variables d'environnement ; les jetons d'API sont émis ensuite dans l'interface web.
- **Rédacteur unique.** SQLite sur un montage FUSE partagé ne tolère qu'un seul rédacteur. Le module fixe `min_instance_count = 1` / `max_instance_count = 1` ; exécuter plusieurs réplicas sur le même `/data` expose à une corruption de la base de données.
- **Point de terminaison de contrôle d'état.** `/healthcheck` renvoie HTTP 200 sans authentification dès que le serveur est prêt ; il sert à la sonde de démarrage (délai initial de 15 s, jusqu'à ~115 s de marge), à la sonde de vivacité et au test de disponibilité facultatif. L'interface web se trouve à `/`.
- **Mise en garde sur la latence de GCS FUSE.** Un serveur multimédia a idéalement besoin d'un stockage bloc pour sa base de données SQLite et ses analyses de bibliothèque. GCS FUSE convient à un usage léger à modéré ; pour des bibliothèques volumineuses ou de production, préférez `Audiobookshelf_GKE`, qui monte un véritable PVC bloc sur `/data`.
- **CLI de vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~audiobookshelf" --format="value(metadata.name)" --limit=1)
  URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" --region "$REGION" \
    --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$URL/healthcheck"   # expect 200 (ingress "all")
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Audiobookshelf ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

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

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `audiobookshelf` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image ; `latest` construit la version épinglée `2.17.0`. Modifiez-le pour déclencher un nouveau build et un nouveau déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU par instance. Les analyses de bibliothèque et le traitement des métadonnées embarquées sont gourmands en CPU — augmentez pour les imports volumineux. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmentez pour les bibliothèques volumineuses. |
| `min_instance_count` | `1` | Garde une instance active ; l'état SQLite étant sur GCS, `0` ne met pas les données en danger mais ajoute des démarrages à froid. |
| `max_instance_count` | `1` | **Laissez à 1** — une bibliothèque SQLite, un rédacteur. |
| `container_port` | `80` | Port HTTP d'Audiobookshelf (`PORT=80` est injecté en conséquence). |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE de `/data`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image amont dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut. Définissez `internal` (ou utilisez l'équilibreur de charge) pour restreindre l'interface web et les applications mobiles à un accès depuis le VPC uniquement. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionnées par-dessus les valeurs par défaut du module `CONFIG_PATH=/data/config`, `METADATA_PATH=/data/metadata`. Aucune valeur par défaut `PORT` n'est définie — Audiobookshelf écoute sur le `$PORT` injecté automatiquement par Cloud Run, et une variable d'environnement `PORT` fournie par l'utilisateur est un nom réservé que la plateforme refuse. Ne modifiez pas ces deux chemins après le premier démarrage. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager (aucun requis par Audiobookshelf). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la en production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | désactivé / `gcs` / `""` / `tar` | Restauration à partir d'une sauvegarde lors du déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts` et les paramètres associés sont **sans objet** — Audiobookshelf n'a pas de base de données SQL. Laissez-les à leurs valeurs par défaut.

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention des images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` / `application_domains` / `enable_cdn` | désactivé / `[]` / `false` | Équilibreur de charge HTTPS externe avec WAF, domaine personnalisé et CDN — la méthode recommandée pour exposer Audiobookshelf publiquement. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Règle de nettoyage d'Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `storage` de `/data` est provisionné automatiquement — laissez-le activé. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires, p. ex. un bucket de bibliothèque multimédia en lecture seule. Le bucket `storage` sur `/data` est toujours ajouté. |
| `enable_nfs` | `false` | Montage Filestore facultatif ; inutile avec l'organisation par défaut. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

`database_type` est fixé à `NONE` par `Audiobookshelf_Common` ; les autres entrées de base de données (`database_password_length`, paramètres de renouvellement, `db_*_env_var_name`) ne sont transmises que pour la compatibilité avec le socle et n'ont aucun effet.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job d'initialisation par défaut — Audiobookshelf s'initialise lui-même. Ne fournissez des jobs que pour des tâches ponctuelles personnalisées. |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, délai initial de 15 s, 10 échecs | Accorde ~115 s de marge au premier démarrage. |
| `liveness_probe` | HTTP `/healthcheck`, délai initial de 30 s, 3 échecs | Redémarre une instance bloquée. |
| `uptime_check_config` | désactivé, chemin `/healthcheck` | À activer uniquement lorsque le point de terminaison est accessible publiquement. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite des autorisations au niveau de l'organisation). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsque le déploiement réussit — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `audiobookshelf_url` | URL de l'interface web / de l'API. Accessible publiquement par défaut (`ingress_settings = "all"`) ; uniquement interne au VPC si `ingress_settings` est remplacé par `"internal"`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `storage` de `/data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Plusieurs instances écrivent dans la même base SQLite via le montage FUSE partagé — corruption de la base de données. |
| `create_cloud_storage` / le bucket `storage` | à conserver provisionné | Critique | `/data` contient *tout* l'état (base SQLite, configuration, métadonnées). Supprimer le bucket fait perdre toute la configuration de la bibliothèque. |
| Surcharges de `CONFIG_PATH` / `METADATA_PATH` | laisser les valeurs par défaut | Critique | Les modifier après le premier démarrage rend orphelines la base SQLite existante et les métadonnées en cache. |
| `container_port` | `80` | Critique | Audiobookshelf écoute sur le `$PORT` injecté automatiquement par Cloud Run, dérivé de `container_port=80` (aucune variable d'environnement `PORT` explicite n'est définie — c'est un nom réservé que Cloud Run refuse) ; un `container_port` incohérent fait échouer toutes les sondes de santé. |
| `execution_environment` | `gen2` | Élevé | Les montages GCS FUSE exigent gen2 ; gen1 ne peut pas monter le bucket `/data`. |
| `enable_backup_import` | `false` sauf en cas de restauration | Élevé | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `ingress_settings` | `all` (par défaut) / `internal` si nécessaire | Moyen | La valeur par défaut `all` est accessible publiquement ; définissez `internal` (ou ajoutez l'équilibreur de charge) uniquement si vous voulez spécifiquement restreindre le service à un accès depuis le VPC. |
| `application_version` | tag épinglé | Moyen | `latest` correspond silencieusement à la version épinglée `2.17.0` ; épinglez explicitement pour maîtriser les mises à niveau. |
| `min_instance_count` | `1` | Moyen | `0` réduit les coûts (l'état étant sur GCS, les données ne sont pas en danger) mais ajoute un démarrage à froid à la première diffusion après une période d'inactivité. |
| Taille de la bibliothèque sur GCS FUSE | bibliothèques petites/moyennes | Moyen | Les grandes bibliothèques et les analyses fréquentes pâtissent de la latence FUSE — utilisez `Audiobookshelf_GKE` (PVC bloc) pour des bibliothèques à l'échelle de la production. |
| `enable_cloudsql_volume` | `false` | Faible | Il n'existe pas de Cloud SQL ; l'activer gaspille un sidecar. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Audiobookshelf partagée avec la variante GKE est décrite dans **[Audiobookshelf_Common](Audiobookshelf_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Audiobookshelf sur Cloud Run](../labs/Audiobookshelf_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Audiobookshelf sur GKE Autopilot](Audiobookshelf_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Audiobookshelf Common — Configuration applicative partagée](Audiobookshelf_Common.md) — la configuration partagée par les deux cibles de déploiement.
