---
title: "OpenClaw sur Google Cloud Run"
description: "Référence de configuration pour déployer OpenClaw sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OpenClaw_CloudRun.md @ 3055034 sha256:723ec59e1966 -->

# OpenClaw sur Google Cloud Run {#openclaw-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenClaw_CloudRun.png" alt="OpenClaw sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenClaw est une passerelle d'agents IA multi-tenant conçue spécifiquement pour des déploiements
d'agents isolés et persistants. Elle permet aux équipes d'exécuter des assistants IA par tenant s'appuyant sur des modèles Anthropic, avec
des espaces de travail GCS dédiés et une intégration facultative des canaux Telegram ou Slack — le tout sans
état partagé entre les agents. Ce module déploie OpenClaw sur **Cloud Run v2** au-dessus du
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise OpenClaw et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — consultez le [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

OpenClaw s'exécute sous forme de conteneur Node.js sur Cloud Run v2 (Gen2). Le déploiement associe
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 (Gen2) | Service Node.js, 1 vCPU / 1 GiB par défaut, CPU toujours alloué |
| Stockage de l'espace de travail | Cloud Storage (GCS Fuse) | Bucket d'espace de travail par tenant monté sur `/data` via GCS Fuse |
| Identifiants IA | Secret Manager | Clé API Anthropic et jeton de passerelle toujours stockés ; secrets Telegram et Slack facultatifs |
| Entrée | URL Cloud Run / Cloud Load Balancing | Public (`all`) par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |
| Secrets | Secret Manager | Tous les identifiants sont injectés à l'exécution ; jamais en clair dans la configuration |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ni base de données, ni Redis.** OpenClaw est une passerelle Node.js avec état reposant entièrement sur GCS
  Fuse sur `/data`. Cloud SQL et Redis ne sont jamais provisionnés.
- **Le CPU est toujours alloué.** `cpu_always_allocated = true` est obligatoire. Les connexions
  WebSocket et les opérations asynchrones des agents ne fonctionnent plus en cas de limitation du CPU. Ne le définissez pas à `false`.
- **L'environnement d'exécution Gen2 est obligatoire.** Les montages de volumes GCS Fuse ne sont pas disponibles en
  Gen1 et échoueront silencieusement.
- **Une image de conteneur personnalisée est toujours construite.** Le module ajoute un `entrypoint.sh` par-dessus
  l'image amont `ghcr.io/openclaw/openclaw`.
- **L'espace de travail GCS sur `/data` est toujours monté.** Un bucket dédié `<prefix>-storage` est
  toujours provisionné et monté. L'état persistant des agents y réside d'un redémarrage de conteneur à l'autre.
- **`OPENCLAW_STATE_DIR` est sur le disque local.** Le staging npm et le répertoire de configuration XDG sont
  redirigés vers `/tmp/openclaw` pour éviter les limitations de GCS Fuse sur les liens physiques au démarrage.
- **`min_instance_count = 0` par défaut (mise à l'échelle à zéro).** Définissez-le à `1` pour les déploiements d'agents
  sensibles à la latence afin d'éviter des démarrages à froid de 15 à 20 s.
- **`max_instance_count = 1` par tenant.** OpenClaw est avec état ; plusieurs instances pour le
  même tenant répartissent l'état entre les réplicas, sauf si un routage persistant est en place.
- **L'entrée vaut `all` par défaut (accès public direct).** Définissez `ingress_settings = "internal"`
  pour restreindre le service au trafic VPC lorsqu'il est placé derrière un routeur OpenClaw.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont indiqués
dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenClaw {#a-cloud-run--the-openclaw-service}

OpenClaw s'exécute sous forme de service Cloud Run v2 dans l'environnement d'exécution Gen2. Le CPU est toujours
alloué pour prendre en charge les connexions WebSocket et les opérations asynchrones des agents. Chaque déploiement crée
une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution
et la répartition du trafic.

### B. Cloud Storage — espace de travail GCS Fuse {#b-cloud-storage--gcs-fuse-workspace}

Tout l'état durable des agents est stocké dans un bucket Cloud Storage dédié et monté dans le
service sur `/data` par GCS Fuse. L'organisation de l'espace de travail est la suivante :

```
<prefix>-storage/
├── workspace/              ← agent workspace (/data/workspace)
│   └── skill-library/      ← shared skills repo (when skills_repo_url is set)
├── agents/main/agent/      ← agent state directory
└── ...
```

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `<prefix>-storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<prefix>-storage/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage GCS Fuse, les options CMEK et le
cycle de vie des buckets.

### C. Secret Manager — identifiants {#c-secret-manager--credentials}

La clé API Anthropic et le jeton de passerelle sont toujours stockés dans Secret Manager. Lorsque
l'intégration Telegram ou Slack est activée, les jetons des bots et les secrets de webhook/de signature y sont
également stockés. Tous les identifiants sont injectés dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the Anthropic key (initial deploy only; manage via Secret Manager thereafter):
  gcloud secrets versions access latest --secret=<prefix>-anthropic-api-key --project "$PROJECT"
  # Retrieve the gateway token (needed to register clients):
  gcloud secrets versions access latest --secret=<prefix>-gateway-token --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut via son URL `run.app`, ouverte au trafic public d'internet
(`ingress_settings = "all"`). Définissez `ingress_settings = "internal"` pour le restreindre au trafic
VPC lorsqu'il est placé derrière un routeur OpenClaw. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run sont envoyées vers Cloud Monitoring, avec
des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenClaw {#3-openclaw-application-behaviour}

- **Aucun job d'initialisation de base de données.** OpenClaw ne nécessite ni Cloud SQL ni job d'initialisation. L'état des agents
  réside entièrement sur GCS ; le premier démarrage du conteneur crée automatiquement les répertoires de l'espace de travail
  via `entrypoint.sh`.
- **Configuration régénérée à chaque démarrage.** `entrypoint.sh` réécrit toujours `openclaw.json`
  dans `$OPENCLAW_STATE_DIR`, ce qui garantit que les variables d'environnement gérées par Terraform (clés API,
  jeton de passerelle, paramètres des canaux) l'emportent sur toute valeur obsolète précédemment persistée sur GCS.
- **Synchronisation du dépôt de skills (facultative).** Lorsque `skills_repo_url` est défini, `entrypoint.sh`
  effectue un clonage superficiel ou une mise à jour du dépôt dans `/data/workspace/skill-library`
  à chaque démarrage du conteneur. La synchronisation n'est pas bloquante — la passerelle démarre même si le clonage
  échoue. Recherchez les entrées `skill-library` dans Cloud Logging pour vérifier l'état de la synchronisation.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux `GET /health` sur le port 8080. La
  sonde de démarrage accorde environ 2 minutes pour le montage GCS Fuse et le démarrage de Node.js.
- **Webhooks Telegram et Slack.** Lorsque `enable_telegram` ou `enable_slack` est défini, le
  jeton de bot correspondant est injecté sous la forme `TELEGRAM_BOT_TOKEN` ou `SLACK_BOT_TOKEN`. Les
  secrets de webhook/de signature sont stockés dans Secret Manager pour un service routeur compagnon et ne sont
  pas injectés dans le conteneur de l'agent.
- **Mise à l'échelle à zéro et démarrages à froid.** Avec `min_instance_count = 0`, les événements de webhook Telegram/Slack
  qui arrivent pendant un démarrage à froid (15 à 20 s) peuvent être perdus. Définissez `min_instance_count = 1`
  pour les déploiements d'agents en production.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à OpenClaw ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `anthropic_api_key` | _(obligatoire au premier déploiement)_ | Clé API Anthropic. Stockée dans Secret Manager et injectée sous la forme `ANTHROPIC_API_KEY`. Omettez-la lors des mises à jour pour conserver la valeur stockée. Sensible. |
| `gateway_token` | _(généré automatiquement)_ | Jeton d'authentification de la passerelle. Un jeton hexadécimal sécurisé de 64 caractères est généré lorsqu'il est laissé vide. Stocké dans Secret Manager sous le nom `OPENCLAW_GATEWAY_TOKEN`. Sensible. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openclaw` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `OpenClaw Gateway` | Nom convivial affiché dans la console. |
| `description` | `OpenClaw AI Gateway - Serverless multi-tenant AI agent gateway on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de l'image OpenClaw utilisé comme argument de build `BASE_IMAGE`. Figez-le sur une version précise pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. Dimensionnée pour un usage léger/typique (pic observé d'environ 400Mi) ; passez à `2Gi` pour des sessions d'agents concurrentes plus lourdes. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro (démarrage à froid de 15 à 20 s). Définissez ≥ `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Conservez `1` par tenant pour éviter un état fragmenté. N'augmentez qu'avec un routage persistant. |
| `container_port` | `8080` | Port sur lequel écoute la passerelle OpenClaw. Doit correspondre à la variable d'environnement `PORT`. |
| `execution_environment` | `gen2` | Gen2 **obligatoire** pour GCS Fuse. Ne pas changer en `gen1`. |
| `cpu_always_allocated` | `true` | Requis pour les connexions WebSocket et les opérations asynchrones. Ne pas définir à `false`. |
| `timeout_seconds` | `3600` | Durée maximale d'une requête. Les sessions d'agents sont longues ; 3600 s est le maximum. |
| `enable_cloudsql_volume` | `false` | OpenClaw n'utilise pas Cloud SQL. Laissez `false`. |
| `traffic_split` | `[]` | Répartition du trafic canary/blue-green. La somme de toutes les entrées doit être égale à 100. |
| `max_revisions_to_retain` | `7` | Anciennes révisions à conserver après chaque déploiement. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal` pour un accès limité au VPC (recommandé derrière un routeur) ; `all` pour un accès public direct. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Routage de la sortie VPC. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les variables gérées par le module (`OPENCLAW_STATE_DIR`, `NODE_ENV`, etc.) sont toujours prioritaires. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom d'un secret Secret Manager existant. Les identifiants principaux sont gérés automatiquement. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation (30 jours). |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de la sauvegarde automatique de l'espace de travail (UTC). |
| `backup_retention_days` | `7` | Jours de rétention ; à augmenter pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_format` | options de restauration | Importe une sauvegarde de l'espace de travail lors du déploiement. `backup_format` vaut `tar` par défaut. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets supplémentaires définis dans `storage_buckets`. Le bucket de l'espace de travail est toujours créé. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires en plus du bucket d'espace de travail provisionné automatiquement. |
| `enable_nfs` | `false` | OpenClaw utilise GCS Fuse pour son état. NFS n'est pas nécessaire et est désactivé par défaut. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le volume `openclaw-data` sur `/data` est toujours ajouté. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | OpenClaw n'a pas de job d'initialisation par défaut. À utiliser pour un amorçage personnalisé de l'espace de travail. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `startup_probe_config` | HTTP `/health`, seuil de 24 tentatives | Accorde environ 2 minutes pour le montage GCS Fuse et le démarrage de Node.js. |
| `liveness_probe` / `health_check_config` | HTTP `/health` | Redémarre le conteneur si la passerelle ne répond plus. |
| `uptime_check_config` | `{ enabled = false, path = "/health" }` | Test de disponibilité Cloud Monitoring. Désactivé par défaut ; activez-le pour la surveillance en production. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 15 — Configuration d'OpenClaw {#group-15--openclaw-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `skills_repo_url` | `""` | URL GitHub d'un dépôt de skills partagé. Cloné dans `/data/workspace/skill-library` à chaque démarrage du conteneur. Laissez vide pour ignorer. |
| `skills_repo_ref` | `main` | Référence Git (branche, tag ou SHA) à extraire. |
| `enable_telegram` | `false` | Provisionne un secret de jeton de bot Telegram et injecte `TELEGRAM_BOT_TOKEN`. Nécessite `telegram_bot_token`. |
| `telegram_bot_token` | `""` | Jeton de bot Telegram obtenu auprès de @BotFather. Sensible. |
| `telegram_webhook_secret` | `""` | Secret de validation des webhooks pour le routeur (non injecté dans l'agent). À générer avec `openssl rand -hex 32`. Sensible. |
| `enable_slack` | `false` | Provisionne les secrets Slack et injecte `SLACK_BOT_TOKEN`. Nécessite `slack_bot_token`. |
| `slack_bot_token` | `""` | Jeton de bot Slack (`xoxb-...`). Sensible. |
| `slack_signing_secret` | `""` | Secret de signature Slack pour le routeur (non injecté dans l'agent). Sensible. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources
en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des éventuelles jobs d'initialisation personnalisés. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Dépôt GitHub connecté. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `anthropic_api_key` | Définie au premier déploiement | Critique | Sans clé valide, l'agent démarre mais toutes les requêtes IA échouent avec des erreurs 401. |
| Cohérence de `gateway_token` | Généré automatiquement ou défini une seule fois | Critique | Effectuer la rotation du jeton dans Secret Manager sans redéployer le service entraîne le rejet de toutes les requêtes clientes jusqu'au redéploiement du service. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `execution_environment` | `gen2` | Élevé | Gen1 ne prend pas en charge GCS Fuse ; le montage de l'espace de travail échoue silencieusement. |
| `cpu_always_allocated` | `true` | Élevé | La limitation du CPU casse les connexions WebSocket et les opérations asynchrones des agents. |
| `telegram_bot_token` / `slack_bot_token` | définis lorsque l'intégration est activée | Élevé | Un jeton vide fait échouer tous les appels d'API ; les messages sont perdus. |
| `telegram_webhook_secret` / `slack_signing_secret` | définis lorsque l'intégration est activée | Élevé | Une valeur vide désactive la vérification des signatures, ce qui permet l'injection de faux webhooks. |
| `min_instance_count` | `1` pour les agents en production | Élevé | `0` signifie que les événements de webhook Telegram/Slack sont perdus pendant un démarrage à froid (15 à 20 s). |
| `skills_repo_url` | URL joignable ou vide | Élevé | Une URL injoignable fait échouer le clonage git au démarrage, ce qui redémarre le conteneur. |
| `skills_repo_ref` | référence existante | Élevé | Une branche ou un tag inexistant fait échouer le clonage à chaque démarrage. |
| `max_instance_count` | `1` par tenant | Élevé | Plusieurs instances pour le même tenant répartissent l'état des agents entre les réplicas. |
| `enable_iap` | à activer pour un usage d'administration | Moyen | Sinon, la passerelle est joignable via son URL `run.app`. Les points de terminaison de webhooks Telegram/Slack ne peuvent pas s'authentifier avec une identité Google — veillez à ce qu'ils ne soient pas derrière IAP. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour la conformité ; une purge accidentelle du bucket fait perdre définitivement l'état des agents. |
| `enable_vpc_sc` sans `organization_id` | à définir explicitement | Moyen | VPC-SC est ignoré silencieusement, ce qui laisse les identifiants sans protection de périmètre. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à OpenClaw partagée avec la variante GKE est décrite dans
**[OpenClaw_Common](OpenClaw_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenClaw sur Cloud Run](../labs/OpenClaw_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OpenClaw sur GKE Autopilot](OpenClaw_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [OpenClaw Common — Configuration applicative partagée](OpenClaw_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md) et [Hermes Agent sur Google Cloud Run](Hermes_CloudRun.md) dans la solution **AI Agent Workspace**.
