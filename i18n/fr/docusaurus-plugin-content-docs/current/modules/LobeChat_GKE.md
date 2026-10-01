---
title: "LobeChat sur GKE Autopilot"
description: "Référence de configuration pour déployer LobeChat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LobeChat_GKE.md @ 3055034 sha256:d7bd4e1d8406 -->

# LobeChat sur GKE Autopilot {#lobechat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LobeChat_GKE.png" alt="LobeChat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

LobeChat est une interface de chat LLM moderne et open source (construite avec Next.js) qui permet aux utilisateurs
de converser avec de nombreux fournisseurs de modèles — OpenAI, Anthropic, Google et d'autres — au travers
d'une interface unique et soignée, les utilisateurs fournissant leurs propres clés d'API côté client.
Ce module déploie LobeChat sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise LobeChat et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls et cycle de vie du déploiement — reportez-vous
au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LobeChat s'exécute comme une unique charge de travail web Next.js sans état sur Autopilot. Comme son
mode par défaut **stocké côté client** conserve tout l'état dans le navigateur, le déploiement assemble
un ensemble délibérément minimal de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 500m vCPU / 1 GiB par défaut, autoscaling horizontal |
| Base de données | *(aucune)* | `database_type = "NONE"` — aucun Cloud SQL n'est provisionné ; l'état réside dans le navigateur |
| Stockage d'objets | *(aucun)* | Sans état — aucun bucket GCS, montage NFS ni PVC déclaré par défaut |
| Cache | Redis (facultatif, désactivé) | Uniquement pour la limitation de débit / la détection de bots sur les déploiements publics |
| Secrets | Secret Manager (aucun par défaut) | LobeChat ne génère aucun secret ; injectez vous-même les clés de fournisseur si vous le souhaitez |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de secrets, pas de stockage.** LobeChat est sans état en mode
  stocké côté client — les utilisateurs ajoutent leurs propres clés d'API de modèles dans le navigateur. Il n'y a rien à
  sauvegarder ni rien à migrer. (Un mode serveur Postgres facultatif existe en amont mais
  n'est pas câblé par ce module.)
- **Le port 3210 est fixe.** L'image personnalisée épingle `PORT=3210` et `container_port =
  3210` ; ne le modifiez pas sans reconstruire l'image.
- **La valeur par défaut est `500m` CPU / `1Gi` de mémoire** (`container_resources`). Le processus SSR
  Next.js de LobeChat (avec ses dépendances de rendu `pdfjs-dist`/`@napi-rs/canvas`) manque de mémoire (OOM)
  et passe en `CrashLoopBackOff` à 512Mi (`JavaScript heap out of memory`) — 1Gi est le
  minimum pour un démarrage stable ; augmentez davantage `container_resources.memory_limit` sous
  une charge plus lourde.
- **Minimum 1 réplica** (`min_instance_count = 1`, imposé par le câblage). GKE ne
  prend pas en charge la mise à l'échelle à zéro ; au moins un pod tourne donc en permanence pour que l'interface reste
  accessible ; `max_instance_count = 3`.
- **Sans état — Deployment, pas StatefulSet.** Il n'y a pas de volume persistant ; les pods peuvent
  être remplacés librement et mis à l'échelle horizontalement sans prérequis de file d'attente ni de cache.
- **`service_type = LoadBalancer`, `session_affinity = None`.** Sans état de session
  côté serveur, les requêtes n'ont pas besoin de routage persistant.
- **Redis est facultatif et désactivé.** Activez-le uniquement pour ajouter une limitation de débit / une détection de bots
  devant un déploiement public.
- **`latest` correspond à un véritable tag d'image.** L'ARG de build `LOBECHAT_VERSION` transmet la
  version telle quelle, si bien que `application_version = "latest"` se résout en la véritable image
  `lobehub/lobe-chat:latest`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail LobeChat {#a-gke-autopilot--the-lobechat-workload}

Les pods LobeChat sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal
(1) et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail LobeChat pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment ou StatefulSet).

### B. Pas de base de données {#b-no-database}

LobeChat ne provisionne **aucune instance Cloud SQL** — `database_type = "NONE"`. En
mode stocké côté client, chaque conversation, paramètre et clé de fournisseur réside dans le
navigateur de l'utilisateur ; il n'y a donc aucune base de données côté serveur à laquelle se connecter, à sauvegarder ou à migrer, et
aucun sidecar Cloud SQL Auth Proxy n'est injecté. L'activation du mode serveur Postgres en amont de LobeChat
(pour la synchronisation entre appareils) sort du périmètre de ce module.

### C. Pas de stockage d'objets ni de volume persistant {#c-no-object-storage-or-persistent-volume}

Aucun bucket GCS, montage NFS ni PVC de bloc n'est déclaré par défaut (`storage_buckets` est
vide, `enable_nfs = false`, `stateful_pvc_enabled` non défini/`null`). La charge de travail est
sans état ; les pods ne portent aucune donnée persistante.

- **CLI (pour confirmer qu'aucun n'appartient à l'application) :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"          # none expected
  ```

### D. Redis (facultatif — limitation de débit / détection de bots) {#d-redis-optional--rate-limiting--bot-detection}

Redis est **désactivé par défaut** (`enable_redis = false`). Activez-le uniquement pour ajouter une
limitation de débit et une détection de bots devant une instance LobeChat publique. Lorsque
`enable_redis = true` et que `redis_host` est vide, l'application se rabat sur `127.0.0.1`
sauf si le Redis co-localisé avec NFS est utilisé — définissez `redis_host` (ou `enable_nfs = true`)
explicitement.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the Redis env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

LobeChat ne génère **aucun secret** — il n'y a aucune clé cryptographique à protéger. Secret
Manager (via le pilote Secret Store CSI) n'est utilisé que si *vous* choisissez d'injecter une
clé de fournisseur côté serveur (p. ex. `OPENAI_API_KEY`) via `secret_environment_variables`,
qui référence un secret que vous créez.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~lobechat"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une IP statique réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application LobeChat {#3-lobechat-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni tâche `db-init` ni schéma — la
  sortie `initialization_jobs` est vide. Le premier démarrage lance simplement le serveur Next.js.
- **Aucune migration.** Sans base de données côté serveur dans le mode par défaut, la mise à niveau de
  `application_version` déploie simplement une nouvelle image ; il n'y a aucun schéma à migrer.
- **Aucun compte administrateur / aucun identifiant par défaut.** Le mode stocké côté client de LobeChat n'a pas
  de magasin d'utilisateurs côté serveur. Le seul contrôle d'accès est la phrase secrète partagée facultative `ACCESS_CODE`
  (voir ci-dessous) ; sans elle, l'interface est ouverte à quiconque atteint l'IP du
  LoadBalancer.
- **Les utilisateurs fournissent leurs propres clés de modèles.** Chaque utilisateur colle ses clés d'API de fournisseur dans
  l'interface, conservées dans le `localStorage` du navigateur. Pour préconfigurer plutôt un fournisseur côté serveur,
  injectez p. ex. `OPENAI_API_KEY` (en tant que secret) et/ou `OPENAI_PROXY_URL` via
  `secret_environment_variables` / `environment_variables`.
- **Protégez l'accès avec `ACCESS_CODE`.** Pour tout déploiement exposé à l'extérieur, définissez une
  phrase secrète partagée afin que l'interface de chat (et les clés que collent les utilisateurs) ne soient pas exposées :
  ```bash
  # via the module: environment_variables = { ACCESS_CODE = "<passphrase>" }
  # verify it reached the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep ACCESS_CODE
  ```
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/` — le serveur
  Next.js de LobeChat y renvoie HTTP 200 une fois démarré, sans authentification. Laissez la fenêtre de
  démarrage par défaut pour le démarrage à froid de `next-server`.
- **Port fixe 3210.** L'image personnalisée épingle `PORT=3210` ; `container_port` doit rester
  `3210`.
- **`imagePullPolicy = Always` pour l'image mise en miroir.** App_GKE impose `Always` pour
  les images construites sur mesure ou mises en miroir, afin qu'un tag reconstruit soit de nouveau tiré au redéploiement plutôt que de
  servir une couche en cache obsolète.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à LobeChat ou notables pour lui sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lobechat` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image LobeChat ; `latest` correspond à la véritable image `lobehub/lobe-chat:latest`. Épinglez un tag précis en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_resources` | `500m` CPU / `1Gi` de mémoire | Requêtes/limites par pod. Le `next-server` de Next.js (avec ses dépendances de rendu `pdfjs-dist`/canvas) plante par manque de mémoire au démarrage sous 1Gi — augmentez encore la mémoire si vous constatez la même défaillance sous charge. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (GKE ne permet pas la mise à l'échelle à zéro) ; maintient l'interface accessible. |
| `max_instance_count` | `3` | Peut être augmenté sans risque — aucun état partagé côté serveur ni prérequis de file d'attente. |
| `container_port` | `3210` | Port du serveur Next.js de LobeChat. Ne le modifiez pas sans reconstruire l'image. |
| `enable_image_mirroring` | `true` | Met en miroir `lobehub/lobe-chat` dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Surcharges facultatives — notamment `ACCESS_CODE` (protège l'interface) et les valeurs par défaut de fournisseur/thème. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. Utilisez-la pour toute clé de fournisseur côté serveur (p. ex. `OPENAI_API_KEY`). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout en un Deployment sans état — LobeChat n'a besoin d'aucun PVC par pod. |
| `session_affinity` | `None` | Aucun état de session côté serveur, donc aucun routage persistant n'est requis. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez non défini — LobeChat est sans état en mode stocké côté client ; il n'y a aucune donnée à persister par pod. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | À activer uniquement pour la limitation de débit / la détection de bots sur les déploiements publics. |
| `redis_host` | `""` | Point de terminaison Redis. Définissez-le explicitement lorsque `enable_redis = true` (une valeur vide se rabat sur `127.0.0.1`). |
| `redis_port` | `6379` | Port Redis. |

Les groupes Database Backend, Backup & Maintenance, Filesystem (NFS) et Cloud Storage
existent par souci de cohérence avec la convention mais sont **inertes** — `database_type = "NONE"` et aucun
bucket ni volume n'est déclaré, si bien que ces entrées ne créent aucune ressource. Toutes les autres entrées
suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre LobeChat. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide — LobeChat n'en a aucune). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au
> moment du plan — un `workload_type = "Deployment"` associé à `stateful_pvc_enabled = true`,
> IAP sans identités autorisées, des unités binaires de quota mémoire, un
> `redis_port` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ACCESS_CODE` | À définir sur tout déploiement exposé | Élevé | Sans lui, l'interface de chat — et toutes les clés de fournisseur que collent les utilisateurs — est ouverte à quiconque atteint l'IP du LoadBalancer. |
| Mémoire de `container_resources` | `1Gi` (minimum) | Élevé | En dessous de 1 GiB, le `next-server` de Next.js plante par manque de mémoire au démarrage (`JavaScript heap out of memory`) et le pod ne devient jamais Ready. |
| `container_port` | `3210` | Élevé | L'image épingle `PORT=3210` ; une incohérence signifie que la sonde ne se connecte jamais et que le pod ne démarre pas. |
| Clés de fournisseur côté serveur | À injecter via `secret_environment_variables` | Élevé | Placer une clé d'API dans `environment_variables` en clair l'expose dans la spécification du pod et dans les journaux. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette `0`. Conserver 1 garantit que l'interface reste accessible. |
| `stateful_pvc_enabled` | laisser non défini (`null`) | Moyen | Activer un PVC ajoute un stockage par pod inutile — LobeChat ne persiste rien côté serveur dans le mode par défaut. |
| `enable_redis` | `false` sauf déploiement public | Moyen | L'activer sans `redis_host` joignable (vide → `127.0.0.1`) laisse la limitation de débit inopérante. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `application_version` | Épingler un tag en production | Moyen | `latest` suit l'amont ; une version inattendue peut modifier le comportement lors du prochain déploiement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative
propre à LobeChat partagée avec la variante Cloud Run est décrite dans
**[LobeChat_Common](LobeChat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LobeChat sur GKE Autopilot](../labs/LobeChat_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LobeChat Common — Configuration applicative partagée](LobeChat_Common.md) — la configuration partagée par les deux cibles de déploiement.
