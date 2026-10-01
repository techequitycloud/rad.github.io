---
title: "ActualBudget sur Google Cloud Run"
description: "Référence de configuration pour déployer ActualBudget sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/ActualBudget_CloudRun.md @ 3055034 sha256:9db505f30649 -->

# ActualBudget sur Google Cloud Run {#actualbudget-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ActualBudget_CloudRun.png" alt="ActualBudget sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Actual Budget est une application de finances personnelles axée sur la confidentialité et le fonctionnement en local (local-first), construite autour de la budgétisation par enveloppes à base zéro. Le composant `actual-server` est un serveur de synchronisation Node.js léger qui stocke chaque budget sous forme de fichier SQLite et le synchronise entre l'interface web et les clients de bureau et mobiles. Ce module déploie le serveur Actual Budget sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ActualBudget et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ActualBudget s'exécute sous forme d'un unique conteneur Node.js sur Cloud Run v2. Comme il gère son propre stockage SQLite, le déploiement assemble un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, instance unique (`min = max = 1`) |
| Base de données | Aucune | ActualBudget conserve les données de budget dans des fichiers SQLite — `database_type = "NONE"`, pas de Cloud SQL |
| Données persistantes | Cloud Storage (GCS FUSE) | Un bucket `storage` dédié monté sur `/data` contient les fichiers de budget SQLite et les fichiers utilisateur |
| Image de conteneur | Artifact Registry + Cloud Build | Build léger encapsulant `actualbudget/actual-server`, mis en miroir dans votre registre |
| Secrets | Secret Manager | Un jeton d'API (`enable_api_key`), **activé par défaut** et requis dès que `ingress_settings = "all"` |
| Entrée | URL Cloud Run / Cloud Load Balancing | **Vaut `all` par défaut** (public) — nécessaire pour atteindre directement l'interface web ; passez à `internal` pour un accès limité au VPC |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** ActualBudget conserve tout sous forme de fichiers SQLite sous `/data` ; il n'y a ni instance Cloud SQL, ni tâche `db-init`, ni Redis (`enable_redis = false`), ni sidecar Cloud SQL Auth Proxy.
- **Un bucket GCS `storage` est provisionné automatiquement** par `ActualBudget_Common` et monté sur `/data` via GCS FUSE (`enable_gcs_storage_volume = true`). `ACTUAL_SERVER_FILES = /data/server-files` et `ACTUAL_USER_FILES = /data/user-files` font pointer les deux arborescences de persistance vers ce montage, afin que rien n'aboutisse sur le disque éphémère du conteneur.
- **Instance unique par conception.** `min_instance_count = 1` et `max_instance_count = 1` — le serveur sert un seul ensemble partagé de fichiers SQLite depuis un seul volume ; exécuter plusieurs réplicas expose à des conflits d'écriture.
- **L'entrée vaut `all` (public) par défaut, associée à une clé d'API obligatoire.** `ingress_settings = "all"` est la valeur par défaut du module — nécessaire pour atteindre directement l'interface web — et `validation.tf` impose une précondition au moment du plan (`ingress_settings != "all" || enable_api_key`) qui rejette une entrée publique à moins que `enable_api_key` ne vaille aussi `true`. Comme `enable_api_key` vaut également `true` par défaut, les valeurs par défaut seules passent la validation et le déploiement est accessible publiquement avec une protection par jeton d'API déjà provisionnée. Passez plutôt à `ingress_settings = "internal"` pour un accès limité au VPC.
- **Clé d'API activée par défaut.** Le mot de passe du serveur est toujours défini de manière interactive sur l'écran d'accueil de première exécution, mais `enable_api_key = true` (la valeur par défaut du module) provisionne en plus un jeton d'API de 32 caractères (`ACTUAL_TOKEN`) dans Secret Manager — requis par la précondition d'entrée ci-dessus dès que `ingress_settings = "all"`.
- **Épinglage de version.** Le Dockerfile lit un ARG de build propre à l'application, `ACTUALBUDGET_VERSION` ; `application_version = "latest"` fige le build sur `25.7.1`.
- **Les sondes de santé ciblent `/`** — le serveur répond sur son chemin racine avec un HTTP 200 dès qu'il écoute, sans authentification.
- **Plutôt adapté à un usage mono-utilisateur / léger sur Cloud Run.** SQLite sur GCS FUSE ne tolère pas les écritures concurrentes intensives ; pour un stockage de production durable, préférez la variante ActualBudget_GKE avec un PVC en mode bloc.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service ActualBudget {#a-cloud-run--the-actualbudget-service}

ActualBudget s'exécute comme un service Cloud Run v2 limité à une seule instance. Chaque déploiement crée une révision immuable ; lors d'une mise à jour, le trafic bascule vers la révision saine la plus récente.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le niveau de données persistantes {#b-cloud-storage--the-persistent-data-tier}

Tout l'état d'ActualBudget — les bases de données de budget SQLite, les fichiers du serveur et les données utilisateur par fichier — réside sur un bucket **Cloud Storage** dédié, monté dans le conteneur sur `/data` via **GCS FUSE** (environnement d'exécution gen2 requis). Le bucket survit aux déploiements de révisions, aux redémarrages et aux redéploiements ; c'est le seul endroit où existent les données de budget, considérez-le donc comme l'élément à protéger et à sauvegarder.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~actualbudget"
  gcloud storage ls -r gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le comportement des montages GCS Fuse et CMEK.

### C. Artifact Registry et Cloud Build — l'image de conteneur {#c-artifact-registry--cloud-build--the-container-image}

`ActualBudget_Common` fournit un Dockerfile léger (`FROM actualbudget/actual-server:${ACTUALBUDGET_VERSION}`) que Cloud Build construit dans le dépôt Artifact Registry de votre projet — les déploiements récupèrent donc l'image depuis votre registre et non depuis Docker Hub, et sont compatibles avec Binary Authorization.

- **Console :** Artifact Registry → Repositories ; Cloud Build → History.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  ```

### D. Secret Manager — jeton d'API {#d-secret-manager--api-token}

`enable_api_key = true` est la valeur par défaut du module : un jeton aléatoire de 32 caractères est généré, stocké dans Secret Manager sous le nom `secret-<prefix>-<app>-api-key` et injecté dans le service en tant que variable d'environnement secrète `ACTUAL_TOKEN` — utile pour les automatisations qui doivent appeler le serveur avant que l'interface ne soit configurée, et requis par `validation.tf` dès que `ingress_settings = "all"` (également la valeur par défaut).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service utilise par défaut `ingress_settings = "all"` ; l'URL `run.app` est donc accessible publiquement d'emblée (nécessaire pour atteindre directement l'interface web) — associée à la valeur par défaut obligatoire `enable_api_key = true` (voir §2.D). Pour un accès limité au VPC, définissez `ingress_settings = "internal"` ; pour un domaine personnalisé, Cloud CDN, Cloud Armor et éventuellement IAP en frontal, utilisez `internal-and-cloud-load-balancing`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  # Tunnel to an internal-only service from your workstation:
  gcloud run services proxy <service-name> --region "$REGION" --port 8080
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run sont envoyées à Cloud Monitoring. Un test de disponibilité peut être activé via `uptime_check_config` (désactivé par défaut ; il nécessite un point de terminaison accessible publiquement — condition remplie d'emblée par la valeur par défaut `ingress_settings = "all"`, mais pas si vous passez à `internal`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application ActualBudget {#3-actualbudget-application-behaviour}

- **Aucun job d'initialisation.** Il n'y a pas de base de données à amorcer ; le serveur crée ses fichiers SQLite sous `/data` au premier démarrage. Des `initialization_jobs` personnalisées sont acceptées pour des tâches de chargement ou de migration de données, mais aucune n'est fournie par défaut.
- **Configuration de première exécution.** Au premier accès, l'interface web affiche un écran d'accueil sur lequel vous définissez le **mot de passe du serveur** — il n'y a aucun identifiant prédéfini à récupérer. Faites-le immédiatement après le déploiement ; le service est accessible publiquement par défaut (`ingress_settings = "all"`) et, tant qu'aucun mot de passe n'est défini, quiconque atteint l'URL peut s'approprier le serveur.
- **Organisation des données.** `ACTUAL_SERVER_FILES = /data/server-files` (métadonnées du serveur et base de données des comptes) et `ACTUAL_USER_FILES = /data/user-files` (données de synchronisation par budget). Les deux résident sur le montage GCS FUSE ; les données de budget survivent donc aux redémarrages et aux redéploiements.
- **Modèle de synchronisation local-first.** Les clients (web, bureau, mobile) conservent une copie locale complète du budget et n'utilisent le serveur que pour synchroniser les modifications chiffrées entre appareils — une brève indisponibilité du serveur n'empêche pas de travailler dans un client.
- **Contrainte d'écrivain unique.** Le serveur suppose un accès exclusif à ses fichiers SQLite. Gardez `max_instance_count = 1` ; une validation au moment du plan impose `min_instance_count <= max_instance_count`.
- **Mises à jour de version.** Modifiez `application_version` et relancez l'apply — Cloud Build produit une nouvelle image et Cloud Run déploie une nouvelle révision. `latest` construit la version figée `25.7.1`.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité émettent `GET /`, qui renvoie un HTTP 200 sans authentification dès que le serveur HTTP écoute.
- **Vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~actualbudget" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" \
    --project "$PROJECT" --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"   # expect 200 with the default ingress=all (403/404 if switched to internal)
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à ActualBudget ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `actualbudget` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` construit la version figée `25.7.1`. Incrémentez-le pour déclencher un nouveau build et une nouvelle révision. |
| `enable_api_key` | `true` | Génère un jeton d'API de 32 caractères dans Secret Manager et l'injecte en tant que `ACTUAL_TOKEN`. Requis dès que `ingress_settings = "all"` (la valeur par défaut du module) — `validation.tf` rejette une entrée publique sans lui. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | actual-server est un processus Node.js léger ; 1 vCPU suffit. |
| `memory_limit` | `1Gi` | Une mémoire modeste suffit pour des fichiers de budget typiques. |
| `min_instance_count` | `1` | Garde l'instance unique active. Définissez `0` pour la mise à l'échelle à zéro si un démarrage à froid à la première requête est acceptable. |
| `max_instance_count` | `1` | **Gardez 1** — un seul volume SQLite partagé, un seul écrivain. |
| `container_port` | `5006` | Port HTTP natif d'actual-server. |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE `/data`. |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — laissez `false`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut (nécessaire pour atteindre directement l'interface web) ; `validation.tf` exige `enable_api_key = true` lorsque cette valeur est `all`. Définissez `internal` pour un accès limité au VPC, ou `internal-and-cloud-load-balancing` derrière un équilibreur de charge HTTPS. |
| `enable_iap` | `false` | Ajoute une authentification par identité Google devant l'interface (chemin via l'équilibreur de charge). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en clair supplémentaires. `ACTUAL_PORT`, `ACTUAL_SERVER_FILES` et `ACTUAL_USER_FILES` sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires. Le secret `ACTUAL_TOKEN` est raccordé automatiquement lorsque `enable_api_key = true`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7–10 — Sauvegarde, CI/CD, SQL personnalisé, domaine et CDN {#groups-710--backup-cicd-custom-sql-domain--cdn}

Comportement standard d'App_CloudRun — consultez [App_CloudRun](App_CloudRun.md). Notez que les entrées SQL personnalisées (groupe 9) sont sans effet pour ActualBudget, puisqu'il n'y a pas d'instance Cloud SQL.

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket de données `storage` est toujours déclaré par `ActualBudget_Common`. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le montage de stockage `/data` est ajouté automatiquement. |
| `enable_nfs` | `false` | Inutile — la persistance repose sur le bucket GCS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par `ActualBudget_Common` — ActualBudget n'a pas de base de données SQL. |

Toutes les autres entrées de ce groupe sont transmises par souci de compatibilité, mais ne sont pas utilisées.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucune tâche par défaut. Fournissez la vôtre uniquement pour un chargement ou une migration de données personnalisés. |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 15 s, 10 échecs | Réussit dès que le serveur Node écoute. |
| `liveness_probe` | HTTP `/`, délai initial de 30 s, période de 30 s | Chemin racine, sans authentification. |
| `uptime_check_config` | désactivé | N'activez-le qu'une fois le point de terminaison accessible publiquement (entrée `all` ou équilibreur de charge). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging` — comportement standard d'App_CloudRun ; consultez [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `actualbudget_url` | URL `run.app` du service. Accessible publiquement par défaut (`ingress_settings = "all"`) ; limitée au VPC lorsque `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de stockage `/data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration personnalisées (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Le module intègre une validation au moment du plan pour les erreurs de configuration les plus dommageables (par exemple `min_instance_count <= max_instance_count`), mais plusieurs paramètres méritent une attention particulière :

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Plusieurs instances écrivent les mêmes fichiers SQLite sur un seul volume partagé — risque de corruption/de conflit. |
| Mot de passe du serveur à la première exécution | à définir immédiatement | Critique | Tant qu'aucun mot de passe n'est défini, quiconque atteint l'URL peut s'approprier le serveur et ses données de budget. |
| Contenu du bucket de stockage | ne jamais le supprimer manuellement | Critique | `/data` sur le bucket GCS est la seule copie des bases de données de budget ; supprimer le bucket efface tous les budgets. |
| `container_port` | `5006` | Critique | Port natif d'actual-server ; une valeur différente fait échouer toutes les sondes de santé. |
| `execution_environment` | `gen2` | Élevé | Les montages de volumes GCS FUSE nécessitent gen2 ; gen1 laisse `/data` non monté et les données sur un disque éphémère. |
| `ingress_settings` = `"all"` (la valeur par défaut) | définir le mot de passe du serveur immédiatement après le déploiement | Critique | Le service est accessible publiquement par défaut ; un serveur non revendiqué peut être approprié par le premier venu qui atteint l'URL. Définissez plutôt `internal` si l'accès public n'est pas nécessaire. |
| `ingress_settings = "all"` avec `enable_api_key = false` | combinaison non valide | Critique | `validation.tf` impose `ingress_settings != "all" \|\| enable_api_key` au moment du plan — cette combinaison fait échouer le plan d'emblée au lieu de déployer de manière non sécurisée. Les deux valeurs par défaut satisfont déjà la précondition (`all` + `true`), si bien que les valeurs par défaut seules se déploient sans erreur ; seul un remplacement explicite par `enable_api_key = false` en laissant l'entrée à `all` déclenche l'échec. |
| Charge d'écriture multi-utilisateur intensive | passer à ActualBudget_GKE (PVC en mode bloc) | Élevé | SQLite ne tolère pas GCS FUSE sous des écritures concurrentes intensives ; Cloud Run convient à un usage mono-utilisateur / léger. |
| `enable_api_key` | `true` (la valeur par défaut) | Moyen | Sans `ACTUAL_TOKEN`, l'accès programmatique à l'API repose uniquement sur le mot de passe du serveur. Également requis par la précondition d'entrée ci-dessus dès que `ingress_settings = "all"`. |
| `min_instance_count` | `1` (ou `0` pour réduire les coûts) | Moyen | `0` ajoute un démarrage à froid à la première requête après une période d'inactivité ; les données sont en sécurité dans les deux cas (l'état est sur GCS). |
| `uptime_check_config` | à activer tant que l'entrée est publique | Faible | Si `ingress_settings` passe à `internal`, le test ne peut pas atteindre le service et échouera systématiquement. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à ActualBudget partagée avec la variante GKE est décrite dans **[ActualBudget_Common](ActualBudget_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ActualBudget sur Cloud Run](../labs/ActualBudget_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [ActualBudget sur GKE Autopilot](ActualBudget_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [ActualBudget Common — Configuration applicative partagée](ActualBudget_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md), [Ghostfolio sur Google Cloud Run](Ghostfolio_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md) dans la solution **Finance & Wealth Tracking**.
