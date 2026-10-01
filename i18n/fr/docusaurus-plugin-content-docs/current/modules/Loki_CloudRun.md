---
title: "Loki sur Google Cloud Run"
description: "Référence de configuration pour déployer Loki sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Loki_CloudRun.md @ 3055034 sha256:a5d3ba7dc12e -->

# Loki sur Google Cloud Run {#loki-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Loki_CloudRun.png" alt="Loki sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana Loki est un système d'agrégation de journaux évolutif horizontalement et hautement disponible —
souvent décrit comme « Prometheus pour les journaux ». Contrairement aux indexeurs de journaux en texte intégral, Loki
n'indexe qu'un petit ensemble de libellés par flux de journaux plutôt que le texte intégral de chaque
ligne, ce qui maintient des coûts de stockage et d'exploitation faibles. On l'interroge normalement avec
**LogQL** via **Grafana** (en tant que source de données) ou l'outil **LogCLI**, un
agent tel que **Promtail** ou **Grafana Alloy** lui envoyant les journaux. Ce module
déploie **Loki lui-même, et non Grafana**, sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Loki et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Loki s'exécute comme un conteneur à binaire Go unique sur Cloud Run v2, en **mode monolithique**
(`-target=all`, la valeur par défaut de Loki, qui exécute chaque composant interne — distributor,
ingester, querier, compactor — dans un seul processus). Le déploiement assemble un
ensemble restreint de services Google Cloud centré sur GCS :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service à binaire Go, 1 vCPU / 512Mi par défaut, facturation à la requête |
| Stockage d'objets | Cloud Storage | Un unique bucket `storage` — le véritable backend de stockage d'objets de Loki pour les chunks et l'index TSDB expédié, et non un stockage de fichiers accessoire |
| Secrets | Secret Manager | Aucun généré — `Loki_Common` déclare `secret_ids = {}` |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** L'état durable de Loki (chunks, index TSDB) réside
  entièrement dans un bucket GCS. `database_type = "NONE"` et `enable_redis` n'a aucun
  effet sur la configuration propre de Loki.
- **`max_instance_count` est de fait épinglé à `1`.** `Loki_Common` impose
  `max_instance_count = 1` dans la configuration qu'il transmet à `App_CloudRun`, quelle que soit
  la valeur fournie. Le compactor de Loki (rétention/suppression) est un véritable singleton et
  la configuration intégrée utilise un **anneau en mémoire** (`common.ring.kvstore.store: inmemory`)
  avec `replication_factor: 1`, qui ne peut pas se coordonner entre plusieurs instances.
- **Mono-locataire, sans authentification.** La configuration intégrée définit `auth_enabled: false`. Il n'y a
  ni isolation par locataire ni authentification intégrée — l'API HTTP de Loki est
  accessible à quiconque peut atteindre l'URL du service, sous réserve de `ingress_settings`.
- **Facturation à la requête par défaut (`cpu_always_allocated = false`).** L'ingestion,
  les requêtes et le cycle de compaction interne de Loki s'exécutent tous en réponse directe à des requêtes
  HTTP, sans travail d'arrière-plan de longue durée nécessitant du CPU au repos.
- **Piloté par un fichier de configuration, pas par des variables d'environnement.** Les paramètres de stockage/schéma de Loki résident
  entièrement dans un fichier de configuration intégré à l'image ; seul le nom du bucket GCS est
  injecté par gabarit au démarrage du conteneur via la variable d'environnement `LOKI_GCS_BUCKET`.
- **Pas de jobs d'initialisation.** `initialization_jobs` vaut `[]` par défaut — Loki n'a rien à
  amorcer.
- **Image construite sur mesure, basée sur distroless.** Consultez la [§4](#4-loki-application-behaviour)
  et la [§7](#7-configuration-pitfalls--sensible-defaults) pour comprendre pourquoi le Dockerfile de
  ce module semble inhabituel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont
indiqués dans les [sorties](#6-outputs) du déploiement.

### A. Cloud Run — le service Loki {#a-cloud-run--the-loki-service}

Loki s'exécute comme un unique service Cloud Run v2 qui se met à l'échelle selon la charge de requêtes. Comme
`max_instance_count` est de fait épinglé à `1`, l'« autoscaling » signifie ici en réalité
la mise à l'échelle à zéro et le retour, plutôt qu'une répartition horizontale.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud Storage — le backend de stockage d'objets de Loki {#b-cloud-storage--lokis-object-storage-backend}

Un bucket GCS `storage` dédié est le véritable backend de stockage de Loki, et non un supplément
facultatif. Loki y écrit directement les chunks de journaux compressés et les fragments d'index TSDB expédiés
via son client de stockage `gcs` natif (Application Default Credentials — le compte de service
d'exécution Cloud Run reçoit `roles/storage.objectAdmin` sur le
bucket).

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/                 # top-level layout
  gcloud storage ls gs://<storage-bucket>/index_*/          # TSDB index shards (schema prefix "index_")
  gcloud storage du -s gs://<storage-bucket>/                # total bytes stored
  ```
  Les objets chunk et les fragments d'index s'accumulent respectivement à la racine du bucket et sous les préfixes `index_*`,
  conformément au `schema_config` intégré à l'image (`schema:
  v13`, `index.prefix: index_`, `index.period: 24h`).

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK (non utilisées par
le chemin de stockage propre de Loki, qui accède nativement à l'API GCS et non à un système de fichiers monté).

### C. Secret Manager {#c-secret-manager}

Aucun secret n'est généré pour Loki — `Loki_Common` déclare `secret_ids = {}` et
`secret_values = {}`. Tous les secrets que vous ajoutez via `secret_environment_variables` sont
vos propres valeurs fournies par l'opérateur (p. ex. si vous placez devant Loki une couche
d'authentification par proxy inverse).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings =
"all"`), ce qui permet aux clients d'expédition de journaux (Promtail, Alloy) situés en dehors du VPC
du projet d'envoyer des journaux. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud
CDN et Cloud Armor peut être ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du processus Loki lui-même (et non les journaux qu'il *ingère* — ceux-ci sont des données applicatives
au sein du service Loki, pas des entrées Cloud Logging) sont acheminés vers Cloud Logging ; les métriques
Cloud Run vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Interroger Loki {#3-querying-loki}

Ce module déploie Loki **sans interface web intégrée** — Loki est une tête de réception pour les journaux,
interrogée via LogQL. Deux façons courantes de l'interroger une fois déployé :

- **`logcli`** (la CLI officielle de Grafana), pointée vers l'URL du service :
  ```bash
  export LOKI_ADDR="$SERVICE_URL"
  logcli labels                                             # discover available labels
  logcli query '{job="myapp"}' --limit=50                   # LogQL query
  ```
- **HTTP direct** sur l'API de requête :
  ```bash
  curl -s "$SERVICE_URL/loki/api/v1/query?query=%7Bjob%3D%22myapp%22%7D" | jq .
  ```
- **En tant que source de données Grafana** — ajoutez dans Grafana une source de données Loki pointant vers
  l'URL du service ; c'est le schéma habituel en production pour explorer les journaux ingérés et en
  faire des tableaux de bord.

---

## 4. Comportement de l'application Loki {#4-loki-application-behaviour}

- **Gabarit de configuration appliqué au démarrage du conteneur, pas de migrations de base de données.** `Loki_Common`
  intègre à l'image un gabarit de configuration comportant un seul espace réservé,
  `__LOKI_GCS_BUCKET__`. Le point d'entrée du conteneur remplace le nom réel du bucket
  (injecté via la variable d'environnement `LOKI_GCS_BUCKET`) avec `sed` et écrit le résultat dans
  `/etc/loki/local-config.yaml` avant le démarrage de Loki — il n'y a aucune étape de schéma au premier démarrage
  à attendre.
- **Aucun job d'initialisation nécessaire.** Loki n'a aucune base de données à amorcer ;
  `initialization_jobs` est donc vide par défaut et ce module n'en injecte jamais.
- **Le chemin de santé est `/ready`.** Les sondes de démarrage et de vivacité ciblent toutes deux le point de terminaison
  de disponibilité intégré et non authentifié de Loki, qui renvoie HTTP 200 dès que le
  serveur écoute — généralement en quelques secondes, puisqu'il n'y a ni migration ni
  travail lourd au premier démarrage.
- **Mode monolithique.** `-target=all` exécute chaque composant de Loki (distributor,
  ingester, querier, query-frontend, compactor) dans l'unique processus — la
  forme adaptée à un déploiement mono-locataire de petite ou moyenne taille. Loki prend aussi en charge un
  mode microservices (conteneurs séparés par composant) pour les déploiements à très grande échelle,
  que ce module n'implémente pas.
- **Contrainte de mise à l'échelle à instance unique.** L'anneau en mémoire
  (`common.ring.kvstore.store: inmemory`) et le job de rétention singleton du compactor
  font que Loki n'est pas conçu ici pour exécuter plus d'une instance simultanément.
  `Loki_Common` l'impose en épinglant `max_instance_count = 1` dans la configuration qu'il
  transmet au socle, quelle que soit la valeur de l'entrée de la plateforme.
- **Rétention.** La configuration intégrée définit `limits_config.retention_period: 720h` (30
  jours), le compactor se chargeant de la suppression (`retention_enabled: true`,
  `delete_request_store: gcs`).
- **Inspecter l'environnement du conteneur en cours d'exécution (p. ex. pour confirmer que le bucket
  a bien été injecté) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Loki ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `loki` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout en l'ARG de build épinglé `LOKI_VERSION` (`3.6.12`) — **et non** en l'`APP_VERSION` générique, que le socle forcerait sinon vers un tag Loki `latest` inexistant. Définissez un tag explicite (p. ex. `3.6.12`) pour épingler une version précise. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_port` | `3100` | Port d'écoute HTTP de Loki — fixé par la configuration intégrée (`server.http_listen_port`). Le modifier sans modifier aussi le gabarit de configuration cassera le déploiement. |
| `max_instance_count` | `1` | **Forcé à `1` par `Loki_Common` quelle que soit cette valeur** — voir la [§1](#1-overview). |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Limites de ressources par instance. Augmentez la mémoire pour des ensembles de libellés à forte cardinalité ou une charge de requêtes importante. |
| `cpu_always_allocated` | `false` | Facturation à la requête — Loki n'a aucun travail d'arrière-plan au repos. |
| `enable_cloudsql_volume` | `false` | Désactivé — Loki n'a pas de base de données. |
| `execution_environment` | `gen2` | Gen2 recommandé. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour que les clients d'expédition de journaux externes (Promtail, Alloy) situés en dehors du VPC du projet puissent atteindre l'API d'envoi. |
| `enable_iap` | `false` | L'activation d'IAP bloque les envois et requêtes de journaux non authentifiés des agents externes. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en clair, fusionnées par-dessus `LOKI_GCS_BUCKET` (injectée automatiquement). Loki ne lit presque rien depuis l'environnement — sa configuration est pilotée par fichier. |
| `secret_environment_variables` | `{}` | Aucun secret n'est nécessaire par défaut. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Buckets supplémentaires au-delà du bucket `storage` provisionné automatiquement, que Loki utilise réellement pour les chunks/l'index. |
| `enable_nfs` | `false` | Inutile pour le stockage propre de Loki (adossé à GCS), contrairement aux applications adossées à SQLite de ce catalogue. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le stockage durable de Loki est le bucket GCS, pas Cloud SQL. Toutes les autres variables du Groupe 12 sont inertes. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Loki n'a besoin d'aucun job d'initialisation. Laissé vide à la fois par ce module et par `Loki_Common`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/ready`, délai de 30s | Point de terminaison de disponibilité intégré de Loki — devient sain en quelques secondes puisqu'il n'y a aucune étape de migration. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Loki n'a aucun usage intégré de Redis ; cette variable n'existe que par souci d'exhaustivité vis-à-vis du socle. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 6. Sorties {#6-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `storage_buckets` | Buckets Cloud Storage créés — y compris le bucket `storage` qu'utilise Loki pour les chunks et l'index TSDB. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Toujours vides — `database_type = "NONE"`. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Toujours vide — Loki n'a besoin d'aucun job d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails du CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

> **Note à l'intention des opérateurs et mainteneurs : pourquoi le Dockerfile de ce module semble
> inhabituel.** L'image officielle `grafana/loki` est **réellement distroless** —
> l'inspection de son système de fichiers ne montre que `/usr/bin/loki`, sans shell, sans coreutils
> et sans aucun éditeur de liens dynamique. Un motif de Dockerfile standard (`RUN chmod +x
> /entrypoint.sh`) échoue purement et simplement au build (`exec: /bin/sh: no such file or
> directory`) parce que `RUN` a besoin d'un shell. La première tentative de correction — greffer un
> binaire busybox issu du tag par défaut `busybox:stable` via un `COPY` multi-étapes —
> a *elle aussi* échoué, avec l'erreur plus déroutante `exec /bin/busybox: no such file or
> directory`, car le binaire de `busybox:stable` est **lié dynamiquement** et la
> cible distroless n'a aucun éditeur de liens dynamique pour le satisfaire. La correction a consisté à passer à
> `busybox:musl`, dont on a vérifié avec `file` qu'il est réellement **lié statiquement** (aucun
> interpréteur nécessaire) : `FROM busybox:musl AS busybox` dans une étape réservée au build, `COPY
> --from=busybox /bin/busybox /bin/busybox` dans l'image finale basée sur distroless,
> et `ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]` (busybox invoqué
> directement par chemin absolu — aucun lien symbolique d'applet n'existe, si bien que même le script
> de point d'entrée appelle `/bin/busybox sed ...` plutôt qu'un simple `sed`). Si vous touchez un jour
> à ce Dockerfile, ou si vous le clonez pour une autre application basée sur distroless,
> souvenez-vous : **vérifiez qu'un tag busybox greffé est réellement statique** (`file
> <binary>` ne doit afficher ni `interpreter` ni « dynamically linked ») avant de supposer qu'il
> s'exécutera dans une cible distroless.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | Laisser la valeur par défaut (de fait épinglée à `1`) | Critical | Même si `Loki_Common` la force à `1` dans la configuration qu'il transmet au socle, ne comptez pas sur une mise à l'échelle horizontale de Loki dans cette forme de déploiement — l'anneau en mémoire et le compactor singleton ne sont pas conçus pour des instances simultanées. |
| `container_port` | `3100` (ne pas modifier sans modifier aussi le gabarit de configuration) | Critical | Le `server.http_listen_port` de Loki est intégré au fichier de configuration, et non lu depuis `container_port` à l'exécution — une incohérence entre les deux casse le routage entre Cloud Run et le conteneur. |
| `ingress_settings` | `all` pour l'expédition de journaux externe | High | Définir `internal` empêche les agents Promtail/Alloy s'exécutant en dehors du VPC du projet d'envoyer des journaux. |
| `enable_iap` | `false`, sauf si tous les clients d'expédition de journaux peuvent s'authentifier via IAP | High | IAP bloque toutes les requêtes non authentifiées, y compris l'API d'envoi utilisée par les agents d'expédition de journaux. |
| Contrôle d'accès | Aucun par défaut (`auth_enabled: false`) | High | L'API HTTP de Loki (envoi et requête) n'a aucune authentification intégrée. Quiconque peut atteindre l'URL du service peut envoyer ou interroger des journaux. Placez devant elle IAP, une règle Cloud Armor ou une couche d'authentification par proxy inverse si cela compte pour votre déploiement. |
| `application_version` | Épingler un tag explicite (p. ex. `3.6.12`) en production | Medium | `"latest"` se résout silencieusement en le tag qu'épingle actuellement le Dockerfile de `Loki_Common`, qui ne change que lorsque la source du module change — ce n'est pas un `latest` amont en direct, mais pas non plus une valeur que vous maîtrisez par déploiement sans définir de tag explicite. |
| `memory_limit` | Augmenter au-delà de `512Mi` pour des libellés à forte cardinalité ou une charge de requêtes importante | Medium | Le moteur de requêtes de Loki et son cache d'index en mémoire peuvent manquer de mémoire (OOM) sous charge avec la valeur par défaut prudente. |
| `database_type` | Laisser à `NONE` | Low | Toute autre valeur est sans effet — `Loki_Common` ne câble jamais de connexion à une base de données dans la configuration de Loki, quoi qu'il arrive. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Loki partagée
avec la variante GKE est décrite dans **[Loki_Common](Loki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Loki sur Cloud Run](../labs/Loki_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Loki sur GKE Autopilot](Loki_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Loki Common — Configuration applicative partagée](Loki_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [VictoriaMetrics sur GKE Autopilot](VictoriaMetrics_GKE.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md) et [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Observability & On-call**.
