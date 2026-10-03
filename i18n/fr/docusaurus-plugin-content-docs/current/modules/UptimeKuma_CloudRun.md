---
title: "Uptime Kuma sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Uptime Kuma sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/UptimeKuma_CloudRun.md @ 15fd4c7 sha256:4473259d7434 -->

# Uptime Kuma sur Google Cloud Run {#uptime-kuma-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UptimeKuma_CloudRun.png" alt="Uptime Kuma sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Uptime Kuma est un outil de surveillance sophistiqué et auto-hébergé pour suivre la disponibilité des sites web, des API, des ports TCP, des enregistrements DNS, et plus encore, avec un tableau de bord clair, des pages d'état et plus de 90 canaux de notification. Ce module déploie Uptime Kuma sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Uptime Kuma utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Uptime Kuma s'exécute comme un conteneur Node.js sur Cloud Run v2. C'est l'un des modules les plus simples du catalogue — il n'y a pas de base de données externe, pas de cache et pas de secret d'application. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 512 Mio par défaut, **CPU toujours alloué** |
| État persistant | Filestore (NFS) | Base de données SQLite embarquée et téléchargements sous `/app/data` (gen2 requis) |
| Image de conteneur | Artifact Registry | Cloud Build personnalisé (`container_image_source = "custom"`) — une fine couche `FROM louislam/uptime-kuma` qui corrige le mode journal SQLite pour la sécurité NFS (voir ci-dessous) |
| Base de données | — | Aucune — Uptime Kuma v1 utilise SQLite embarqué ; `database_type = "NONE"` |
| Cache | — | Aucun — Redis n'est pas requis (`enable_redis = false`) |
| Secrets | Secret Manager | Pas de secrets d'application (`secret_ids = {}`) ; les identifiants d'administrateur résident dans SQLite |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **`cpu_always_allocated = true` est la valeur par défaut et est délibérée — la boucle de surveillance EST le produit.** Uptime Kuma interroge ses moniteurs à partir d'un ordonnanceur intégré sans **requête entrante**. Avec la facturation basée sur les requêtes de Cloud Run, le CPU est limité à presque zéro entre les requêtes, de sorte que les vérifications stagnent ou se déclenchent en retard. Le CPU basé sur l'instance (toujours alloué) maintient l'ordonnanceur en marche à pleine vitesse tant qu'une instance est active. Ne définissez pas cette valeur sur `false`.
- **`min_instance_count` est par défaut `1`, pas `0`** — à `0` Cloud Run supprime l'instance environ 15 minutes après la dernière requête, et **la surveillance s'arrête lorsqu'elle est mise à l'échelle à zéro**. `cpu_always_allocated` ne couvre pas cela : il régit le CPU tant qu'une instance est active, pas si elle existe. Gardez `1` pour une surveillance 24h/24 et 7j/7.
- **Pas de base de données externe.** `database_type = "NONE"`, `enable_cloudsql_volume = false`, et il n'y a pas de job `db-init`. Uptime Kuma crée son schéma SQLite embarqué automatiquement au premier démarrage.
- **La persistance NFS est obligatoire.** `enable_nfs = true` avec `nfs_mount_path = "/app/data"` monte un volume Filestore (NFS) contenant la base de données SQLite et les téléchargements, de sorte que les moniteurs et l'historique survivent aux redémarrages et aux révisions. Nécessite l'environnement d'exécution gen2.
- **SQLite à écrivain unique.** SQLite sur NFS repose sur le verrouillage de fichiers ; exécutez une **instance unique** en production (`max_instance_count = 1`). La valeur par défaut du module est `max_instance_count = 3` pour une marge de manœuvre sur le tableau de bord — abaissez-la pour la production.
- **La build personnalisée corrige SQLite pour la sécurité NFS.** `container_image_source = "custom"` est la valeur par défaut — ne la changez pas en `"prebuilt"`. Uptime Kuma définit inconditionnellement `PRAGMA journal_mode = WAL` à chaque démarrage (codé en dur dans `server/database.js`, non configurable via une variable d'environnement) ; WAL repose sur le verrouillage d'octets par plage de mémoire partagée entre le fichier DB et son fichier auxiliaire `-wal`, ce que le volume `/app/data` basé sur NFS ne fournit pas de manière fiable et a produit des erreurs `SQLITE_CORRUPT` observées. L'étape Cloud Build (`UptimeKuma_Common/scripts/Dockerfile`) corrige cette PRAGMA en mode `DELETE`, qui ne nécessite qu'un verrouillage de fichier entier standard que NFS gère correctement. `enable_image_mirroring = true` pousse en outre l'image construite via Artifact Registry pour éviter les limites de débit de Docker Hub.
- **Pas de secrets d'application** — il n'y a rien à injecter depuis Secret Manager. Le compte administrateur est créé interactivement lors du premier accès.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Uptime Kuma {#a-cloud-run--the-uptime-kuma-service}

Uptime Kuma s'exécute comme un service Cloud Run v2 avec le CPU toujours alloué afin que son ordonnanceur de vérification en arrière-plan continue d'interroger entre les requêtes. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Filestore (NFS) — le volume de données persistant {#b-filestore-nfs--the-persistent-data-volume}

Tout l'état d'Uptime Kuma — la base de données SQLite embarquée, l'historique des moniteurs, les téléchargements et les paramètres (y compris l'utilisateur administrateur) — réside sous `/app/data`, que le module monte à partir d'un partage **Filestore (NFS)**. Sans cela, tout est perdu au redémarrage. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de montage NFS et CMEK.

### C. Artifact Registry — l'image mise en miroir {#c-artifact-registry--the-mirrored-image}

Avec `container_image_source = "custom"` (la valeur par défaut), une étape Cloud Build construit une image personnalisée légère `FROM louislam/uptime-kuma`, appliquant un correctif source qui modifie le `journal_mode` SQLite codé en dur de `WAL` à `DELETE` — le verrouillage de mémoire partagée de WAL n'est pas sûr sur le volume `/app/data` basé sur NFS (voir [Vue d'ensemble](#1-overview)). Avec `enable_image_mirroring = true` (la valeur par défaut), l'image construite est ensuite poussée vers l'Artifact Registry du projet, isolant les déploiements des limites de débit et des pannes de Docker Hub.

- **Console :** Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo>
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité. Notez qu'Uptime Kuma établit également des connexions **sortantes** — chaque vérification de moniteur est un appel d'egress depuis le conteneur.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des politiques d'alerte facultatifs. Oui — vous pouvez pointer un test de disponibilité Google Cloud vers votre instance Uptime Kuma pour surveiller le moniteur.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Uptime Kuma {#3-uptime-kuma-application-behaviour}

- **Pas de jobs d'initialisation.** Uptime Kuma crée son schéma SQLite embarqué automatiquement au premier démarrage ; il n'y a pas de job `db-init` ou de migration, et `initialization_jobs` est par défaut `[]`.
- **Configuration initiale.** Lors du premier accès, Uptime Kuma présente une page de configuration vous demandant de créer le compte administrateur — il n'y a pas d'identifiants par défaut intégrés à l'image. Le compte est stocké dans SQLite sur le volume NFS, il persiste donc entre les révisions.
- **L'ordonnanceur de vérification s'exécute en interne.** L'interrogation des moniteurs, les tentatives et l'envoi des notifications s'exécutent tous dans le processus Node.js, pilotés par des minuteurs — et non par des requêtes HTTP entrantes. C'est pourquoi `cpu_always_allocated = true` est la valeur par défaut et pourquoi la surveillance continue nécessite en outre qu'une instance soit en cours d'exécution (`min_instance_count = 1`).
- **La mise à l'échelle à zéro interrompt la surveillance.** Si vous réduisez `min_instance_count` à `0`, Cloud Run arrête la dernière instance lorsqu'elle devient inactive. Lorsqu'elle est mise à l'échelle à zéro, aucune vérification n'est exécutée et aucune alerte n'est déclenchée ; l'interrogation reprend lorsque la prochaine requête (par exemple, l'ouverture du tableau de bord) démarre à froid une instance. C'est sûr pour une utilisation occasionnelle/en laboratoire, mais incorrect pour la surveillance en production.
- **SQLite à écrivain unique.** SQLite est une base de données à écrivain unique. Plusieurs instances concurrentes écrivant le même fichier SQLite sur NFS risquent des conflits de verrouillage ou une corruption — gardez `max_instance_count = 1` en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` sur le port `3001`, qui renvoie HTTP 200 une fois l'application démarrée. La sonde de démarrage autorise jusqu'à 30 secondes de délai initial plus 30 échecs à des intervalles de 10 secondes.
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

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Uptime Kuma sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `uptimekuma` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `1` | Tag de l'image Uptime Kuma — la ligne stable v1 (SQLite embarqué). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit une image personnalisée légère via Cloud Build qui corrige le `journal_mode` codé en dur de SQLite de `WAL` à `DELETE` pour la sécurité NFS (voir Vue d'ensemble). Gardez `custom`. |
| `container_image` | `louislam/uptime-kuma` | Image officielle en amont, mise en miroir dans Artifact Registry. |
| `enable_image_mirroring` | `true` | Copiez l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Amplement suffisant pour des dizaines de moniteurs ; augmentez la mémoire pour un très grand nombre de moniteurs. |
| `min_instance_count` | `1` | **Gardez `1` pour une surveillance 24h/24 et 7j/7** — lorsqu'il est mis à l'échelle à zéro, aucune vérification n'est exécutée. |
| `max_instance_count` | `1` | **Gardez à `1`** — SQLite est à écrivain unique, donc une deuxième instance corrompt la base de données (voir Pièges). |
| `cpu_always_allocated` | `true` | **Gardez `true`.** L'ordonnanceur de vérification intégré a besoin de CPU entre les requêtes ; la facturation basée sur les requêtes le limite à ~0 et les vérifications stagnent. |
| `container_port` | `3001` | Port natif d'Uptime Kuma. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_cloudsql_volume` | `false` | Inutilisé — pas de base de données externe. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Les pages d'état publiques nécessitent un ingress public ; utilisez IAP/`internal` pour les tableaux de bord privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer le trafic de la plage privée via le VPC (nécessaire pour surveiller les cibles internes). Définissez `ALL_TRAFFIC` pour acheminer toutes les sondes de moniteur via le VPC (par exemple pour une IP d'egress NAT stable ou si les sondes publiques échouent). |
| `enable_iap` | `false` | Placez le tableau de bord derrière l'identité Google s'il ne doit pas être public. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Requis.** Provisionne le partage Filestore contenant tout l'état d'Uptime Kuma. |
| `nfs_mount_path` | `/app/data` | **Doit rester `/app/data`** — le répertoire de données inscriptible d'Uptime Kuma. |
| `storage_buckets` / `gcs_volumes` | `[]` | Non nécessaire — aucun stockage GCS n'est utilisé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Fixé par conception** — Uptime Kuma v1 utilise SQLite embarqué ; aucun Cloud SQL n'est provisionné. |
| `application_database_name` / `application_database_user` | `uptimekuma` | Déclaré pour la mise en miroir de conventions ; inutilisé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun nécessaire — le schéma SQLite est créé au premier démarrage. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, 30 s de délai, 30 échecs | Transmis via `UptimeKuma_Common`. |
| `liveness_probe` | HTTP `/`, 30 s de délai, 3 échecs | Transmis via `UptimeKuma_Common`. |
| `uptime_check_config` | `enabled = false` | Test de disponibilité Cloud Monitoring facultatif contre `/` — surveillance du moniteur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Uptime Kuma n'utilise pas Redis ; laissez désactivé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Vide/non défini — aucun Cloud SQL n'est provisionné (`database_type = "NONE"`). |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vides par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` / `artifact_registry_repository` | État CI/CD, déclencheur de build et détails du registre. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `cpu_always_allocated` | `true` (par défaut) | Critique | La facturation basée sur les requêtes limite le CPU à ~0 entre les requêtes — l'ordonnanceur de vérification intégré stagne, les vérifications se déclenchent en retard ou pas du tout, et les alertes sont manquées. La boucle de surveillance EST le produit. |
| `enable_nfs` | `true` (par défaut) | Critique | Sans le volume NFS, la base de données SQLite (moniteurs, historique, compte administrateur) réside sur un disque éphémère et est effacée à chaque redémarrage ou nouvelle révision. |
| `nfs_mount_path` | `/app/data` (par défaut) | Critique | Tout autre chemin laisse Uptime Kuma écrire sur un stockage éphémère — perte totale et silencieuse de données au redémarrage. |
| `min_instance_count` | `1` (par défaut) | Critique | À `0`, le service se met à l'échelle à zéro lorsqu'il est inactif et **aucune vérification n'est exécutée lorsqu'il est arrêté** — les pannes des systèmes surveillés passent inaperçues. |
| `max_instance_count` | `1` pour la production | Élevé | SQLite est à écrivain unique ; plusieurs instances écrivant sur NFS risquent des conflits de verrouillage ou une corruption de la base de données. |
| `container_port` | `3001` (par défaut) | Critique | Un port natif d'Uptime Kuma non concordant fait échouer toutes les sondes de santé et la révision ne devient jamais prête. |
| `database_type` | `NONE` (par défaut) | Élevé | Le provisionnement de Cloud SQL gaspille de l'argent — Uptime Kuma v1 ne peut pas l'utiliser. |
| `execution_environment` | `gen2` (par défaut) | Élevé | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `vpc_egress_setting` | par portée cible | Moyen | `PRIVATE_RANGES_ONLY` achemine uniquement les sondes de plage privée via le VPC ; définissez `ALL_TRAFFIC` si les sondes de moniteur vers des cibles externes nécessitent un egress VPC/NAT. |
| `enable_iap` / `ingress_settings` | IAP ou `internal` pour les tableaux de bord privés | Moyen | Le tableau de bord (et la page de configuration, lors du premier déploiement) est autrement accessible publiquement à l'URL `run.app`. Terminez la configuration administrateur initiale immédiatement après le déploiement. |
| `enable_image_mirroring` | `true` (par défaut) | Faible | Les pulls directs depuis Docker Hub peuvent atteindre des limites de débit et interrompre les déploiements. |
| `container_image_source` | `custom` (par défaut) | Critique | La définition de `"prebuilt"` ignore l'étape Cloud Build et déploie l'image en amont non corrigée — Uptime Kuma écrit alors SQLite en mode WAL sur NFS, ce qui a produit une corruption de base de données `SQLITE_CORRUPT` observée. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Uptime Kuma partagée avec la variante GKE est décrite dans **[UptimeKuma_Common](UptimeKuma_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Uptime Kuma sur Cloud Run](../labs/UptimeKuma_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Uptime Kuma sur GKE Autopilot](UptimeKuma_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Uptime Kuma Common — Configuration d'application partagée](UptimeKuma_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observabilité et astreinte**.
