---
title: "Loki sur GKE Autopilot"
description: "Référence de configuration pour déployer Loki sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Loki_GKE.md @ 3055034 sha256:35b5590c8f45 -->

# Loki sur GKE Autopilot {#loki-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Loki_GKE.png" alt="Loki sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Grafana Loki est un système d'agrégation de journaux évolutif horizontalement et
hautement disponible — souvent décrit comme « Prometheus pour les journaux ».
Contrairement aux indexeurs de journaux en texte intégral, Loki n'indexe qu'un petit
ensemble de labels par flux de journaux plutôt que le texte complet de chaque ligne,
ce qui maintient les coûts de stockage et d'exploitation à un niveau bas. On
l'interroge normalement en **LogQL** via **Grafana** (comme source de données) ou
l'outil **LogCLI**, un agent tel que **Promtail** ou **Grafana Alloy** se chargeant
de lui envoyer les journaux. Ce module déploie **Loki lui-même, et non Grafana**,
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Loki et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Loki s'exécute sous la forme d'un pod contenant un unique binaire Go, en **mode
monolithique** (`-target=all`, la valeur par défaut de Loki, qui exécute tous les
composants internes — distributor, ingester, querier, compactor — dans un seul
processus). Le déploiement assemble un ensemble restreint de services Google Cloud,
centré sur GCS :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod binaire Go, 1 vCPU / 512Mi par défaut, type de charge de travail `Deployment` |
| Stockage objet | Cloud Storage | Un unique bucket `storage` — le véritable backend de stockage objet de Loki pour les chunks et l'index TSDB expédié, et non un stockage de fichiers accessoire |
| Secrets | Secret Manager | Aucun n'est généré — `Loki_Common` déclare `secret_ids = {}` |
| Ingress | Cloud Load Balancing | `service_type = "LoadBalancer"` par défaut ; domaine personnalisé + IP statique en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** L'état durable de Loki (chunks, index
  TSDB) réside entièrement dans un bucket GCS. `database_type = "NONE"` et
  `enable_redis` n'a aucun effet sur la configuration propre de Loki.
- **`max_instance_count` est de fait figé à `1`.** `Loki_Common` impose
  `max_instance_count = 1` dans la configuration qu'il transmet à `App_GKE`, quelle
  que soit la valeur fournie. Le compactor de Loki (rétention/suppression) est un
  véritable singleton et la configuration intégrée utilise un **ring en mémoire**
  (`common.ring.kvstore.store: inmemory`) avec `replication_factor: 1`, qui ne peut
  pas se coordonner entre plusieurs réplicas.
- **Mono-tenant, sans authentification.** La configuration intégrée définit
  `auth_enabled: false`. Il n'y a aucune isolation par tenant ni aucune
  authentification intégrée — l'API HTTP de Loki est accessible à quiconque peut
  atteindre l'IP du LoadBalancer, sous réserve de la configuration de
  `service_type`/de l'ingress.
- **`workload_type = "Deployment"`, et non `"StatefulSet"`.** L'état durable de
  Loki est GCS, pas le disque local, si bien qu'un PVC bloc par pod n'est pas
  nécessaire au bon fonctionnement (une option `StatefulSet` existe via
  `stateful_pvc_enabled` pour la durabilité du cache d'index local, mais ce n'est
  pas la valeur par défaut).
- **`service_type = "LoadBalancer"`** expose Loki à l'extérieur par défaut, afin
  que les clients d'envoi de journaux situés hors du cluster (voire hors du projet)
  puissent l'atteindre. Définissez `reserve_static_ip = true` (la valeur par défaut)
  pour obtenir une adresse stable d'un redéploiement à l'autre.
- **Piloté par fichier de configuration, et non par variables d'environnement.**
  Les paramètres de stockage et de schéma de Loki résident entièrement dans un
  fichier de configuration intégré à l'image ; seul le nom du bucket GCS y est
  injecté au démarrage du pod via la variable d'environnement `LOKI_GCS_BUCKET`.
- **Aucun job d'initialisation.** `initialization_jobs` vaut `[]` par défaut —
  Loki n'a rien à amorcer.
- **Image construite sur mesure, à base distroless.** Voir
  [§4](#4-loki-application-behaviour) et
  [§7](#7-configuration-pitfalls--sensible-defaults) pour comprendre pourquoi le
  Dockerfile de ce module semble inhabituel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Loki {#a-gke-autopilot--the-loki-workload}

Loki s'exécute sous la forme d'un seul pod sur Autopilot, déployé par défaut en
tant que `Deployment`. Comme `max_instance_count` est de fait figé à `1`, cette
charge de travail ne se répartit pas horizontalement — sa « mise à l'échelle »
porte en réalité sur le dimensionnement des ressources (`cpu_limit`,
`memory_limit`), et non sur le nombre de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Loki pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud Storage — le backend de stockage objet de Loki {#b-cloud-storage--lokis-object-storage-backend}

Un bucket GCS `storage` dédié constitue le véritable backend de stockage de Loki,
et non un supplément facultatif. Loki y écrit directement les chunks de journaux
compressés et les fragments de l'index TSDB expédié via son client de stockage
`gcs` natif (Application Default Credentials — le compte de service GKE Workload
Identity reçoit `roles/storage.objectAdmin` sur le bucket).

- **Console :** Cloud Storage → Buckets → sélectionnez le bucket `storage`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<storage-bucket>/                 # top-level layout
  gcloud storage ls gs://<storage-bucket>/index_*/          # TSDB index shards (schema prefix "index_")
  gcloud storage du -s gs://<storage-bucket>/                # total bytes stored
  ```
  Les objets chunks et les fragments d'index s'accumulent respectivement à la
  racine du bucket et sous les préfixes `index_*`, conformément au `schema_config`
  intégré à l'image (`schema:
  v13`, `index.prefix: index_`, `index.period: 24h`).

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse (non
utilisés par le chemin de stockage propre de Loki, qui accède nativement à l'API
GCS et non à un système de fichiers monté).

### C. Secret Manager {#c-secret-manager}

Aucun secret n'est généré pour Loki — `Loki_Common` déclare `secret_ids = {}` et
`secret_values = {}`. Tout secret ajouté via `secret_environment_variables` est une
valeur que vous fournissez vous-même en tant qu'opérateur (par exemple si vous
placez devant Loki une couche d'authentification de type reverse proxy).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via l'IP d'un Service `LoadBalancer`
externe (`service_type = "LoadBalancer"`), afin que les clients d'envoi de journaux
situés hors du cluster puissent y pousser des journaux. Un domaine personnalisé avec
un certificat géré par Google peut être activé, et `reserve_static_ip = true` (la
valeur par défaut) maintient l'adresse stable d'un redéploiement à l'autre.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur les IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr du pod (les journaux du processus Loki lui-même, et non
les journaux qu'il *ingère*) sont acheminées vers Cloud Logging ; les métriques GKE
vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Interroger Loki {#3-querying-loki}

Ce module déploie Loki **sans interface web intégrée** — Loki est une tête de
réception pour les journaux, interrogée en LogQL. Deux manières courantes de
l'interroger une fois déployé :

- **`logcli`** (la CLI officielle de Grafana), pointée sur l'adresse externe du
  service :
  ```bash
  export LOKI_ADDR="http://<external-ip>:3100"
  logcli labels                                             # discover available labels
  logcli query '{job="myapp"}' --limit=50                   # LogQL query
  ```
- **HTTP direct** sur l'API de requête :
  ```bash
  curl -s "http://<external-ip>:3100/loki/api/v1/query?query=%7Bjob%3D%22myapp%22%7D" | jq .
  ```
- **Comme source de données Grafana** — ajoutez dans Grafana une source de données
  Loki pointant sur l'adresse externe du LoadBalancer ; c'est le schéma de
  production habituel pour explorer les journaux ingérés et en faire des tableaux
  de bord.

---

## 4. Comportement de l'application Loki {#4-loki-application-behaviour}

- **Gabarit de configuration au démarrage du pod, et non migrations de base de
  données.** `Loki_Common` intègre à l'image un gabarit de configuration comportant
  un unique espace réservé, `__LOKI_GCS_BUCKET__`. Le point d'entrée du conteneur y
  substitue le nom réel du bucket (injecté via la variable d'environnement
  `LOKI_GCS_BUCKET`) avec `sed` et écrit le résultat dans
  `/etc/loki/local-config.yaml` avant le démarrage de Loki — il n'y a aucune étape
  de schéma au premier démarrage à attendre.
- **Aucun job d'initialisation nécessaire.** Loki n'a pas de base de données à
  amorcer ; `initialization_jobs` est donc vide par défaut et ce module n'en injecte
  jamais.
- **Le chemin de santé est `/ready`.** Les sondes de démarrage et de vivacité
  ciblent toutes deux le point de terminaison de disponibilité intégré de Loki, non
  authentifié, qui renvoie HTTP 200 dès que le serveur écoute — généralement en
  quelques secondes.
- **Mode monolithique.** `-target=all` exécute tous les composants de Loki dans un
  seul processus — la forme adaptée à un déploiement mono-tenant de petite ou
  moyenne taille.
- **Contrainte de mise à l'échelle à instance unique.** Le ring en mémoire et le
  compactor singleton font que Loki n'est pas conçu ici pour exécuter plus d'une
  instance simultanément. `Loki_Common` l'impose en figeant
  `max_instance_count = 1` dans la configuration qu'il transmet au socle,
  quelle que soit la valeur de l'entrée de la plateforme.
- **`workload_type` et durabilité.** `Deployment` est la valeur par défaut et
  suffit — l'état durable de Loki est GCS, pas le disque local. Un `StatefulSet`
  avec `stateful_pvc_enabled = true` (monté sur `/var/cache/loki`) existe en option
  pour la durabilité du cache d'index local et de l'espace de travail du compactor
  entre les redémarrages de pod, mais il n'est pas nécessaire au bon
  fonctionnement.
- **Rétention.** La configuration intégrée définit
  `limits_config.retention_period: 720h` (30 jours), la suppression étant assurée
  par le compactor (`retention_enabled: true`, `delete_request_store: gcs`).
- **Inspecter l'environnement du pod en cours d'exécution (par exemple pour
  confirmer que le bucket a bien été injecté) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep LOKI_GCS_BUCKET
  ```

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Loki ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `loki` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout vers l'ARG de build épinglé `LOKI_VERSION` (`3.6.12`) — **et non** vers l'`APP_VERSION` générique, que le socle forcerait sinon vers un tag Loki `latest` inexistant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `min_instance_count` / `max_instance_count` | `1` / `1` | `max_instance_count` est **ramené à `1` par `Loki_Common` quelle que soit cette valeur** — voir [§1](#1-overview). |
| `container_port` | `3100` | Port d'écoute HTTP de Loki — fixé par la configuration intégrée (`server.http_listen_port`). Le modifier sans modifier aussi le gabarit de configuration casse le déploiement. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Augmentez la mémoire pour des ensembles de labels à forte cardinalité ou une charge de requêtes élevée. |
| `enable_cloudsql_volume` | `false` | Désactivé — Loki n'a pas de base de données. |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'exposition externe est la valeur par défaut — nécessaire pour les clients d'envoi de journaux situés hors du cluster. |
| `workload_type` | `Deployment` | Suffisant, puisque l'état durable de Loki est GCS et non le disque local. |
| `session_affinity` | `None` | Aucune affinité de pod n'est nécessaire à l'échelle par défaut d'un seul réplica. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Facultatif : passer à un PVC bloc par pod (monté sur `/var/cache/loki`) pour la durabilité du cache d'index local entre les redémarrages. Non nécessaire — l'état durable de Loki est GCS. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Loki n'a besoin d'aucun job d'initialisation. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Buckets supplémentaires, en plus du bucket `storage` provisionné automatiquement que Loki utilise réellement pour les chunks et l'index. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Loki n'a aucun usage intégré de Redis ; cette variable n'existe que par souci de cohérence avec le socle. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le stockage durable de Loki est le bucket GCS, et non Cloud SQL. Toutes les autres variables de base de données du groupe 16 sont inopérantes. |

### Groupe 19 — Domaine personnalisé et réseau {#group-19--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Maintient l'adresse du LoadBalancer stable d'un redéploiement à l'autre — recommandé lorsque des clients externes codent en dur le point de terminaison d'envoi de Loki. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 6. Sorties {#6-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL permettant d'atteindre Loki. |
| `storage_buckets` | Buckets de stockage créés — y compris le bucket `storage` que Loki utilise pour les chunks et l'index TSDB. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Toujours vides — `database_type = "NONE"`. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` | Toujours vide — Loki n'a besoin d'aucun job d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 7. Pièges de configuration et valeurs par défaut judicieuses {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

> **Remarque pour les opérateurs et mainteneurs : pourquoi le Dockerfile de ce
> module semble inhabituel.** L'image officielle `grafana/loki` est **réellement
> distroless** — l'inspection de son système de fichiers ne montre que
> `/usr/bin/loki`, sans shell, sans coreutils et sans aucun éditeur de liens
> dynamique. Un schéma de Dockerfile standard (`RUN chmod +x
> /entrypoint.sh`) échoue purement et simplement au build
> (`exec: /bin/sh: no such file or
> directory`) parce que `RUN` a besoin d'un shell. La première tentative de
> correction — greffer un binaire busybox issu du tag par défaut `busybox:stable`
> via un `COPY` multi-étapes — a *elle aussi* échoué, avec l'erreur plus
> déroutante `exec /bin/busybox: no such file or
> directory`, parce que le binaire de `busybox:stable` est **lié dynamiquement** et
> que la cible distroless ne dispose d'aucun éditeur de liens dynamique pour le
> satisfaire. La solution a consisté à passer à `busybox:musl`, dont on a vérifié
> avec `file` qu'il est réellement **lié statiquement** (aucun interpréteur
> nécessaire) : `FROM busybox:musl AS busybox` dans une étape réservée au build,
> `COPY
> --from=busybox /bin/busybox /bin/busybox` dans l'image finale à base distroless,
> et `ENTRYPOINT ["/bin/busybox", "sh", "/entrypoint.sh"]` (busybox invoqué
> directement par son chemin absolu — aucun lien symbolique d'applet n'existe, si
> bien que même le script de point d'entrée appelle `/bin/busybox sed ...` plutôt
> qu'un simple `sed`). Si vous touchez un jour à ce Dockerfile, ou le clonez pour
> une autre application à base distroless sur GKE, retenez ceci : **vérifiez qu'un
> tag busybox greffé est réellement statique** (`file
> <binary>` ne doit afficher ni `interpreter` ni liaison dynamique) avant de
> supposer qu'il fonctionnera dans une cible distroless.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | Laisser la valeur par défaut (de fait figée à `1`) | Critical | Même si `Loki_Common` la ramène à `1` dans la configuration qu'il transmet au socle, ne comptez pas sur une mise à l'échelle horizontale de Loki dans cette forme de déploiement — le ring en mémoire et le compactor singleton ne sont pas conçus pour des réplicas simultanés. |
| `container_port` | `3100` (ne pas modifier sans modifier aussi le gabarit de configuration) | Critical | Le `server.http_listen_port` de Loki est intégré au fichier de configuration et n'est pas lu depuis `container_port` à l'exécution — une incohérence entre les deux casse le routage entre le Service Kubernetes et le pod. |
| `service_type` | `LoadBalancer` pour l'envoi externe de journaux | High | Avec `ClusterIP`, Loki n'est accessible que depuis l'intérieur du cluster, ce qui bloque les agents Promtail/Alloy exécutés ailleurs. |
| Contrôle d'accès | Aucun par défaut (`auth_enabled: false`) | High | L'API HTTP de Loki (envoi et requête) n'a aucune authentification intégrée. Quiconque peut atteindre l'IP externe peut envoyer ou interroger des journaux. Placez devant elle Cloud Armor, IAP ou une couche d'authentification de type reverse proxy si cela compte pour votre déploiement. |
| `application_version` | Épingler un tag explicite (par ex. `3.6.12`) en production | Medium | `"latest"` se résout silencieusement vers le tag actuellement épinglé par le Dockerfile de `Loki_Common`, qui ne change que lorsque le code source du module change. |
| `container_resources.memory_limit` | Dépasser `512Mi` pour des labels à forte cardinalité ou une charge de requêtes élevée | Medium | Le moteur de requêtes de Loki et son cache d'index en mémoire peuvent subir un OOM sous charge avec la valeur par défaut prudente. |
| `reserve_static_ip` | `true` | Medium | Avec `false`, l'IP externe peut changer lors d'un redéploiement et (selon le constat GKE à l'échelle du parc documenté pour d'autres modules) des valeurs autoréférentes de type `GKE_SERVICE_URL` peuvent se rabattre sur un nom DNS interne injoignable si elles sont calculées avant que l'IP éphémère du LoadBalancer soit connue. |
| `database_type` | Laisser à `NONE` | Low | Toute autre valeur n'a aucun effet — `Loki_Common` ne câble jamais de connexion à une base de données dans la configuration de Loki, quoi qu'il arrive. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Loki, partagée avec
la variante Cloud Run, est décrite dans **[Loki_Common](Loki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Loki sur GKE Autopilot](../labs/Loki_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Loki sur Google Cloud Run](Loki_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Loki Common — Configuration applicative partagée](Loki_Common.md) — la configuration partagée par les deux cibles de déploiement.
