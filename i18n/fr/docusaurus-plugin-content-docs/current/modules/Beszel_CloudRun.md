---
title: "Beszel sur Google Cloud Run"
description: "Référence de configuration pour déployer Beszel sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Beszel_CloudRun.md @ 3055034 sha256:2a019a032f15 -->

# Beszel sur Google Cloud Run {#beszel-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_CloudRun.png" alt="Beszel sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel est un hub de supervision de serveurs léger et open source — métriques
historiques des ressources, statistiques des conteneurs Docker et alertes
configurables, construit sur PocketBase (Go et une base de données SQLite intégrée).
Ce module déploie le hub Beszel sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Beszel et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Beszel s'exécute comme un unique conteneur Go sur Cloud Run v2, servant son interface
web et son API REST sur le port 8090. Il conserve tout son état dans une base de
données SQLite intégrée sous `/beszel_data`, montée via FUSE depuis un bucket Cloud
Storage. Le déploiement assemble un ensemble volontairement restreint de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Un seul conteneur Go, 1 vCPU / 1 GiB par défaut, port 8090 |
| Base de données | **Aucune** | Beszel intègre sa propre base PocketBase/SQLite — aucun Cloud SQL n'est provisionné |
| Stockage objet | Cloud Storage | Un bucket de données, monté via GCS FUSE sur `/beszel_data` pour toute la persistance |
| Cache et file d'attente | **Aucun** | Beszel n'utilise pas Redis ; `enable_redis` est forcé à off |
| Secrets | Secret Manager | Aucun secret applicatif injecté — le premier administrateur est créé dans l'interface |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Beszel est autonome — `database_type = "NONE"`,
  `enable_cloudsql_volume = false` et `enable_redis = false`. Tout l'état réside dans
  la base SQLite intégrée sous `/beszel_data`.
- **La persistance est un bucket GCS FUSE.** Le bucket de données Cloud Storage est
  monté sur `/beszel_data`, de sorte que la base SQLite et les métriques historiques
  survivent au remplacement des révisions et aux événements de mise à l'échelle.
  Supprimer le bucket détruit tout l'historique de supervision.
- **L'instance unique est délibérée.** `min_instance_count = max_instance_count = 1`.
  Beszel est une application à écrivain unique (un seul fichier SQLite) ; exécuter
  plusieurs instances sur la même base montée via FUSE expose à des conflits de
  verrous et à une corruption. N'augmentez **pas** `max_instance_count`.
- **`min_instance_count = 1` (pas de mise à zéro).** Le hub reste actif afin que la
  base SQLite demeure ouverte et que les agents puissent remonter leurs données en
  continu ; il s'agit d'un backend de supervision, pas d'une application
  requête/réponse à trafic irrégulier.
- **Port 8090.** Le hub Beszel écoute sur 8090 ; le port du conteneur et les sondes
  sont configurés en conséquence.
- **Entrée publique par défaut.** `ingress_settings = "all"` expose l'URL `run.app`
  afin que les agents distants et les navigateurs puissent joindre le hub. Activer IAP
  bloquera la remontée des agents depuis des machines incapables de présenter une
  identité Google.
- **Chemin de santé `/api/health`.** Les sondes de démarrage et de vivacité
  interrogent le point de terminaison de santé public et non authentifié du hub (200
  lorsqu'il est prêt).
- **L'administrateur initial est créé dans l'interface.** Aucun mot de passe
  administrateur n'est stocké dans Secret Manager ; ouvrez le hub après le déploiement
  et terminez la configuration du superutilisateur au premier lancement de PocketBase.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Beszel {#a-cloud-run--the-beszel-service}

Beszel s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision
immuable ; comme l'application est à écrivain unique, le service est fixé à
exactement une instance au lieu d'être mis à l'échelle automatiquement.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~beszel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume `/beszel_data` {#b-cloud-storage--the-beszel_data-volume}

Un seul bucket Cloud Storage contient l'intégralité de l'état de Beszel (la base
SQLite, la configuration téléversée et les métriques historiques). Le socle accorde
l'accès au compte de service de la charge de travail et monte le bucket comme volume
**GCS FUSE** sur `/beszel_data` (nécessite l'environnement d'exécution `gen2`, qui
est la valeur par défaut).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~beszel"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

> **Attention :** ce bucket **est** la base de données. Ne le supprimez pas et n'en
> videz pas les objets — cela effacerait tout l'historique de supervision et le
> compte administrateur. Consultez [App_CloudRun](App_CloudRun.md) pour les options
> GCS FUSE et CMEK.

### C. Secret Manager {#c-secret-manager}

Beszel n'injecte **aucun** secret applicatif — il n'y a ni clé de chiffrement, ni
secret JWT, ni mot de passe de base de données à gérer (la base est un SQLite
intégré et l'administrateur est créé dans l'interface). La liste des secrets ne
montre que ceux que le socle crée lui-même.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour savoir comment des variables
d'environnement secrètes seraient injectées si vous en ajoutiez via
`secret_environment_variables`.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`),
ce qui permet aux agents distants d'envoyer (POST) leurs métriques au hub. Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs. (Notez que Beszel est lui-même un produit de supervision — la
supervision GCP observe ici le *hub*, pas les machines que Beszel surveille.)

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Beszel {#3-beszel-application-behaviour}

- **Pas de job d'initialisation ; le schéma est autogéré.** Beszel crée et migre
  automatiquement sa base PocketBase/SQLite intégrée au premier démarrage (et à chaque
  mise à niveau de version). Il n'y a pas de job `db-init`, car il n'y a pas de base
  de données externe.
- **L'état réside dans le bucket FUSE.** Tout ce qui se trouve sous `/beszel_data` —
  la base SQLite, la configuration et les métriques historiques — est conservé dans le
  bucket de données Cloud Storage. Les révisions et les redémarrages réutilisent le
  même bucket, de sorte que l'historique est préservé.
- **La configuration initiale se fait dans l'interface.** Ouvrez l'URL du service et
  terminez la création du compte superutilisateur (administrateur) au premier
  lancement de PocketBase. Aucun identifiant administrateur n'est généré
  automatiquement dans Secret Manager. Après avoir créé l'administrateur, ajoutez les
  systèmes à superviser et installez l'agent Beszel sur chacun d'eux (le hub affiche
  la commande d'installation de l'agent et la clé publique).
- **Écrivain unique — pas de mise à l'échelle horizontale.** Avec un seul fichier
  SQLite derrière un montage GCS FUSE, une seule instance peut écrire.
  `min = max = 1` est imposé par conception ; une garde au moment du plan rejette
  également `min_instance_count > max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`,
  qui renvoie `200` dès que le hub est prêt. Inspectez la révision en cours, ses
  variables d'environnement et ses montages :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Maintenu actif.** `min_instance_count = 1` évite les démarrages à froid, afin que
  les agents remontent leurs données en continu et que la base SQLite reste ouverte.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Beszel ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `beszel` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Beszel. `latest` résout l'image de base vers la version épinglée `0.9.1` ; définissez un tag explicite (p. ex. `0.9.1`) pour maîtriser les mises à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; Beszel est léger, 1 vCPU suffit largement. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 512 Mi–1 Gi est typique (le plancher gen2 est de 512 Mi). |
| `min_instance_count` | `1` | Maintenu à 1 — un seul écrivain SQLite, pas de mise à zéro. |
| `max_instance_count` | `1` | **Ne l'augmentez pas.** Plus d'une instance corrompt la base SQLite partagée. |
| `container_port` | `8090` | Le hub Beszel écoute sur 8090. |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE `/beszel_data`. |
| `enable_image_mirroring` | `true` | Duplique l'image Beszel dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux agents distants de joindre le hub. `internal` bloque la remontée des agents hors du VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les agents incapables de présenter une identité Google.** |

### Groupe — Stockage et système de fichiers {#group--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé ; Beszel persiste dans le bucket de données GCS FUSE, pas dans NFS. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires au-delà du bucket de données `/beszel_data` (nécessite gen2). |
| `create_cloud_storage` | `true` | Provisionne le ou les buckets de stockage déclarés. |

### Groupe — Backend de base de données {#group--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Beszel n'a pas de base de données externe — laissez `NONE`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL Auth Proxy ; Beszel utilise un SQLite intégré. |

### Groupe — Cache et file d'attente Redis {#group--redis-cache--queue}

Beszel n'utilise pas Redis. `enable_redis` n'est pas exposé comme variable de ce module — le
`main.tf` du wrapper code en dur `enable_redis = false` dans son appel à `App_CloudRun` (dont
la valeur par défaut est `true`), il n'y a donc rien à configurer ici.

### Groupe — Observabilité et santé {#group--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s delay | Sonde de démarrage ; fenêtre de 10 tentatives pour la création du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` 30s delay | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Test de disponibilité Cloud Monitoring facultatif sur le hub. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Outputs {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `beszel_url` | URL du service pour l'interface/API du hub Beszel. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de données `/beszel_data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec des montages GCS, un `backup_retention_days` hors limites, `min_instance_count > max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket de données de stockage | Ne jamais le supprimer ni le vider | Critical | Le bucket **est** la base SQLite — le supprimer efface tout l'historique de supervision et le compte administrateur. |
| `max_instance_count` | `1` | Critical | Exécuter plus d'une instance sur la base SQLite partagée montée via FUSE provoque des conflits de verrous et une corruption de la base. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | High | Beszel n'a pas de base externe ; activer Cloud SQL provisionne une instance inutilisée et perturbe le démarrage. |
| `execution_environment` | `gen2` | High | `gen1` ne peut pas monter le volume GCS FUSE `/beszel_data`, si bien que l'état n'est pas conservé. |
| `ingress_settings` | `all` | High | `internal` empêche les agents situés hors du VPC de remonter leurs données au hub. |
| `enable_iap` | uniquement pour l'interface, jamais avec des agents hors Google | High | IAP bloque toutes les requêtes non authentifiées, y compris la remontée des métriques des agents. |
| `min_instance_count` | `1` | Medium | La mise à zéro (`0`) supprime l'écrivain SQLite actif et interrompt la remontée continue des agents ; elle est aussi bloquée par la garde min/max lorsqu'elle est supérieure à `max`. |
| `container_port` | `8090` | Medium | Le hub n'écoute que sur 8090 ; le modifier sans adapter l'image casse les sondes et l'entrée. |
| `application_version` | épinglez-la explicitement | Medium | `latest` résout l'image de base vers la version épinglée `0.9.1` ; épinglez un vrai tag pour maîtriser les mises à niveau et éviter des migrations de schéma inattendues. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication d'images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Beszel, partagée avec la variante GKE, est décrite dans
**[Beszel_Common](Beszel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Beszel sur Cloud Run](../labs/Beszel_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Beszel sur GKE Autopilot](Beszel_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Beszel Common — Configuration applicative partagée](Beszel_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Netdata sur Google Cloud Run](Netdata_CloudRun.md) dans la solution **Monitoring & NOC**.
