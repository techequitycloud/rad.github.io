---
title: "Data Analyst Agent sur Google Cloud Run"
description: "Référence de configuration pour déployer le Data Analyst Agent sur Google Cloud Run avec le module RAD — variables, architecture, exécution de code en bac à sable et exploitation."
---

<!-- translated-from: docs/modules/DataAnalyst_CloudRun.md @ 3055034 sha256:aaa1861066dc -->

# Data Analyst Agent sur Google Cloud Run {#data-analyst-agent-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DataAnalyst_CloudRun.png" alt="Data Analyst Agent sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Le Data Analyst Agent permet à un utilisateur de téléverser un petit fichier de données (CSV, TSV, JSON, texte brut ou
Excel) et de poser des questions à son sujet en langage courant. Contrairement à un assistant conversationnel classique, il
ne devine jamais : il écrit du vrai code Python (pandas/numpy/matplotlib) et l'exécute — isolé dans le
[sandbox launcher](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes) de Cloud Run
(gVisor) — pour calculer la réponse réelle, et peut renvoyer un véritable graphique accompagnant son
explication. Ce module déploie l'agent sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise l'agent et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python (FastAPI + Google ADK) ; mise à l'échelle automatique en fonction des requêtes par défaut |
| Modèle d'IA | Vertex AI (Gemini) | Aucun secret de clé d'API à gérer — utilise le propre compte de service d'exécution du service Cloud Run, qui reçoit `roles/aiplatform.user` |
| Exécution de code | Sandbox launcher de Cloud Run | Isolation gVisor : sortie réseau refusée par défaut, écritures supprimées après chaque appel, aucun accès aux variables d'environnement propres à ce service |
| Données téléversées | Stockage éphémère du conteneur | Aucune base de données et aucun bucket GCS — un fichier ne réside que sous `/tmp/uploads/<session>/` pendant la durée d'une session de discussion |
| Réseau | VPC / Direct VPC Egress | Déployable de manière autonome (VPC intégré) ou rattaché à un réseau `Services_GCP` partagé lorsqu'il en existe un dans le projet |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; Identity-Aware Proxy fortement recommandé (voir ci-dessous) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun identifiant d'aucune sorte.** L'agent n'a aucun secret Secret Manager, aucune clé d'API et aucun
  mot de passe de base de données — l'authentification à Vertex AI repose entièrement sur l'identité d'exécution
  propre du service Cloud Run. Ce déploiement ne contient rien de secret qui puisse fuiter.
- **`public_access` vaut `true` par défaut.** Contrairement à la plupart des modules du catalogue, celui-ci n'a aucun
  contenu de référence propriétaire à protéger (il a d'abord été un conseiller conversationnel pour un catalogue de référence,
  puis a été réorienté vers un agent généraliste d'exécution de code en bac à sable —
  voir [DataAnalyst_Common](DataAnalyst_Common.md) pour cet historique), si bien qu'aucune
  raison de confidentialité ne justifie de restreindre qui peut le déployer en libre-service.
- **Le sandbox launcher EST la frontière de sécurité, pas une commodité.** Chaque
  appel d'outil d'exécution de code ou d'aperçu de fichier passe par lui. Désactiver `enable_sandbox_launcher`
  supprime entièrement l'isolation des processus — ce n'est pas un réglage de performance.
- **Chaque exécution d'`execute_code` a son propre plafond de mémoire et de CPU**
  (`execute_code_memory_limit_mb`, 512 MiB par défaut), indépendant de la `memory_limit` globale du
  conteneur et inférieur à celle-ci — une allocation incontrôlée échoue proprement avec `MemoryError` au lieu de
  menacer l'instance entière.
- **Les graphiques sont livrés par le serveur, sans dépendre du modèle.** L'agent peut générer un
  graphique matplotlib ; l'image est extraite directement de la réponse de l'appel d'outil et envoyée au
  navigateur comme message distinct — on ne compte jamais sur elle pour survivre intacte dans la réponse
  en langage naturel du modèle.
- **Aucune isolation stricte entre sessions de discussion simultanées sur une même instance chaude.** Les
  répertoires de session portent un UUID impossible à deviner, mais il s'agit d'une frontière souple, pas d'une
  frontière au niveau du système d'exploitation — voir §3 et §6.
- **`min_instance_count` vaut `0` par défaut** (mise à l'échelle à zéro) ; le démarrage à froid est rapide puisqu'il n'y a
  aucun dépôt à cloner ni aucune connexion à une base de données à établir.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources figurent
dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service de l'agent {#a-cloud-run--the-agent-service}

L'agent s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la
répartition du trafic. Notez que `max_concurrent_requests` est appliqué via une solution de contournement `gcloud beta run services
update` après la création du service (App_CloudRun n'offre pas de surcharge native
de la concurrence) — vérifiez qu'elle a bien pris effet :
```bash
gcloud run services describe <service-name> --region "$REGION" \
  --format='value(spec.template.spec.containerConcurrency)'
```

### B. Vertex AI — le backend du modèle {#b-vertex-ai--the-model-backend}

L'agent appelle Gemini via Vertex AI avec le propre compte de service d'exécution du service Cloud Run
— il n'y a aucune clé d'API à créer, stocker ou faire tourner.

- **Console :** Vertex AI → Model Garden, ou vérifiez dans IAM l'attribution de `roles/aiplatform.user`
  au compte de service d'exécution.
- **CLI :**
  ```bash
  gcloud projects get-iam-policy "$PROJECT" \
    --flatten="bindings[].members" \
    --filter="bindings.role:roles/aiplatform.user"
  ```

### C. Sandbox launcher de Cloud Run — isolation de l'exécution de code {#c-cloud-runs-sandbox-launcher--code-execution-isolation}

Ce n'est pas une ressource que l'on parcourt dans la console, mais le mécanisme central que ce module existe pour
exploiter. Il est appliqué après le déploiement via une solution de contournement `gcloud beta` (`--sandbox-launcher`, aucun
champ Terraform natif n'existe encore pour cela — voir `enable_sandbox_launcher`).

- **Vérifiez qu'il est appliqué :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(metadata.annotations)'
  ```
- **Vérifiez qu'il isole réellement les appels** — recherchez les lignes `[start]`/`[end] exit_code=...`
  dans Cloud Logging autour d'une véritable interaction de discussion :
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>" textPayload:"sandbox"' \
    --project "$PROJECT" --freshness=10m --order=asc
  ```

Les sandboxes Cloud Run sont une fonctionnalité en **Public Preview** — le contrat d'invocation exact et la
disponibilité peuvent changer sans les garanties de stabilité d'une version GA.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Si le projet comporte déjà un
déploiement `Services_GCP`, ce module se rattache à son VPC partagé au lieu de maintenir
son propre réseau intégré — voir §6 pour ce que cela implique lors d'une mise à jour.

- **Console :** Cloud Run (URL du service) ; VPC network → VPC networks / Subnets.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute networks list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les paramètres d'entrée, la sortie VPC et l'équilibrage de charge.

### E. Cloud Logging et Monitoring — journaux structurés des appels d'outils {#e-cloud-logging--monitoring--structured-tool-call-logs}

Chaque appel à `list_uploaded_files`/`inspect_file`/`execute_code` émet une ligne JSON (nom de
l'outil, identifiant de session, réussite/échec, durée, code de sortie) — Cloud Logging l'analyse
automatiquement en champs `jsonPayload` et en `severity`, sans bibliothèque de journalisation ni
dépendance supplémentaire.

- **Console :** Logging → Logs Explorer.
- **CLI — interrogez par champ, pas par texte brut :**
  ```bash
  # every failed execute_code call in the last hour
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>"
    jsonPayload.tool="execute_code" jsonPayload.ok=false' \
    --project "$PROJECT" --freshness=1h

  # a specific session's activity
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>"
    jsonPayload.session_id="<session-id>"' \
    --project "$PROJECT" --freshness=1h --order=asc
  ```

---

## 3. Comportement de l'application {#3-application-behaviour}

- **Flux « téléverser puis demander », plusieurs fichiers à la fois.** La commande de téléversement de la page de discussion
  accepte plusieurs fichiers en une seule sélection (téléversés séquentiellement, un `POST /upload` par
  fichier), si bien que l'analyse croisée de fichiers (par exemple la jointure de deux CSV) ne nécessite aucune étape « joindre » distincte dans
  le protocole de discussion. Les fichiers sont validés par extension (`allowed_upload_extensions`) et par un plafond de taille
  appliqué en flux (`max_upload_size_mb`) avant qu'un seul octet ne touche le disque.
- **Stockage éphémère, limité à la session.** Les fichiers téléversés résident sous
  `/tmp/uploads/<session_id>/` pendant la durée d'une session de discussion — nettoyés de manière opportuniste
  la prochaine fois que quelqu'un téléverse sur la même instance, une fois plus anciens que `upload_ttl_seconds`. Un
  démarrage à froid ou une autre instance démarre sans aucun fichier téléversé.
- **L'agent calcule ; il ne devine pas.** Toute question non triviale reçoit une réponse obtenue en
  écrivant et en exécutant du vrai code (`execute_code`), jamais en raisonnant à partir du seul aperçu d'un fichier.
  Si le code échoue, l'agent lit la trace d'appels, la corrige et réessaie — ce qui est visible
  directement dans les journaux structurés (§2E) sous la forme d'un appel en échec suivi d'un appel réussi.
- **Génération de graphiques, livrés de manière fiable.** L'agent peut produire un graphique matplotlib (backend
  Agg, aucun affichage requis) en imprimant une ligne marqueur `CHART_PNG_BASE64:<base64>` depuis
  l'intérieur du bac à sable ; le serveur l'extrait de la réponse brute de l'appel d'outil et l'envoie
  au navigateur comme message image distinct — indépendamment de ce que dit la réponse textuelle du modèle,
  car un LLM n'est pas fiable pour recopier mot pour mot un bloc de plusieurs centaines de Ko.
- **Prise en charge d'Excel.** Les fichiers `.xlsx` sont acceptés aux côtés des fichiers CSV/TSV/JSON/texte brut
  (`openpyxl` sert de moteur Excel à pandas).
- **Aperçu sensible à la structure pour JSON.** Plutôt qu'une troncature brute en octets qui pourrait couper un
  fichier JSON en pleine structure, l'aperçu de fichier de l'agent renvoie les premiers éléments d'une liste ou les premières clés
  d'un dictionnaire, mis en forme, et ne revient à un aperçu brut qu'en cas d'échec de l'analyse.
- **Plafond de ressources par appel.** Chaque exécution d'`execute_code` applique sa propre limite de mémoire (`RLIMIT_AS`)
  et de temps CPU (`RLIMIT_CPU`) avant l'exécution du code généré, bornée par
  `execute_code_memory_limit_mb` et par le délai d'expiration propre à l'appel — indépendante de la
  `memory_limit` globale du conteneur et inférieure à celle-ci.
- **Protections contre les abus et les coûts.** Un plafond de longueur de message et une limite de débit par connexion, plus un
  plafond par instance du nombre de messages par minute sur l'ensemble des connexions (`INSTANCE_MAX_MESSAGES_PER_MINUTE`,
  120 par défaut, `0` pour le désactiver), bornent la facturation Vertex AI (et le nombre d'exécutions
  d'`execute_code`) qu'un appelant non authentifié peut provoquer si `enable_iap` reste désactivé. La limite par connexion
  seule se contourne en ouvrant une autre connexion ; celle par instance, non.
- **Un service ouvert sur un projet géré par RAD est limité en échelle.** IAP ne peut pas être la valeur par défaut (il
  nécessite un écran de consentement OAuth dans le projet, qu'un projet géré par RAD fraîchement créé
  n'a pas et ne peut plus recevoir par API) ; ainsi, tant que `enable_iap = false` et
  `ingress_settings = "all"`, un projet géré par RAD (facturé à RAD) est limité à
  `max_instance_count <= 2` et `max_concurrent_requests <= 10` — les valeurs par défaut du module — et le plan
  refuse des valeurs supérieures. Derrière IAP, avec `ingress_settings = "internal"`, ou dans votre propre projet,
  cette limite ne s'applique pas.
- **Indisponible dans un projet géré par RAD de type sandbox ou lab.** Vertex AI n'est pas autorisé dans ces
  paliers ; le plan refuse donc le déploiement d'emblée avec un message indiquant l'alternative (un
  projet géré par RAD de développement ou de production, ou votre propre projet GCP).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls les paramètres
propres à `DataAnalyst_CloudRun` ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dataanalyst` | Nom de base du service Cloud Run et du dépôt Artifact Registry. |
| `application_display_name` | `Data Analyst Agent` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `1.0.0` | Tag de version de l'image de conteneur — incrémentez-le à chaque redéploiement portant uniquement sur le code, car l'image est référencée par un tag mutable et non par un digest. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance — marge au-delà du plancher habituel de 512Mi de la plateforme, utile à pandas/numpy lors du chargement d'un fichier téléversé. |
| `min_instance_count` | `0` | Nombre minimal d'instances (0 = mise à l'échelle à zéro). |
| `max_instance_count` | `2` | Nombre maximal d'instances. |
| `execution_environment` | `gen2` | Requis par le sandbox launcher. |
| `container_protocol` | `http1` | HTTP/1.1 simple + WebSocket. |
| `timeout_seconds` | `600` | Volontairement généreux, car le WebSocket de discussion reste ouvert pendant tout un tour. |

### Groupe 5 — Contrôle de l'accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminement du trafic sortant via le VPC. |
| `enable_iap` | `false` | **`true` fortement recommandé :** chaque message est ici un véritable appel Vertex AI ET peut déclencher une exécution de code, si bien qu'un point de terminaison non authentifié constitue une exposition notable en matière de coûts et d'abus. Ce n'est pas la valeur par défaut, car IAP nécessite un écran de consentement OAuth dans le projet ; tant qu'il est désactivé sur un projet géré par RAD, l'échelle est limitée (voir les protections contre les abus et les coûts ci-dessus). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Non utilisé par défaut par ce module — l'agent n'a aucun secret propre. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrée principale propre à ce module :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `additional_cloudrun_sa_roles` | `["roles/aiplatform.user"]` | Rôles IAM supplémentaires pour le compte de service Cloud Run. **Doit conserver `roles/aiplatform.user`** — le retirer fait échouer chaque message de discussion avec une erreur d'autorisation Vertex AI. |

### Groupe 10 — Domaine, CDN et Cloud Armor {#group-10--domain-cdn--cloud-armor}

Options d'équilibreur de charge standard d'App_CloudRun (`application_domains`, `enable_cdn`,
`enable_cloud_armor`, `admin_ip_ranges`) — consultez [App_CloudRun](App_CloudRun.md).

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /_health` | Correspond à la route de santé du serveur FastAPI. Elle ne s'appelle pas `/healthz` — il a été confirmé en production que le routage en périphérie de Cloud Run traite ce chemin exact comme réservé et n'atteint jamais le conteneur. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring. |

### Groupe 15 — Configuration du Data Analyst Agent {#group-15--data-analyst-agent-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `vertex_region` | `us-central1` | Région Vertex AI qui sert les appels Gemini de l'agent. |
| `agent_model` | `gemini-2.5-flash` | Identifiant du modèle Gemini utilisé via Vertex AI. |
| `enable_sandbox_launcher` | `true` | La véritable frontière de sécurité de l'exécution de code — voir §1. |
| `max_upload_size_mb` | `20` | Appliqué en lisant le téléversement en flux et en le rejetant dès que ce nombre d'octets est atteint — jamais sur la foi de la taille déclarée par la requête. |
| `allowed_upload_extensions` | `[".csv", ".tsv", ".json", ".txt", ".xlsx"]` | Extensions acceptées par le point de terminaison de téléversement. |
| `upload_ttl_seconds` | `3600` | Durée de conservation d'un fichier téléversé avant qu'il ne devienne éligible au nettoyage. |
| `execute_code_memory_limit_mb` | `512` | Plafond de mémoire par appel à `execute_code` — gardez-le nettement inférieur à `memory_limit`. |
| `max_concurrent_requests` | `10` | Plafond de connexions WebSocket simultanées par instance — c'est aussi le réglage à passer à `1` si la réserve sur l'isolation entre sessions (§6) compte pour vos données. |
| `require_services_gcp_module` | `false` | Ce module n'a aucune dépendance propre à une base de données, à NFS ou à GKE ; il se déploie donc par défaut de manière autonome dans un projet vierge. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`,
`organization_id`, `enable_audit_logging`) — consultez [App_CloudRun](App_CloudRun.md).

---

## 5. Outputs {#5-outputs}

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut — ouvrez-la pour discuter avec l'agent. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `sandbox_launcher_enabled` | Indique si `--sandbox-launcher` a été appliqué. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` | Réseau VPC utilisé, et s'il a été découvert (partagé) plutôt que créé en interne. |
| `storage_buckets` | Toujours vide — ce module ne provisionne aucun bucket GCS. |
| `monitoring_enabled` | État de la supervision. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_sandbox_launcher` | `true` | Critical | `false` supprime la SEULE isolation entre le code généré par le LLM et le reste du conteneur — tout le modèle de sécurité du module repose sur son maintien. |
| `enable_iap` | `true` pour tout usage au-delà d'un test rapide | High | Laissé à `false`, un appelant non authentifié peut provoquer une facturation Vertex AI illimitée et un nombre illimité d'exécutions de code, bornés uniquement par la limite de débit par connexion. |
| `execute_code_memory_limit_mb` | nettement inférieur à `memory_limit` | High | Trop proche de `memory_limit` (ou supérieur), une seule allocation pathologique peut encore menacer l'instance entière au lieu d'échouer proprement avec `MemoryError`. |
| `max_concurrent_requests` | `1` pour des données réellement sensibles | Medium | Les répertoires de session ne sont isolés que par un nom impossible à deviner, et non par une frontière d'autorisations au niveau du système d'exploitation — des sessions simultanées sur une même instance chaude peuvent, en principe, lire les fichiers téléversés les unes des autres. |
| `application_version` | à incrémenter à chaque modification du code seul | Medium | L'image est référencée par un tag mutable ; une reconstruction sous le même tag ne crée aucune nouvelle révision, si bien qu'un « redéploiement » continue silencieusement de servir l'ancien conteneur. |
| `allowed_upload_extensions` | limité aux formats de données | Medium | L'élargir à des types de fichiers arbitraires étend ce qu'un processus Python réel, bien qu'en bac à sable, peut être amené à analyser. |
| `upload_ttl_seconds` | plus court pour les déploiements publics | Low | Une durée longue conserve les données téléversées par un inconnu sur le disque de l'instance plus longtemps que nécessaire si l'onglet du navigateur est simplement abandonné. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité de service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et duplication d'images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative partagée (build du conteneur, gestion des téléversements et modèle d'exécution de code
en bac à sable) est décrite dans **[DataAnalyst_Common](DataAnalyst_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [DataAnalyst Common — Configuration applicative partagée](DataAnalyst_Common.md) — la configuration partagée par cette cible de déploiement.
