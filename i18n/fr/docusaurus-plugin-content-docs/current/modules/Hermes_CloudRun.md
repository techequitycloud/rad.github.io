---
title: "Hermes Agent sur Google Cloud Run"
description: "Référence de configuration pour déployer Hermes Agent sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Hermes_CloudRun.md @ 3055034 sha256:8f12a45eddce -->

# Hermes Agent sur Google Cloud Run {#hermes-agent-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hermes_CloudRun.png" alt="Hermes Agent sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hermes Agent est l'agent d'IA personnel de Nous Research, open source (sous
licence MIT), auto-hébergé et capable de s'améliorer lui-même : il apprend des
compétences à partir de l'expérience, conserve une mémoire d'une session à
l'autre et se connecte aux plateformes de messagerie ainsi qu'à une API
compatible OpenAI depuis un unique processus passerelle
([documentation](https://hermes-agent.nousresearch.com/docs/)). Ce module déploie
l'image officielle `nousresearch/hermes-agent` sur **Cloud Run v2** au-dessus du
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Hermes et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Hermes s'exécute comme un unique conteneur passerelle toujours actif sur Cloud Run
v2. Le déploiement assemble un ensemble volontairement restreint de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur passerelle, 1 vCPU / 2 GiB par défaut, `min=1` / `max=1`, CPU toujours alloué |
| État de l'agent | NFS autogéré (Services_GCP) | Monté sur `/opt/data` — configuration SQLite, sessions, compétences, mémoires. **Pas de Cloud SQL** |
| Secrets | Secret Manager | `ANTHROPIC_API_KEY`, `API_SERVER_KEY` et mot de passe du tableau de bord générés automatiquement, `OPENAI_API_KEY` / `TELEGRAM_BOT_TOKEN` facultatifs |
| Image de conteneur | Artifact Registry (miroir) | Image officielle préconstruite mise en miroir ; aucun build personnalisé, aucune étape Cloud Build |
| Réseau | VPC + URL `run.app` | Sortie VPC serverless pour le montage NFS ; URL publique pour le serveur d'API |
| Base de données / cache | — | **Pas de Cloud SQL, pas de Redis** — Hermes repose entièrement sur SQLite sur NFS |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Tout l'état de l'agent réside dans `/opt/data`, et ce chemin est fixé dans
  l'image.** Le NFS partagé de la plateforme est monté directement dessus
  (`enable_nfs = true`, `nfs_mount_path = "/opt/data"`, tous deux définis par
  défaut et **imposés par une validation au moment du plan**). Sans ce montage,
  chaque démarrage à froid ou redéploiement efface silencieusement l'identité
  accumulée de l'agent.
- **`max_instance_count` est validé à 1.** L'état de Hermes est stocké dans
  SQLite, qui suit un modèle à écrivain unique — une seconde instance concurrente
  corrompt la base de données.
- **`cpu_always_allocated = true` et `min_instance_count = 1`.** Les connecteurs
  de messagerie (Telegram/Discord/Slack) effectuent un long-polling **sortant** ;
  avec la mise à zéro, l'agent est endormi et manque des messages, et le bridage
  du CPU propre à la facturation à la requête bloque les boucles de polling et les
  tours asynchrones de l'agent. Comptez sur une instance toujours active.
- **Le serveur d'API compatible OpenAI écoute sur le port 8642** et exige
  l'`API_SERVER_KEY` générée automatiquement comme jeton bearer.
- **La sonde de démarrage vérifie par défaut l'écoute du port TCP ; la sonde de
  vivacité est désactivée.** Le serveur d'API exige une authentification ; une
  sonde HTTP sur celui-ci renverrait donc 401 et bloquerait le déploiement
  progressif — et Cloud Run ne prend pas en charge les sondes de vivacité TCP (le
  TCP est réservé au démarrage). La sonde de démarrage TCP et la gestion des
  instances propre à Cloud Run couvrent la santé ; n'activez une sonde de
  vivacité avec un chemin HTTP qu'après avoir vérifié que l'endpoint est non
  authentifié.
- **Le tableau de bord web (port 9119) n'est pas routé sur Cloud Run** — Cloud
  Run n'expose qu'un seul port d'entrée. Utilisez la variante GKE avec
  `kubectl port-forward` si vous avez besoin de l'interface du tableau de bord.
- **Au moins une clé de fournisseur de modèles est requise lors du déploiement
  initial** (`anthropic_api_key`, ou `enable_openai` + `openai_api_key`) ; une
  vérification au moment du plan émet un avertissement si aucune n'est fournie.
- **Aucun job d'initialisation, aucun amorçage de base de données** — le premier
  démarrage se contente d'initialiser `/opt/data` sur le partage NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service passerelle Hermes {#a-cloud-run--the-hermes-gateway-service}

Hermes s'exécute comme un service Cloud Run v2 à instance unique. Chaque
déploiement crée une révision immuable ; comme l'application repose sur
NFS/SQLite et est limitée à une seule instance, il n'y a aucun autoscaling à
observer — les signaux intéressants sont la santé des révisions et le temps de
fonctionnement de l'instance.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, les modes de
facturation, l'environnement d'exécution et la répartition du trafic.

### B. Stockage partagé NFS — l'identité de l'agent {#b-nfs-shared-storage--the-agents-identity}

L'intégralité de l'état de l'agent (base de données de configuration SQLite, clés
d'API, sessions, compétences apprises, mémoires) réside sur le serveur NFS
autogéré partagé que provisionne `Services_GCP`
(`create_network_filesystem = true`), monté sur `/opt/data` dans le conteneur via
l'environnement d'exécution gen2. La VM NFS doit être à l'état `RUNNING` avant le
déploiement de ce module — la découverte la trouve par son libellé.

- **Console :** Compute Engine → VM instances (la VM du serveur NFS) ; Cloud Run →
  service → onglet Volumes.
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  # Confirm the NFS volume mount on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

Le partage et ses données **appartiennent à Services_GCP** — détruire le
déploiement Hermes ne supprime pas l'état de l'agent sur l'export NFS.

### C. Secret Manager {#c-secret-manager}

Cinq secrets peuvent exister par déploiement, tous injectés comme variables
d'environnement : `ANTHROPIC_API_KEY` (fourni par l'opérateur), `API_SERVER_KEY`
(chaîne hexadécimale de 64 caractères générée automatiquement — le jeton bearer
de l'API de la passerelle), `HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` (généré
automatiquement) et, en option, `OPENAI_API_KEY` et `TELEGRAM_BOT_TOKEN`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hermes"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Des variables d'identifiants laissées vides lors d'un déploiement de mise à jour
conservent la version `latest` stockée — les clés n'ont jamais besoin d'être
ressaisies. Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur
l'injection et la rotation.

### D. Artifact Registry — l'image mise en miroir {#d-artifact-registry--the-mirrored-image}

L'image officielle `nousresearch/hermes-agent:<version>` est mise en miroir dans
Artifact Registry avant le déploiement (`enable_image_mirroring = true`), de sorte
que le service ne tire jamais l'image depuis Docker Hub à l'exécution. Il n'y a
**aucune étape Cloud Build** — il s'agit d'un module préconstruit.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --filter="package~hermes"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le serveur d'API est joignable par défaut à l'URL `run.app` du service
(`ingress_settings = "all"`), protégé par le jeton bearer `API_SERVER_KEY` plutôt
que par des contrôles réseau. La sortie VPC (`PRIVATE_RANGES_ONLY`) transporte le
trafic NFS ; le long-polling des connecteurs sort directement vers internet.

- **Console :** Cloud Run (URL du service) ; VPC network → VPC networks.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute networks list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour Cloud Armor, les domaines
personnalisés et IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud
Run vers Cloud Monitoring. Le test de disponibilité est **désactivé par
défaut** — le serveur d'API exige une authentification, si bien qu'un test de
disponibilité non authentifié échouerait systématiquement.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Hermes {#3-hermes-application-behaviour}

- **Initialisation du répertoire de données au premier démarrage.** L'ENTRYPOINT
  de l'image est le `/init` de s6-overlay, qui démarre en root, applique un
  `chown` au volume `/opt/data` (le répertoire NFS vierge) au profit de
  l'utilisateur non root `hermes`, puis abandonne ses privilèges et démarre la
  passerelle (`container_args = ["gateway", "run"]` — le CMD par défaut de l'image
  est la CLI interactive ; la passerelle doit donc être démarrée explicitement).
- **Aucun job d'initialisation de base de données.** Hermes crée sa propre base
  de données de configuration SQLite sous `/opt/data` au premier démarrage ; il
  n'y a rien à amorcer et `initialization_jobs` est vide.
- **L'accès à l'API exige l'`API_SERVER_KEY`.** L'endpoint compatible OpenAI sur
  le port 8642 s'authentifie avec un jeton bearer :
  ```bash
  KEY=$(gcloud secrets versions access latest --secret=<api-server-key-secret> --project "$PROJECT")
  curl -s -H "Authorization: Bearer $KEY" "$(gcloud run services describe <service-name> \
    --region "$REGION" --format='value(status.url)')/v1/models"
  ```
- **Première utilisation du tableau de bord.** Le tableau de bord web intégré au
  processus (gestion des clés d'API, configuration du profil) s'exécute sur le
  port 9119 derrière une authentification basique (`dashboard_username` / le mot
  de passe généré automatiquement dans Secret Manager). Cloud Run ne route que le
  port du conteneur (8642) ; le tableau de bord est donc injoignable sur cette
  variante — utilisez `kubectl port-forward` avec la variante GKE, ou configurez
  l'agent via sa propre interface de chat/d'API.
- **Configuration des connecteurs (Telegram).** Définissez
  `enable_telegram = true` et fournissez `telegram_bot_token` (obtenu auprès de
  @BotFather). Le connecteur Telegram de Hermes effectue un **long-polling
  sortant** — aucun webhook, routeur ni URL de rappel publique n'est nécessaire.
  Une validation au moment du plan rejette `enable_telegram = true` avec un jeton
  vide. Les autres connecteurs (Discord, Slack, WhatsApp, Signal) se configurent
  via la map `environment_variables` de l'opérateur.
- **Mises à jour de version.** Modifiez `application_version` et redéployez — le
  miroir recopie le tag si le digest a changé et une nouvelle révision est
  déployée. L'état de l'agent n'est pas touché (il réside sur NFS, et non dans
  l'image).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Hermes ou notables pour
lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet, identité et identifiants {#group-1--project-identity--credentials}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `anthropic_api_key` | `""` | Clé du fournisseur de modèles principal, injectée en tant que `ANTHROPIC_API_KEY`. Obligatoire lors du déploiement initial (ou utilisez OpenAI) ; omettez-la lors des mises à jour pour conserver la version stockée. |
| `api_server_key` | `""` (auto) | Jeton bearer du serveur d'API compatible OpenAI. Chaîne hexadécimale de 64 caractères générée automatiquement lorsqu'elle est vide. |
| `enable_openai` / `openai_api_key` | `false` / `""` | Fournisseur secondaire facultatif, injecté en tant que `OPENAI_API_KEY`. |
| `enable_dashboard` | `true` | Exécute le tableau de bord du port 9119 dans le processus (non routé sur Cloud Run). |
| `dashboard_username` / `dashboard_password` | `admin` / `""` (auto) | Authentification basique du tableau de bord ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hermes` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `nousresearch/hermes-agent` ; épinglez un tag de version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Ressources par instance ; l'agent effectue les appels aux modèles à distance, ce qui maintient une consommation de mémoire modérée. |
| `min_instance_count` | `1` | Conservez 1 — les connecteurs effectuent un long-polling sortant ; la mise à zéro fait manquer des messages. |
| `max_instance_count` | `1` | **Validé à 1** — SQLite à écrivain unique sur le NFS partagé. |
| `container_port` | `8642` | Port du serveur d'API compatible OpenAI de la passerelle. |
| `cpu_always_allocated` | `true` | Requis — le bridage du CPU casse le long-polling des connecteurs et les tours asynchrones de l'agent. Ne définissez pas `false`. |
| `execution_environment` | `gen2` | Requis pour le montage du volume NFS. |
| `timeout_seconds` | `3600` | Les sessions de l'agent peuvent être longues. |
| `enable_cloudsql_volume` | `false` | Hermes n'a pas de base de données. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle sans étape de build. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | URL `run.app` publique ; le serveur d'API applique sa propre authentification par jeton bearer. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Achemine le trafic NFS via le VPC ; le polling des connecteurs sort directement. |
| `enable_iap` | `false` | IAP bloquerait aussi les clients d'API programmatiques qui ne disposent que du jeton bearer. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configuration supplémentaire ; les variables gérées par le module (`API_SERVER_*`, `HERMES_DASHBOARD*`) sont prioritaires. À utiliser pour les identifiants des connecteurs Discord/Slack/WhatsApp/Signal ou pour les endpoints de fournisseurs (p. ex. OpenRouter). |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom d'un secret Secret Manager existant. |

### Groupe 11 — Stockage et NFS {#group-11--storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Obligatoire — validé.** L'identité complète de l'agent réside sous `/opt/data`. |
| `nfs_mount_path` | `/opt/data` | Répertoire de données fixe de l'image ; le partage NFS est monté directement dessus. |
| `gcs_volumes` | `[]` | Montages GCSFuse auxiliaires uniquement — n'en faites jamais pointer un vers `/opt/data` (SQLite n'est pas sûr sur GCSFuse). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 20s, 24 tentatives | Vérification de l'écoute du port TCP — sûre quelle que soit l'authentification du serveur d'API ; laisse de la marge pour le montage NFS et l'initialisation au premier démarrage. |
| `liveness_probe` | désactivée | Cloud Run ne prend pas en charge les sondes de vivacité TCP (le TCP est réservé au démarrage), et le comportement de `/health` de Hermes derrière l'authentification du serveur d'API n'a pas été vérifié. Ne l'activez avec un chemin HTTP qu'après avoir vérifié que l'endpoint est non authentifié. |
| `uptime_check_config` | désactivé | Un test de disponibilité non authentifié échouerait systématiquement face au serveur d'API authentifié. |

### Groupe 15 — Connecteurs Hermes {#group-15--hermes-connectors}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_telegram` | `false` | Provisionne le secret du jeton du bot Telegram et injecte `TELEGRAM_BOT_TOKEN`. |
| `telegram_bot_token` | `""` | Jeton du bot obtenu auprès de @BotFather ; obligatoire (validé) lorsque `enable_telegram = true`. |

Variables inertes reprises par convention : les variables de base de données
(groupe 12), Redis, SQL personnalisé et `additional_services`/`additional_containers`
sont déclarées pour la cohérence des conventions mais **ne sont pas
transmises** — Hermes n'a ni base de données ni Redis.

---

## 5. Sorties {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du serveur d'API de la passerelle. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide — aucune base de données à amorcer). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan.** Le `validation.tf` de ce module et le moteur
> du socle [App_CloudRun](App_CloudRun.md) valident les valeurs *et leurs
> combinaisons* au moment du plan — `max_instance_count > 1`, `enable_nfs = false`,
> un connecteur Telegram sans son jeton, ou OpenAI activé sans clé font tous
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (validé) | Critical | Une seconde instance concurrente écrit dans la même base SQLite sur NFS — la violation du modèle à écrivain unique corrompt l'intégralité de l'état de l'agent. |
| `enable_nfs` | `true` (validé) | Critical | Sans le montage NFS, `/opt/data` est un disque éphémère — chaque démarrage à froid / redéploiement efface silencieusement l'identité de l'agent (configuration, sessions, compétences, mémoires). |
| `gcs_volumes` sur `/opt/data` | jamais | Critical | GCSFuse ne dispose ni du verrouillage POSIX ni des renommages atomiques ; SQLite sur GCSFuse se corrompt. Conservez l'état sur NFS. |
| `min_instance_count` | `1` | High | Avec `0`, les connecteurs sont endormis entre les requêtes — les messages Telegram/Discord sont manqués jusqu'à ce qu'un appel HTTP entrant réveille par hasard l'instance. |
| `anthropic_api_key` (ou la paire OpenAI) | définie au premier déploiement | High | Sans aucune clé de fournisseur, l'agent ne peut exécuter aucun tour, et le secret Anthropic vide fait échouer le déploiement Cloud Run (« Secret was not found »). |
| `cpu_always_allocated` | `true` | High | La facturation à la requête bride le CPU à ~0 entre les requêtes, bloquant le long-polling des connecteurs et les tours asynchrones de l'agent. |
| `startup_probe` | TCP (par défaut) | Medium | Une sonde de démarrage HTTP sur le serveur d'API authentifié renvoie indéfiniment 401/403 — la révision ne devient jamais Ready et le déploiement progressif reste bloqué. |
| `liveness_probe` | désactivée (par défaut) | Medium | Les sondes s'exécutent sans authentification ; activer une sonde de vivacité HTTP exige de vérifier d'abord que l'endpoint est non authentifié — un endpoint renvoyant 401/403 tuerait des instances saines. Cloud Run n'offre pas d'option de vivacité TCP. |
| `application_version` | épinglez un tag de version | Medium | `latest` est résolu à nouveau à chaque exécution du miroir ; le comportement peut changer à votre insu lors d'un redéploiement. |
| `enable_telegram` sans jeton | bloqué | Low | La validation au moment du plan le rejette ; le connecteur ne peut pas démarrer sans le jeton du bot. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et modes de facturation, entrée et équilibrage de
charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La
configuration applicative propre à Hermes, partagée avec la variante GKE, est
décrite dans **[Hermes_Common](Hermes_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hermes Agent sur Cloud Run](../labs/Hermes_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Hermes Agent sur GKE Autopilot](Hermes_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hermes Common — Configuration applicative partagée](Hermes_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [OpenClaw sur Google Cloud Run](OpenClaw_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md) dans la solution **AI Agent Workspace**.
