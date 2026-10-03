---
title: "Agent d'analyse de données sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de l'agent d'analyse de données sur Google Cloud Run avec le module RAD — variables, architecture, exécution de code en sandbox et opérations."
---

<!-- translated-from: docs/modules/DataAnalyst_CloudRun.md @ 15fd4c7 sha256:c9298533a78f -->

# Agent d'analyse de données sur Google Cloud Run {#data-analyst-agent-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DataAnalyst_CloudRun.png" alt="Agent d'analyse de données sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

L'agent d'analyse de données permet à un utilisateur de télécharger un petit fichier de données
(CSV, TSV, JSON, texte brut ou Excel) et de poser des questions à son sujet en langage
naturel. Contrairement à un assistant de chat typique, il ne devine jamais : il écrit du
vrai Python (pandas/numpy/matplotlib) et l'exécute — isolé dans le
[lanceur de sandbox](https://docs.cloud.google.com/run/docs/configuring/services/sandboxes)
de Cloud Run (gVisor) — pour calculer la réponse réelle, et peut renvoyer un véritable
graphique avec son explication. Ce module déploie l'agent sur **Cloud Run v2** au-dessus
de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par l'agent et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à chaque application Cloud Run — identité de service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python (FastAPI + Google ADK) ; mise à l'échelle automatique basée sur les requêtes par défaut |
| Modèle d'IA | Vertex AI (Gemini) | Pas de secret de clé API à gérer — utilise le compte de service d'exécution du service Cloud Run, auquel `roles/aiplatform.user` est accordé |
| Exécution de code | Lanceur de sandbox de Cloud Run | Isolé par gVisor : sortie réseau refusée par défaut, écritures ignorées après chaque appel, pas d'accès aux variables d'environnement de ce service |
| Données téléchargées | Stockage de conteneur éphémère | Pas de base de données ni de bucket GCS — un fichier ne vit sous `/tmp/uploads/<session>/` que pendant la durée d'une session de chat |
| Réseau | VPC / Sortie VPC directe | Déployable de manière autonome (VPC intégré) ou convergé sur un réseau `Services_GCP` partagé lorsqu'il en existe un dans le projet |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; Identity-Aware Proxy fortement recommandé (voir ci-dessous) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de credential backend.** L'agent n'a pas de clé API ni de mot de passe de base de
  données — l'authentification Vertex AI est entièrement l'identité d'exécution propre au
  service Cloud Run. Le seul secret Secret Manager qu'il peut détenir est la clé d'accès
  visiteur décrite ci-dessous.
- **`public_access` est par défaut `true`.** Contrairement à la plupart des modules du
  catalogue, celui-ci n'a pas de matériel de référence propriétaire à protéger (il a
  commencé sa vie comme conseiller de chat de catalogue de référence et a ensuite été
  réaffecté en tant qu'agent d'exécution de code en sandbox à usage général — voir
  [DataAnalyst_Common](DataAnalyst_Common.md) pour cette histoire), il n'y a donc aucune
  raison de confidentialité de restreindre qui peut le déployer en libre-service.
- **Le lanceur de sandbox EST la limite de sécurité, pas une commodité.** Chaque appel
  d'outil d'exécution de code/prévisualisation de fichier passe par lui. La
  désactivation de `enable_sandbox_launcher` supprime entièrement l'isolation des processus — ce n'est
  pas un réglage de performance.
- **Chaque exécution `execute_code` a son propre plafond de mémoire/CPU** (`execute_code_memory_limit_mb`,
  512 MiB par défaut), indépendant et inférieur à la `memory_limit` globale du conteneur
  — une allocation incontrôlée échoue proprement avec `MemoryError` plutôt que de menacer
  l'instance entière.
- **Les graphiques sont livrés par le serveur, et non confiés au modèle.** L'agent peut
  générer un graphique matplotlib ; l'image est extraite directement de la réponse de
  l'appel d'outil et poussée vers le navigateur comme son propre message — jamais
  dépendante de survivre intacte dans la réponse en langage naturel du modèle.
- **Pas d'isolation stricte entre les sessions de chat concurrentes sur une instance
  chaude.** Les répertoires de session sont nommés avec un UUID impossible à deviner, mais
  il s'agit d'une limite souple, pas d'une limite au niveau du système d'exploitation —
  voir §3 et §6.
- **`min_instance_count` est par défaut `0`** (mise à l'échelle à zéro) ; le démarrage à
  froid est rapide car il n'y a pas de dépôt à cloner et pas de connexion à la base de
  données à établir.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service agent {#a-cloud-run--the-agent-service}

L'agent s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une révision
immuable.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic. Notez que `max_concurrent_requests` est
appliqué via une échappatoire `gcloud beta run services
update` après la création du service (App_CloudRun
n'a pas de remplacement de concurrence de première classe) — confirmez qu'il a pris effet :
```bash
gcloud run services describe <service-name> --region "$REGION" \
  --format='value(spec.template.spec.containerConcurrency)'
```

### B. Vertex AI — le backend du modèle {#b-vertex-ai--the-model-backend}

L'agent appelle Gemini via Vertex AI en utilisant le compte de service d'exécution du
service Cloud Run — il n'y a pas de clé API à créer, stocker ou faire pivoter.

- **Console :** Vertex AI → Model Garden, ou vérifiez IAM pour l'octroi `roles/aiplatform.user`
  sur le compte de service d'exécution.
- **CLI :**
  ```bash
  gcloud projects get-iam-policy "$PROJECT" \
    --flatten="bindings[].members" \
    --filter="bindings.role:roles/aiplatform.user"
  ```

### C. Le lanceur de sandbox de Cloud Run — isolation de l'exécution de code {#c-cloud-runs-sandbox-launcher--code-execution-isolation}

Ce n'est pas une ressource que vous parcourez dans la console, mais le mécanisme central
que ce module est destiné à utiliser. Appliqué après le déploiement via une échappatoire
`gcloud beta` (`--sandbox-launcher`, aucun champ Terraform de première classe n'existe encore pour
cela — voir `enable_sandbox_launcher`).

- **Confirmez qu'il est appliqué :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(metadata.annotations)'
  ```
- **Confirmez qu'il isole réellement les appels réels** — recherchez les lignes
  `[start]`/`[end] exit_code=...` dans Cloud Logging autour d'une interaction de chat réelle :
  ```bash
  gcloud logging read 'resource.type="cloud_run_revision"
    resource.labels.service_name="<service-name>" textPayload:"sandbox"' \
    --project "$PROJECT" --freshness=10m --order=asc
  ```

Les sandboxes Cloud Run sont une fonctionnalité en **préversion publique** — le contrat
d'invocation exact et la disponibilité sont sujets à modification sans garanties de
stabilité de niveau GA.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Si le projet a déjà un
déploiement `Services_GCP`, ce module converge vers son VPC partagé au lieu de maintenir
son propre réseau intégré — voir §6 pour ce que cela signifie lors d'une mise à jour.

- **Console :** Cloud Run (URL du service) ; Réseau VPC → Réseaux VPC / Sous-réseaux.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute networks list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les paramètres d'entrée, la sortie VPC et
l'équilibrage de charge.

### E. Cloud Logging et Monitoring — journaux d'appels d'outils structurés {#e-cloud-logging--monitoring--structured-tool-call-logs}

Chaque appel `list_uploaded_files`/`inspect_file`/`execute_code` émet une ligne JSON (nom de l'outil,
ID de session, succès/échec, durée, code de sortie) — Cloud Logging analyse cela
automatiquement en champs `jsonPayload` et `severity`, sans bibliothèque de journalisation
ni dépendance ajoutée.

- **Console :** Journalisation → Explorateur de journaux.
- **CLI — requête par champ, pas par texte brut :**
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

- **Flux de travail télécharger-puis-demander, plusieurs fichiers à la fois.** Le contrôle
  de téléchargement de la page de chat accepte plusieurs fichiers en une seule sélection
  (téléchargés séquentiellement, un `POST /upload` par fichier), de sorte que l'analyse
  inter-fichiers (par exemple, la jointure de deux CSV) ne nécessite pas d'étape
  "attacher" distincte dans le protocole de chat. Les fichiers sont validés par extension
  (`allowed_upload_extensions`) et une limite de taille en flux (`max_upload_size_mb`) avant qu'un seul octet
  ne touche le disque.
- **Stockage éphémère, limité à la session.** Les fichiers téléchargés vivent sous
  `/tmp/uploads/<session_id>/` pendant la durée d'une session de chat — nettoyés de manière
  opportuniste la prochaine fois que quelqu'un télécharge sur la même instance, une fois
  plus anciens que `upload_ttl_seconds`. Un démarrage à froid ou une instance différente
  commence sans rien de téléchargé.
- **L'agent calcule ; il ne devine pas.** Chaque question non triviale est répondue en
  écrivant et en exécutant du vrai code (`execute_code`), jamais en raisonnant à partir
  d'une prévisualisation de fichier seule. Si le code génère une erreur, l'agent lit la
  trace, la corrige et réessaie — visible directement dans les journaux structurés (§2E)
  comme un appel échoué suivi d'un appel réussi.
- **Génération de graphiques, livrée de manière fiable.** L'agent peut rendre un
  graphique matplotlib (backend Agg, pas d'affichage nécessaire) en imprimant une ligne de
  marqueur `CHART_PNG_BASE64:<base64>` depuis l'intérieur de la sandbox ; le serveur l'extrait de la
  réponse brute de l'appel d'outil et le pousse vers le navigateur comme son propre
  message d'image — indépendamment de ce que dit la réponse textuelle du modèle, car un
  LLM n'est pas toujours fiable pour citer textuellement un blob de plusieurs centaines de
  Ko.
- **Prise en charge d'Excel.** Les fichiers `.xlsx` sont acceptés avec les
  CSV/TSV/JSON/texte brut (`openpyxl` prend en charge le moteur Excel de pandas).
- **Prévisualisation sensible à la structure pour JSON.** Plutôt qu'une troncature brute
  d'octets qui pourrait couper un fichier JSON au milieu de sa structure, la
  prévisualisation de fichier de l'agent renvoie les premiers éléments de liste ou clés
  de dictionnaire, joliment imprimés, ne revenant à une prévisualisation brute que si
  l'analyse échoue.
- **Plafond de ressources par appel.** Chaque exécution `execute_code` applique sa propre
  limite de mémoire (`RLIMIT_AS`) et de temps CPU (`RLIMIT_CPU`) avant que le code
  généré ne s'exécute, limitée par `execute_code_memory_limit_mb` et le délai d'attente de l'appel
  — indépendamment de, et en dessous de, la `memory_limit` globale du conteneur.
- **Protections contre les abus/coûts.** Une limite de longueur de message et de débit par
  connexion, plus une limite par instance sur les messages par minute pour toutes les
  connexions (`INSTANCE_MAX_MESSAGES_PER_MINUTE`, 120 par défaut, `0` pour désactiver), limitent la
  facturation Vertex AI (et le nombre d'exécutions `execute_code`) qu'un appelant peut
  générer. La limite par connexion seule est contournée en ouvrant une autre connexion ;
  celle par instance ne l'est pas.
- **Une clé d'accès sur un projet géré par RAD.** Avec `access_control = "auto"` (par défaut), un
  projet géré par RAD (facturé à RAD) nécessite une **clé d'accès** par déploiement
  chaque fois que le service est accessible publiquement (pas de `enable_iap`, entrée
  non `internal`) ; un projet que vous possédez reste inchangé. Les visiteurs voient
  une boîte de connexion ; après que la clé a été saisie une fois, le serveur définit un
  cookie de session signé, `HttpOnly`, `Secure`, `SameSite=Strict` (12 heures). Jusque-là,
  `/upload` et `/ws/chat` répondent 401, et un service mal configuré sans clé
  utilisable répond 503 — il échoue fermé. Laissez `access_key` vide et une clé de 32
  caractères est générée et affichée comme la **sortie `access_key`** (propriétaire
  et administrateurs uniquement) ; définissez la vôtre (16+ caractères) pour la garder
  hors de l'onglet Sorties. La modifier entraîne une nouvelle révision et déconnecte tout
  le monde. La clé est partagée, pas par utilisateur. Un déployeur ne peut pas la
  désactiver sur un projet géré par RAD ; seul un administrateur le peut. Les scripts
  l'envoient comme un en-tête `X-Access-Key`, ou `POST /auth` avec `{"key": "..."}` ;
  `/docs`, `/redoc` et `/openapi.json` ne sont pas servis.
- **Un service ouvert sur un projet géré par RAD est limité en échelle.** IAP ne peut pas
  être la valeur par défaut (il nécessite un écran de consentement OAuth dans le projet,
  qu'un projet géré par RAD fraîchement créé n'a pas et ne peut plus être donné par
  API), donc bien que `enable_iap = false` et `ingress_settings = "all"`, un projet géré par RAD (facturé à
  RAD) est limité à `max_instance_count <= 2` et `max_concurrent_requests <= 10` — les valeurs par défaut du module —
  et le plan refuse des valeurs plus grandes. Derrière IAP, avec `ingress_settings = "internal"`, ou dans
  votre propre projet, il n'y a pas de telle limite.
- **Non disponible dans un sandbox ou un projet de labo géré par RAD.** Vertex AI n'est
  pas autorisé dans ces niveaux, de sorte que le plan refuse le déploiement d'emblée avec
  un message indiquant la solution (un projet géré par RAD de développement ou de
  production, ou votre propre projet GCP).

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour `DataAnalyst_CloudRun` sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dataanalyst` | Nom de base pour le service Cloud Run et le dépôt Artifact Registry. |
| `application_display_name` | `Data Analyst Agent` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Description du service. |
| `application_version` | `1.1.0` | Tag de version de l'image du conteneur — à incrémenter à chaque redéploiement de code uniquement, car l'image est référencée par un tag mutable, et non par un digest. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance — marge au-dessus du plancher habituel de 512 MiB de la plateforme, car le chargement d'un fichier téléchargé par pandas/numpy en bénéficie. |
| `min_instance_count` | `0` | Instances minimales (0 = mise à l'échelle à zéro). |
| `max_instance_count` | `2` | Instances maximales. |
| `execution_environment` | `gen2` | Requis par le lanceur de sandbox. |
| `container_protocol` | `http1` | HTTP/1.1 simple + WebSocket. |
| `timeout_seconds` | `600` | Maintenu généreux car le WebSocket de chat le maintient ouvert pendant un tour. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le VPC. |
| `enable_iap` | `false` | Chaque message ici est un véritable appel Vertex AI ET peut déclencher l'exécution de code. Pas la valeur par défaut car IAP nécessite un écran de consentement OAuth dans le projet ; tant qu'il est désactivé sur un projet géré par RAD, une clé d'accès est requise et l'échelle est limitée (voir ci-dessus). |
| `access_control` | `auto` | `auto` : une clé d'accès est requise sur un projet géré par RAD tant que le service est accessible publiquement, inchangée sur votre propre projet ; `required` : toujours ; `off` : jamais (refusé sur un projet géré par RAD). |
| `access_key` | `""` | Votre propre clé (16+ caractères). Vide en génère une, affichée comme la sortie `access_key`. Changez-la pour la faire pivoter. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. |
| `secret_environment_variables` | `{}` | Non utilisé par ce module par défaut — l'agent n'a pas de secret propre. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrée clé spécifique à ce module :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `additional_cloudrun_sa_roles` | `["roles/aiplatform.user"]` | Rôles IAM supplémentaires pour le compte de service Cloud Run. **Doit conserver `roles/aiplatform.user`** — le supprimer rompt chaque message de chat avec une erreur d'autorisation Vertex AI. |

### Groupe 10 — Domaine, CDN et Cloud Armor {#group-10--domain-cdn--cloud-armor}

Options standard d'équilibrage de charge d'App_CloudRun (`application_domains`, `enable_cdn`,
`enable_cloud_armor`, `admin_ip_ranges`) — voir [App_CloudRun](App_CloudRun.md).

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `GET /_health` | Correspond à la route de santé du serveur FastAPI. Non nommé `/healthz` — confirmé en direct que le routage de périphérie de Cloud Run traite ce chemin exact comme réservé et n'atteint jamais le conteneur. |
| `uptime_check_config` | désactivé | Vérification de la disponibilité de Cloud Monitoring. |

### Groupe 15 — Configuration de l'agent d'analyse de données {#group-15--data-analyst-agent-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `vertex_region` | `us-central1` | Région Vertex AI servant les appels Gemini de l'agent. |
| `agent_model` | `gemini-2.5-flash` | ID du modèle Gemini utilisé via Vertex AI. |
| `enable_sandbox_launcher` | `true` | La véritable limite de sécurité pour l'exécution de code — voir §1. |
| `max_upload_size_mb` | `20` | Appliqué en diffusant le téléchargement et en le rejetant une fois que ce nombre d'octets est arrivé — jamais fiable à partir de la taille déclarée de la requête. |
| `allowed_upload_extensions` | `[".csv", ".tsv", ".json", ".txt", ".xlsx"]` | Extensions acceptées par le point de terminaison de téléchargement. |
| `upload_ttl_seconds` | `3600` | Durée de conservation d'un fichier téléchargé avant l'éligibilité au nettoyage. |
| `execute_code_memory_limit_mb` | `512` | Plafond de mémoire par appel `execute_code` — à maintenir confortablement en dessous de `memory_limit`. |
| `max_concurrent_requests` | `10` | Limite de connexions WebSocket concurrentes par instance — également le bouton à régler sur `1` si la mise en garde d'isolation inter-sessions (§6) est importante pour vos données. |
| `require_services_gcp_module` | `false` | Ce module n'a pas de dépendance de base de données/NFS/GKE propre, il se déploie donc de manière autonome dans un projet vierge par défaut. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`,
`organization_id`, `enable_audit_logging`) — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut — ouvrez-la pour discuter avec l'agent. |
| `access_key_required` | Si l'agent exige une clé d'accès. |
| `access_key` | La clé d'accès générée à saisir sur l'écran de connexion (vide si vous avez choisi votre propre clé ou si aucune n'est requise). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `sandbox_launcher_enabled` | Si `--sandbox-launcher` a été appliqué. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` | Réseau VPC utilisé, et s'il a été découvert (partagé) plutôt que créé en ligne. |
| `storage_buckets` | Toujours vide — ce module ne provisionne aucun bucket GCS. |
| `monitoring_enabled` | Statut de surveillance. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé)
> — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_sandbox_launcher` | `true` | Critique | `false` supprime la SEULE isolation entre le code généré par LLM et le reste du conteneur — l'ensemble du modèle de sécurité du module dépend de son maintien. |
| `enable_iap` / `access_control` | IAP, ou une clé d'accès, pour tout ce qui dépasse un test rapide | Élevé | Sur votre propre projet avec `access_control = "auto"` et IAP désactivé, le service est ouvert : tout appelant peut générer des facturations Vertex AI et des exécutions de code, limitées uniquement par les limites de débit. Définissez `access_control = "required"` ou activez IAP. |
| `execute_code_memory_limit_mb` | confortablement en dessous de `memory_limit` | Élevé | Défini trop près (ou au-dessus) de `memory_limit`, une seule allocation pathologique peut toujours menacer l'instance entière au lieu d'échouer proprement avec `MemoryError`. |
| `max_concurrent_requests` | `1` pour des données véritablement sensibles | Moyen | Les répertoires de session ne sont isolés que par un nom impossible à deviner, et non par une limite de permission au niveau du système d'exploitation — des sessions concurrentes sur une instance chaude peuvent, en principe, lire les fichiers téléchargés les uns des autres. |
| `application_version` | incrémenter à chaque changement de code uniquement | Moyen | L'image est référencée par un tag mutable ; la reconstruction sous le même tag ne crée pas de nouvelle révision, de sorte qu'un "redéploiement" continue silencieusement de servir l'ancien conteneur. |
| `allowed_upload_extensions` | se limiter aux formats de données uniquement | Moyen | L'élargissement à des types de fichiers arbitraires étend ce qu'un processus Python en sandbox mais réel peut être invité à analyser. |
| `upload_ttl_seconds` | plus court pour les déploiements publics | Faible | Un TTL long maintient les données téléchargées d'un étranger sur le disque de l'instance plus longtemps que nécessaire si l'onglet du navigateur est simplement abandonné. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application partagée (construction
de conteneur, gestion des téléchargements et modèle d'exécution de code en sandbox) est
décrite dans **[DataAnalyst_Common](DataAnalyst_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [DataAnalyst Common — Configuration d'application partagée](DataAnalyst_Common.md) — la configuration partagée par cette cible de déploiement.
