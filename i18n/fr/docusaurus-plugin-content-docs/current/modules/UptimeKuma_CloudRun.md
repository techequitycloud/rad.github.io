---
title: "Uptime Kuma sur Google Cloud Run"
description: "Référence de configuration pour déployer Uptime Kuma sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/UptimeKuma_CloudRun.md @ 3055034 sha256:ce5780a580d9 -->

# Uptime Kuma sur Google Cloud Run {#uptime-kuma-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_CloudRun.png" alt="Uptime Kuma sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma est un outil de supervision auto-hébergé et élégant qui suit la disponibilité des sites web, des API, des ports TCP, des enregistrements DNS et bien plus, avec un tableau de bord épuré, des pages de statut et plus de 90 canaux de notification. Ce module déploie Uptime Kuma sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Uptime Kuma et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Uptime Kuma s'exécute sous forme de conteneur Node.js sur Cloud Run v2. C'est l'un des modules les plus simples du catalogue — il n'y a ni base de données externe, ni cache, ni secret applicatif. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 MiB par défaut, **CPU toujours allouée** |
| État persistant | Filestore (NFS) | Base de données SQLite intégrée et fichiers téléversés sous `/app/data` (gen2 requis) |
| Image de conteneur | Artifact Registry | Build Cloud Build personnalisé (`container_image_source = "custom"`) — une fine couche `FROM louislam/uptime-kuma` qui modifie le mode de journalisation SQLite pour la sécurité sur NFS (voir ci-dessous) |
| Base de données | — | Aucune — Uptime Kuma v1 utilise SQLite intégré ; `database_type = "NONE"` |
| Cache | — | Aucun — Redis n'est pas requis (`enable_redis = false`) |
| Secrets | Secret Manager | Aucun secret applicatif (`secret_ids = {}`) ; les identifiants administrateur sont stockés dans SQLite |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **`cpu_always_allocated = true` est la valeur par défaut, et c'est délibéré — la boucle de supervision EST le produit.** Uptime Kuma interroge ses moniteurs à partir d'un planificateur interne au processus, **sans aucune requête entrante**. Avec la facturation à la requête de Cloud Run, la CPU est bridée quasiment à zéro entre les requêtes, si bien que les vérifications se bloqueraient ou se déclencheraient en retard. La CPU facturée à l'instance (toujours allouée) maintient le planificateur à pleine vitesse tant qu'une instance est active. Ne la définissez pas sur `false`.
- **`min_instance_count` vaut `0` par défaut** — le service peut descendre à zéro lorsque rien ne maintient une instance active, et **la supervision est suspendue tant qu'il est à zéro**. Pour une véritable supervision 24 h/24 et 7 j/7, définissez `min_instance_count = 1` (une seule instance toujours active).
- **Pas de base de données externe.** `database_type = "NONE"`, `enable_cloudsql_volume = false`, et il n'y a pas de job `db-init`. Uptime Kuma crée automatiquement son schéma SQLite intégré au premier démarrage.
- **La persistance NFS est obligatoire.** `enable_nfs = true` avec `nfs_mount_path = "/app/data"` monte un volume Filestore (NFS) contenant la base de données SQLite et les fichiers téléversés, afin que les moniteurs et l'historique survivent aux redémarrages et aux révisions. Nécessite l'environnement d'exécution gen2.
- **SQLite à écrivain unique.** SQLite sur NFS repose sur le verrouillage de fichiers ; exécutez une **seule instance** en production (`max_instance_count = 1`). La valeur par défaut du module est `max_instance_count = 3` pour absorber les pics sur le tableau de bord — réduisez-la en production.
- **Le build personnalisé modifie SQLite pour la sécurité sur NFS.** `container_image_source = "custom"` est la valeur par défaut — ne la remplacez pas par `"prebuilt"`. Uptime Kuma définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans `server/database.js`, non configurable par variable d'environnement) ; WAL repose sur un verrouillage par plages d'octets en mémoire partagée entre le fichier de base de données et son fichier annexe `-wal`, que le volume `/app/data` adossé à NFS ne fournit pas de manière fiable, ce qui a provoqué des erreurs `SQLITE_CORRUPT` constatées. L'étape Cloud Build (`UptimeKuma_Common/scripts/Dockerfile`) modifie ce PRAGMA dans le code source pour passer en mode `DELETE`, qui n'a besoin que du verrouillage standard du fichier entier, que NFS gère correctement. `enable_image_mirroring = true` pousse en outre l'image construite dans Artifact Registry afin d'éviter les limites de débit de Docker Hub.
- **Aucun secret applicatif** — il n'y a rien à injecter depuis Secret Manager. Le compte administrateur est créé de manière interactive lors du premier accès.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms des services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Uptime Kuma {#a-cloud-run--the-uptime-kuma-service}

Uptime Kuma s'exécute comme un service Cloud Run v2 avec une CPU toujours allouée, afin que son planificateur de vérifications en arrière-plan continue d'interroger les cibles entre les requêtes. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Filestore (NFS) — le volume de données persistant {#b-filestore-nfs--the-persistent-data-volume}

Tout l'état d'Uptime Kuma — la base de données SQLite intégrée, l'historique des moniteurs, les fichiers téléversés et les paramètres (y compris l'utilisateur administrateur) — se trouve sous `/app/data`, que le module monte depuis un partage **Filestore (NFS)**. Sans lui, tout est perdu au redémarrage. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de montage NFS et CMEK.

### C. Artifact Registry — l'image dupliquée {#c-artifact-registry--the-mirrored-image}

Avec `container_image_source = "custom"` (la valeur par défaut), une étape Cloud Build construit une fine image personnalisée `FROM louislam/uptime-kuma`, en appliquant un correctif au code source qui fait passer le `journal_mode` SQLite codé en dur de `WAL` à `DELETE` — le verrouillage en mémoire partagée de WAL n'est pas sûr sur le volume `/app/data` adossé à NFS (voir la [Vue d'ensemble](#1-overview)). Avec `enable_image_mirroring = true` (la valeur par défaut), l'image construite est ensuite poussée dans l'Artifact Registry du projet, ce qui protège les déploiements des limites de débit et des pannes de Docker Hub.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo>
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité. Notez qu'Uptime Kuma établit aussi des connexions **sortantes** — chaque vérification de moniteur est un appel sortant depuis le conteneur.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option. Eh oui — vous pouvez diriger un test de disponibilité Google Cloud vers votre instance Uptime Kuma pour superviser le superviseur.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Uptime Kuma {#3-uptime-kuma-application-behaviour}

- **Aucun job d'initialisation.** Uptime Kuma crée automatiquement son schéma SQLite intégré au premier démarrage ; il n'existe aucun job `db-init` ni de migration, et `initialization_jobs` vaut `[]` par défaut.
- **Configuration au premier lancement.** Lors du premier accès, Uptime Kuma présente une page de configuration qui vous demande de créer le compte administrateur — aucun identifiant par défaut n'est intégré à l'image. Le compte est stocké dans SQLite sur le volume NFS, il persiste donc d'une révision à l'autre.
- **Le planificateur de vérifications s'exécute dans le processus.** L'interrogation des moniteurs, les nouvelles tentatives et l'envoi des notifications s'exécutent tous dans le processus Node.js, pilotés par des minuteurs — et non par des requêtes HTTP entrantes. C'est pourquoi `cpu_always_allocated = true` est la valeur par défaut, et pourquoi une supervision continue exige en outre qu'une instance soit en cours d'exécution (`min_instance_count = 1`).
- **La mise à l'échelle à zéro suspend la supervision.** Avec la valeur par défaut `min_instance_count = 0`, Cloud Run arrête la dernière instance lorsqu'elle devient inactive. Tant que le service est à zéro, aucune vérification ne s'exécute et aucune alerte ne se déclenche ; l'interrogation reprend lorsque la requête suivante (par exemple l'ouverture du tableau de bord) démarre une instance à froid. C'est acceptable pour un usage occasionnel ou de lab, mais inadapté à une supervision de production.
- **SQLite à écrivain unique.** SQLite est une base de données à écrivain unique. Plusieurs instances simultanées écrivant dans le même fichier SQLite via NFS risquent des conflits de verrouillage ou une corruption — conservez `max_instance_count = 1` en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` sur le port `3001`, qui renvoie HTTP 200 une fois l'application démarrée. La sonde de démarrage autorise un délai initial allant jusqu'à 30 s, plus 30 échecs à intervalles de 10 s.
- **Vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~uptimekuma" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Uptime Kuma ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de supervision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `1` | Tag de l'image Uptime Kuma — la branche stable v1 (SQLite intégré). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit via Cloud Build une fine image personnalisée qui fait passer le `journal_mode` codé en dur de SQLite de `WAL` à `DELETE` pour la sécurité sur NFS (voir la Vue d'ensemble). Conservez `custom`. |
| `container_image` | `louislam/uptime-kuma` | Image officielle en amont, dupliquée dans Artifact Registry. |
| `enable_image_mirroring` | `true` | Copie l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Largement suffisant pour des dizaines de moniteurs ; augmentez la mémoire pour un très grand nombre de moniteurs. |
| `min_instance_count` | `0` | **Définissez `1` pour une supervision 24 h/24 et 7 j/7** — tant que le service est à zéro, aucune vérification ne s'exécute. |
| `max_instance_count` | `1` | **Conservez `1`** — SQLite est à écrivain unique, une seconde instance corrompt donc la base de données (voir les pièges). |
| `cpu_always_allocated` | `true` | **Conservez `true`.** Le planificateur de vérifications interne au processus a besoin de CPU entre les requêtes ; la facturation à la requête la bride à ~0 et les vérifications se bloquent. |
| `container_port` | `3001` | Port natif d'Uptime Kuma. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_cloudsql_volume` | `false` | Inutilisé — pas de base de données externe. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Les pages de statut publiques nécessitent une entrée publique ; utilisez IAP/`internal` pour des tableaux de bord privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine le trafic vers les plages privées via le VPC (nécessaire pour superviser des cibles internes). Définissez `ALL_TRAFFIC` pour acheminer toutes les sondes des moniteurs via le VPC (par exemple pour une IP de sortie NAT stable, ou si les sondes publiques échouent). |
| `enable_iap` | `false` | Place le tableau de bord derrière l'identité Google s'il ne doit pas être public. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Obligatoire.** Provisionne le partage Filestore qui contient tout l'état d'Uptime Kuma. |
| `nfs_mount_path` | `/app/data` | **Doit rester `/app/data`** — le répertoire de données accessible en écriture d'Uptime Kuma. |
| `storage_buckets` / `gcs_volumes` | `[]` | Inutile — aucun stockage GCS n'est utilisé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Back-end de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixé par conception** — Uptime Kuma v1 utilise SQLite intégré ; aucun Cloud SQL n'est provisionné. |
| `application_database_name` / `application_database_user` | `uptimekuma` | Déclarées pour respecter la convention ; inutilisées. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun n'est nécessaire — le schéma SQLite est créé au premier démarrage. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 30 s, 30 échecs | Transmise via `UptimeKuma_Common`. |
| `liveness_probe` | HTTP `/`, délai de 30 s, 3 échecs | Transmise via `UptimeKuma_Common`. |
| `uptime_check_config` | `enabled = false` | Test de disponibilité Cloud Monitoring facultatif sur `/` — la supervision du superviseur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Uptime Kuma n'utilise pas Redis ; laissez-le désactivé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC. |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Vides/non définies — aucun Cloud SQL n'est provisionné (`database_type = "NONE"`). |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` / `artifact_registry_repository` | État du CI/CD, déclencheur de build et détails du registre. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `cpu_always_allocated` | `true` (par défaut) | Critical | La facturation à la requête bride la CPU à ~0 entre les requêtes — le planificateur de vérifications interne au processus se bloque, les vérifications se déclenchent en retard ou pas du tout, et des alertes sont manquées. La boucle de supervision EST le produit. |
| `enable_nfs` | `true` (par défaut) | Critical | Sans le volume NFS, la base de données SQLite (moniteurs, historique, compte administrateur) réside sur un disque éphémère et est effacée à chaque redémarrage ou nouvelle révision. |
| `nfs_mount_path` | `/app/data` (par défaut) | Critical | Tout autre chemin conduit Uptime Kuma à écrire sur un stockage éphémère — perte totale et silencieuse des données au redémarrage. |
| `min_instance_count` | `1` pour une supervision de production | Critical | Avec la valeur par défaut `0`, le service descend à zéro lorsqu'il est inactif et **aucune vérification ne s'exécute pendant qu'il est arrêté** — les pannes des systèmes supervisés passent inaperçues. |
| `max_instance_count` | `1` en production | High | SQLite est à écrivain unique ; plusieurs instances écrivant via NFS risquent des conflits de verrouillage ou une corruption de la base de données. |
| `container_port` | `3001` (par défaut) | Critical | Un port différent du port natif d'Uptime Kuma fait échouer toutes les sondes de santé, et la révision ne devient jamais prête. |
| `database_type` | `NONE` (par défaut) | High | Provisionner Cloud SQL est un gaspillage d'argent — Uptime Kuma v1 ne peut pas l'utiliser. |
| `execution_environment` | `gen2` (par défaut) | High | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `vpc_egress_setting` | selon la portée des cibles | Medium | `PRIVATE_RANGES_ONLY` n'achemine via le VPC que les sondes vers des plages privées ; définissez `ALL_TRAFFIC` si les sondes des moniteurs vers des cibles externes ont besoin d'une sortie VPC/NAT. |
| `enable_iap` / `ingress_settings` | IAP ou `internal` pour des tableaux de bord privés | Medium | Sinon, le tableau de bord (et la page de configuration, au premier déploiement) est accessible publiquement à l'URL `run.app`. Effectuez la configuration administrateur initiale immédiatement après le déploiement. |
| `enable_image_mirroring` | `true` (par défaut) | Low | Les téléchargements directs depuis Docker Hub peuvent atteindre les limites de débit et faire échouer les déploiements. |
| `container_image_source` | `custom` (par défaut) | Critical | Définir `"prebuilt"` ignore l'étape Cloud Build et déploie l'image en amont non corrigée — Uptime Kuma écrit alors SQLite en mode WAL sur NFS, ce qui a provoqué des corruptions de base de données `SQLITE_CORRUPT` constatées. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Uptime Kuma partagée avec la variante GKE est décrite dans **[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Uptime Kuma sur Cloud Run](../labs/UptimeKuma_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Uptime Kuma sur GKE Autopilot](UptimeKuma_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Uptime Kuma Common — Configuration applicative partagée](UptimeKuma_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observability & On-call**.
