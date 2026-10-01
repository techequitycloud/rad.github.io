---
title: "Hoppscotch sur GKE Autopilot"
description: "Référence de configuration pour déployer Hoppscotch sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Hoppscotch_GKE.md @ 3055034 sha256:778d141fa872 -->

# Hoppscotch sur GKE Autopilot {#hoppscotch-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hoppscotch_GKE.png" alt="Hoppscotch sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hoppscotch est une plateforme open source de développement d'API, dans l'esprit de
Postman, qui permet de concevoir, d'envoyer et d'inspecter des requêtes HTTP, GraphQL
et WebSocket depuis le navigateur. Ce module déploie le **frontend Hoppscotch
auto-hébergé** sous forme d'application monopage sans état sur **GKE Autopilot**, en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Hoppscotch et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Hoppscotch s'exécute sous forme d'application web monopage statique (servie par
Caddy) dans un Deployment sur GKE Autopilot. Elle est volontairement **sans état** —
aucune base de données, aucun cache, aucun stockage persistant — si bien que le
déploiement n'assemble qu'un petit ensemble de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods SPA statiques sur le port 3000 ; autoscaling horizontal ; 1 réplica minimum |
| Image de conteneur | Artifact Registry + Cloud Build | Build personnalisé minimal `FROM hoppscotch/hoppscotch-frontend`, répliqué dans Artifact Registry |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe avec une IP statique réservée par défaut |
| Secrets | Secret Manager | **Aucun secret propre à l'application** — Hoppscotch ne requiert aucun secret |
| Observabilité | Cloud Logging & Monitoring | Journaux des pods, métriques GKE, test de disponibilité et alertes en option |

Services volontairement **non** utilisés : **Cloud SQL** (`database_type = "NONE"`,
imposé par un garde-fou au moment du plan), **Cloud Storage** (aucun bucket) et
**Redis** (désactivé par défaut ; le frontend statique n'a ni limitation de débit côté
serveur ni file d'attente à alimenter).

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Jamais de base de données — et c'est imposé.** `database_type = "NONE"` et
  `enable_cloudsql_volume = false`. Une précondition au moment du plan
  (`validation.tf`) **fait échouer le plan** si `database_type` vaut autre chose que
  `NONE`, de sorte qu'un opérateur ne peut pas provisionner par erreur une instance
  Cloud SQL inutilisée. Hoppscotch conserve tout son état dans le **stockage local du
  navigateur**.
- **L'image frontend seule est utilisée à dessein.** L'image tout-en-un
  `hoppscotch/hoppscotch` embarque un backend NestJS qui effectue un `exit(1)` en
  l'absence de `DATABASE_URL`. Ce module utilise `hoppscotch/hoppscotch-frontend`,
  qui sert la SPA sur le port 3000 sans exiger de backend.
- **C'est `HOPPSCOTCH_VERSION`, et non `APP_VERSION`, qui fige l'image.** Un build
  personnalisé définit un ARG `HOPPSCOTCH_VERSION` propre à l'application afin que la
  variable `APP_VERSION` injectée par le socle n'écrase pas le tag ;
  `application_version = "latest"` se résout en un tag figé et éprouvé au moment du
  build.
- **Un LoadBalancer avec une IP statique réservée est la valeur par défaut.** `service_type =
  "LoadBalancer"` et
  `reserve_static_ip = true`, de sorte que l'adresse externe survit aux
  redéploiements.
- **Un réplica minimum est maintenu** (`min_instance_count = 1` ; GKE ne prend pas en
  charge la mise à l'échelle à zéro), ce qui garde la SPA toujours accessible.
  `max_instance_count = 3` par défaut, valeur qui peut être relevée sans risque — il
  n'y a aucun état partagé à coordonner.
- **Un Deployment sans état, et non un StatefulSet.** `workload_type` n'est pas défini
  (il se résout en `Deployment`) et `stateful_pvc_enabled` n'est pas défini ; la SPA
  n'a besoin d'aucun volume par pod.
- **`session_affinity = "None"`.** Le bundle statique est identique sur chaque pod ;
  un routage persistant est donc inutile.
- **Aucun secret ni bucket de stockage** n'est provisionné par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Hoppscotch {#a-gke-autopilot--the-hoppscotch-workload}

Les pods Hoppscotch sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods (Horizontal Pod
Autoscaling) dimensionne le Deployment entre le nombre minimal (`1`) et maximal de
réplicas. Le conteneur écoute sur le **port 3000** et répond à `GET /` avec
l'interface de l'application (HTTP 200).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Hoppscotch pour voir les pods et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Image de conteneur — Artifact Registry et Cloud Build {#b-container-image--artifact-registry--cloud-build}

Comme `container_image_source = "custom"`, l'image est construite par Cloud Build à
partir du `Dockerfile` minimal (`FROM hoppscotch/hoppscotch-frontend:${HOPPSCOTCH_VERSION}`)
puis poussée vers Artifact Registry (la réplication d'image est activée par défaut).
Les images personnalisées ou répliquées sont tirées avec `imagePullPolicy=Always` sur
GKE, afin qu'un tag reconstruit ne soit jamais servi périmé depuis le cache d'un nœud.

- **Console :** Artifact Registry → Repositories ; Cloud Build → History.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --region "$REGION" --limit 5
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --project "$PROJECT" \
    --include-tags --filter="package~hoppscotch"
  # Confirm the image the running pod actually pulled:
  kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].spec.template.spec.containers[0].image}'
  ```

### C. Secret Manager {#c-secret-manager}

Hoppscotch ne provisionne **aucun secret applicatif** — `secret_ids` est vide ; aucun
volume Secret Store CSI n'est donc monté pour ce module. Vous pouvez toujours associer
vos propres références variable d'environnement → secret via
`secret_environment_variables` si vous étendez le déploiement, mais rien n'est requis.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hoppscotch"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = "LoadBalancer"`), et une IP statique est réservée
(`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements. Un domaine
personnalisé avec un certificat géré par Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"                       # EXTERNAL-IP of the LoadBalancer
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
GKE vers Cloud Monitoring. Des tests de disponibilité (sur l'hôte du LoadBalancer) et
des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Hoppscotch {#3-hoppscotch-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Il n'y a ni
  job `db-init`, ni instance Cloud SQL, ni schéma. Les pods servent immédiatement un
  bundle statique.
- **Aucune persistance côté serveur.** Les collections, environnements, historiques
  de requêtes et paramètres résident dans le **stockage local du navigateur** sur la
  machine de chaque utilisateur. Le renouvellement des pods, la mise à l'échelle ou un
  redéploiement ne fait perdre aucune donnée utilisateur — il n'y en a aucune à perdre
  sur le serveur. Comme la SPA est sans état, la stratégie `RollingUpdate` par défaut
  est sûre (aucun verrou NFS ou de base de données partagé susceptible de provoquer un
  interblocage).
- **Aucune clé immuable.** Sans secret ni base de données, il n'existe aucun élément
  cryptographique susceptible de corrompre des données stockées s'il était modifié.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/`,
  qui renvoie l'interface de l'application (HTTP 200) dès que Caddy écoute sur le port
  3000 — généralement en quelques secondes. Une sonde en échec signifie presque
  toujours que le tag d'image est invalide, et non qu'un backend est injoignable.
- **Aucun compte administrateur au premier lancement.** Le frontend auto-hébergé ne
  dispose d'aucune connexion ni gestion des utilisateurs propre ; accédez à l'IP du
  LoadBalancer et commencez à construire vos requêtes. (Les espaces de travail
  d'équipe, qui exigent le backend et une base de données, sont volontairement hors du
  périmètre de ce module.)
- **La mise à l'échelle n'est pas contrainte.** En l'absence de file d'attente ou de
  base de données partagée, un nombre quelconque de pods s'exécute indépendamment —
  augmentez librement `max_instance_count` comme plafond de débit.
- **Vérifier la charge de travail en cours d'exécution :**
  ```bash
  kubectl get deploy,pods -n "$NAMESPACE"
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -sS -o /dev/null -w '%{http_code}\n' "http://$EXTERNAL_IP/"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Hoppscotch ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hoppscotch` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Hoppscotch ; `latest` se résout au moment du build en un tag `hoppscotch-frontend` figé et éprouvé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure de support. |
| `container_image_source` | `custom` | Build personnalisé minimal `FROM hoppscotch/hoppscotch-frontend`. Conservez `custom`. |
| `container_port` | `3000` | Port sur lequel écoute la SPA frontend. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro, conservez donc ≥ 1. |
| `max_instance_count` | `3` | Nombre maximal de réplicas ; peut être relevé sans risque (aucun état partagé). |
| `enable_cloudsql_volume` | `false` | Hoppscotch n'a pas de base de données — laissez `false`. |
| `enable_image_mirroring` | `true` | Répliquer l'image dans Artifact Registry (évite les limites de Docker Hub). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair supplémentaires facultatives. Aucune n'est requise. |
| `secret_environment_variables` | `{}` | Références facultatives variable d'environnement → Secret Manager. Aucune n'est requise. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Un LoadBalancer externe expose la SPA. |
| `workload_type` | `null` (→ `Deployment`) | Deployment sans état ; aucun StatefulSet n'est nécessaire. |
| `session_affinity` | `None` | Le bundle statique est identique sur chaque pod ; aucune persistance de session requise. |
| `reserve_static_ip` | `true` | Conserver une IP externe stable entre les redéploiements. |
| `namespace_name` | `""` | Espace de noms Kubernetes de la charge de travail. Généré automatiquement à partir de `application_name` et `tenant_id` s'il est vide. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Laissez non défini — Hoppscotch est sans état et n'a besoin d'aucun PVC par pod. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut. Le frontend statique n'a ni file d'attente ni limiteur de débit côté serveur ; laissez-le désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si vous intégrez Redis pour un usage personnalisé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Un garde-fou au moment du plan fait échouer le plan si un moteur quelconque est défini. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (une IP statique est réservée par défaut). |
| `service_url` | URL permettant d'accéder à Hoppscotch. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Hoppscotch est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs d'initialisation (vide — pas d'amorçage de base de données). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par
> le moteur du socle [App_GKE](App_GKE.md) ainsi que par un garde-fou propre à
> Hoppscotch (`validation.tf`), qui valident les valeurs *et leurs combinaisons* au
> moment du plan — `database_type` différent de `NONE`,
> `min_instance_count > max_instance_count`, IAP activé sans identifiants OAuth,
> `quota_memory_*` sans suffixe d'unité binaire. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt
> qu'à l'application ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `NONE` | Élevé | Tout autre moteur fait échouer le plan (garde-fou) ; s'il passait malgré tout, il provisionnerait une instance Cloud SQL inutilisée et facturée. |
| `container_image_source` | `custom` | Élevé | Passer à `prebuilt` déclenche le chemin de build sans image exploitable et laisse les pods tenter de tirer un tag inexistant. |
| `application_version` | `latest` ou un tag `hoppscotch-frontend` réel | Élevé | Un tag invalide fait échouer le Cloud Build ; les pods passent alors en `ImagePullBackOff` ou servent une image obsolète. |
| `container_port` | `3000` | Élevé | Le frontend ne sert que sur le port 3000 ; un port différent fait échouer la sonde de démarrage et les pods ne deviennent jamais Ready. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; le garde-fou de validation rejette `0`. Conserver 1 garde la SPA accessible. |
| `enable_cloudsql_volume` | `false` | Moyen | L'activer ajoute un sidecar Auth Proxy pour une base de données inexistante — coût inutile et dépendance superflue. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `session_affinity` | `None` | Faible | La persistance de session est inutile pour un bundle statique identique ; l'activer ne fait que limiter la répartition de charge. |
| `enable_redis` | `false` | Faible | Le frontend statique n'a pas de file d'attente côté serveur ; activer Redis ajoute un coût sans aucun bénéfice. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et réplication d'image — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Hoppscotch, partagée
avec la variante Cloud Run, est décrite dans
**[Hoppscotch_Common](Hoppscotch_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hoppscotch sur GKE Autopilot](../labs/Hoppscotch_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hoppscotch Common — Configuration applicative partagée](Hoppscotch_Common.md) — la configuration partagée par les deux cibles de déploiement.
