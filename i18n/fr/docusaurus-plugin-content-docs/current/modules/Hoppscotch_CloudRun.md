---
title: "Hoppscotch sur Google Cloud Run"
description: "Référence de configuration pour déployer Hoppscotch sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Hoppscotch_CloudRun.md @ 3055034 sha256:2b6f3121a3dd -->

# Hoppscotch sur Google Cloud Run {#hoppscotch-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hoppscotch_CloudRun.png" alt="Hoppscotch sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hoppscotch est une plateforme open source de développement d'API, dans l'esprit de
Postman, qui permet de concevoir, d'envoyer et d'inspecter des requêtes HTTP, GraphQL
et WebSocket depuis le navigateur. Ce module déploie le **frontend Hoppscotch
auto-hébergé** sous forme d'application monopage sans état sur **Cloud Run v2**, en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Hoppscotch et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Hoppscotch s'exécute sous forme d'application web monopage statique (servie par
Caddy) dans un conteneur sur Cloud Run v2. Elle est volontairement **sans état** —
aucune base de données, aucun cache, aucun stockage persistant — si bien que le
déploiement n'assemble qu'un petit ensemble de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur SPA statique sur le port 3000 ; 1 vCPU / 512 MiB par défaut ; mise à l'échelle à zéro |
| Image de conteneur | Artifact Registry + Cloud Build | Build personnalisé minimal `FROM hoppscotch/hoppscotch-frontend`, tag répliqué dans Artifact Registry |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |
| Secrets | Secret Manager | **Aucun secret propre à l'application** — Hoppscotch ne requiert aucun secret |
| Observabilité | Cloud Logging & Monitoring | Journaux du conteneur, métriques, test de disponibilité et alertes en option |

Services volontairement **non** utilisés : **Cloud SQL** (`database_type = "NONE"`),
**Cloud Storage** (aucun bucket) et **Redis** (désactivé par défaut ; le frontend
statique n'a ni limitation de débit côté serveur ni file d'attente à alimenter).

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Jamais de base de données.** `database_type = "NONE"` et `enable_cloudsql_volume = false`.
  Hoppscotch conserve l'ensemble des collections, environnements et historiques dans
  le **stockage local du navigateur**, il n'y a donc aucun état côté serveur. Définir
  un type de base de données ne fait que dépenser de l'argent pour une instance Cloud
  SQL inactive — la variante GKE le bloque même au moment du plan.
- **L'image frontend seule est utilisée à dessein.** L'image tout-en-un
  `hoppscotch/hoppscotch` embarque un backend NestJS qui effectue un `exit(1)` en
  l'absence de `DATABASE_URL`. Ce module utilise `hoppscotch/hoppscotch-frontend`,
  qui sert la SPA sur le port 3000 sans exiger de backend.
- **C'est `HOPPSCOTCH_VERSION`, et non `APP_VERSION`, qui fige l'image.** Un build
  personnalisé définit un ARG `HOPPSCOTCH_VERSION` propre à l'application afin que la
  variable `APP_VERSION` injectée par le socle n'écrase pas le tag ;
  `application_version = "latest"` se résout en un tag figé et éprouvé au moment du
  build.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
  La première requête après une période d'inactivité subit un démarrage à froid de
  quelques secondes. Comme l'application est une SPA statique sans travail de
  préchauffage, les démarrages à froid sont peu coûteux ; définissez
  `min_instance_count = 1` uniquement si vous voulez éliminer cette latence de
  première requête.
- **Facturation à la requête par défaut** (`cpu_always_allocated = false`).
  Hoppscotch n'effectue aucun travail d'arrière-plan dans le processus, le CPU n'est
  donc facturé que pendant le traitement d'une requête.
- **Entrée publique par défaut.** `ingress_settings = "all"` expose l'URL `run.app`.
  Activez IAP pour exiger une connexion Google sur les déploiements internes ou
  réservés à l'organisation.
- **Aucun secret ni bucket de stockage** n'est provisionné par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Hoppscotch {#a-cloud-run--the-hoppscotch-service}

Hoppscotch s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal (`0`) et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements progressifs sûrs. Le conteneur écoute
sur le **port 3000** et répond à `GET /` avec l'interface de l'application (HTTP 200).

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~hoppscotch"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected port and env of the live revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports,spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Image de conteneur — Artifact Registry et Cloud Build {#b-container-image--artifact-registry--cloud-build}

Comme `container_image_source = "custom"`, l'image est construite par Cloud Build à
partir du `Dockerfile` minimal (`FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}`)
puis poussée vers Artifact Registry (la mise en miroir des images est activée par défaut
pour éviter les limites de débit de Docker Hub).

- **Console :** Artifact Registry → Repositories ; Cloud Build → History.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
    --include-tags --filter="package~hoppscotch"
  ```

Le nom du dépôt et l'URI de l'image figurent dans les [Sorties](#5-outputs)
(`artifact_registry_repository`, `container_image`).

### C. Secret Manager {#c-secret-manager}

Hoppscotch ne provisionne **aucun secret applicatif** — `secret_ids` est vide. Vous
pouvez toujours associer vos propres références variable d'environnement → secret via
`secret_environment_variables` si vous étendez le déploiement, mais rien n'est requis.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hoppscotch"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation
des secrets.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut via son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run
vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en
option. Un test de disponibilité sur `/` confirme que la SPA est servie.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Hoppscotch {#3-hoppscotch-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Il n'y a ni
  job `db-init`, ni instance Cloud SQL, ni schéma. Le conteneur sert immédiatement un
  bundle statique.
- **Aucune persistance côté serveur.** Les collections, environnements, historiques
  de requêtes et paramètres résident dans le **stockage local du navigateur** sur la
  machine de chaque utilisateur. Redéployer, revenir à zéro instance ou déployer une
  nouvelle révision ne fait perdre aucune donnée utilisateur — il n'y en a aucune à
  perdre sur le serveur.
- **Aucune clé immuable.** Sans secret ni base de données, il n'existe aucun élément
  cryptographique susceptible de corrompre des données stockées s'il était modifié.
  Les rotations ne posent aucun problème.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/`,
  qui renvoie l'interface de l'application (HTTP 200) dès que Caddy écoute sur le port
  3000 — généralement en quelques secondes. Une sonde en échec signifie presque
  toujours que le tag d'image est invalide, et non qu'un backend est injoignable.
- **Aucun compte administrateur au premier lancement.** Le frontend auto-hébergé ne
  dispose d'aucune connexion ni gestion des utilisateurs propre ; ouvrez l'URL et
  commencez à construire vos requêtes. (Les espaces de travail d'équipe, qui exigent
  le backend et une base de données, sont volontairement hors du périmètre de ce
  module.)
- **La mise à l'échelle n'est pas contrainte.** En l'absence de file d'attente ou de
  base de données partagée, un nombre quelconque d'instances peut s'exécuter
  indépendamment — augmentez librement `max_instance_count` comme plafond de coût et
  de débit.
- **Vérifier la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  curl -sS -o /dev/null -w '%{http_code}\n' "$(gcloud run services describe <service-name> \
    --region "$REGION" --format='value(status.url)')/"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Hoppscotch ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hoppscotch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Hoppscotch` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Hoppscotch ; `latest` se résout au moment du build en un tag `hoppscotch-frontend` figé et éprouvé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure de support. |
| `container_image_source` | `custom` | Build personnalisé minimal `FROM hoppscotch/hoppscotch-frontend`. Conservez `custom`. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance ; ≥ 256Mi (le plancher gen2 est de 512Mi). |
| `cpu_always_allocated` | `false` | Facturation à la requête — Hoppscotch n'effectue aucun travail d'arrière-plan. |
| `container_port` | `3000` | Port sur lequel écoute la SPA frontend. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `3` | Plafond de coût et de débit ; peut être relevé sans risque (aucun état partagé). |
| `execution_environment` | `gen2` | Recommandé pour un démarrage et un réseau plus rapides. |
| `timeout_seconds` | `60` | Durée maximale d'une requête (0–3600). |
| `enable_cloudsql_volume` | `false` | Hoppscotch n'a pas de base de données — laissez `false`. |
| `enable_image_mirroring` | `true` | Répliquer l'image dans Artifact Registry (évite les limites de Docker Hub). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | URL `run.app` publique. Utilisez `internal` / IAP pour les déploiements privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'acheminer que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger une connexion Google devant Hoppscotch. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair supplémentaires facultatives (par ex. `{ PORT = "3000" }`). Aucune n'est requise. |
| `secret_environment_variables` | `{}` | Références facultatives variable d'environnement → Secret Manager. Aucune n'est requise. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut. Le frontend statique n'a ni file d'attente ni limiteur de débit côté serveur ; laissez-le désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si vous intégrez Redis pour un usage personnalisé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Hoppscotch est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide — pas d'amorçage de base de données). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par
> le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — IAP sans identités autorisées, un environnement
> d'exécution `gen1` avec des montages NFS/GCS, des valeurs `timeout_seconds`/`redis_port`
> hors plage. Une configuration invalide fait échouer le **plan** avec une erreur
> claire et nommée avant la création de toute ressource ; la plupart des erreurs
> ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` fait pointer le service vers un chemin Artifact Registry jamais construit (`Image not found`) ; Hoppscotch exige le build personnalisé `hoppscotch-frontend`. |
| `application_version` | `latest` ou un tag `hoppscotch-frontend` réel | Élevé | Un tag invalide fait échouer le Cloud Build (`MANIFEST_UNKNOWN`) ; le service exécute alors une image obsolète ou absente. |
| `enable_cloudsql_volume` | `false` | Moyen | L'activer monte un sidecar Auth Proxy pour une base de données inexistante — coût inutile et dépendance superflue. |
| `container_port` | `3000` | Élevé | Le frontend ne sert que sur le port 3000 ; un port différent fait échouer la sonde de démarrage et la révision ne devient jamais Ready. |
| `memory_limit` | `512Mi` | Moyen | Une valeur inférieure à 512Mi est rejetée en raison du plancher de l'environnement d'exécution gen2 ; le plan ou l'application échoue. |
| `enable_iap` | `false` pour un usage public | Élevé | Activer IAP sans identifiants OAuth expose ou bloque l'application sans avertissement ; l'activer délibérément exige une connexion Google pour chaque requête. |
| `min_instance_count` | `0` (ou `1` pour éviter les démarrages à froid) | Faible | La mise à l'échelle à zéro ajoute un léger délai de démarrage à froid à la première requête après une période d'inactivité ; sans conséquence pour une SPA statique. |
| `enable_redis` | `false` | Faible | Le frontend statique n'a pas de file d'attente côté serveur ; activer Redis ajoute un coût sans aucun bénéfice. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Hoppscotch,
partagée avec la variante GKE, est décrite dans
**[Hoppscotch_Common](Hoppscotch_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hoppscotch sur Cloud Run](../labs/Hoppscotch_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Hoppscotch sur GKE Autopilot](Hoppscotch_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hoppscotch Common — Configuration applicative partagée](Hoppscotch_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Woodpecker CI sur GKE Autopilot](Woodpecker_GKE.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Source Control & CI/CD**.
