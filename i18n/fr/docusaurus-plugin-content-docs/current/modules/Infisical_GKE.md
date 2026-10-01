---
title: "Infisical sur GKE Autopilot"
description: "Référence de configuration pour déployer Infisical sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Infisical_GKE.md @ 3055034 sha256:8d3f14afe6f0 -->

# Infisical sur GKE Autopilot {#infisical-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Infisical_GKE.png" alt="Infisical sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Infisical est une plateforme open source de gestion des secrets chiffrée de bout en bout :
les équipes et les pipelines CI/CD stockent, injectent et renouvellent les secrets applicatifs depuis une
plateforme unique, à l'aide de SDK clients, d'une CLI ou de l'interface web. Ce module déploie
Infisical sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud qu'utilise Infisical et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée (ingress), autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Infisical s'exécute sous forme de pod Node.js (une image construite sur mesure qui encapsule l'image officielle
`infisical/infisical`) dans un `Deployment` sans état. Le déploiement associe
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js construits sur mesure, 2 vCPU / 2Gi par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Infisical ne prend pas en charge MySQL ni d'autres moteurs |
| Cache et limitation de débit | Redis (facultatif, activé par défaut) | Redis hébergé sur NFS par défaut, ou un Redis externe authentifié via `redis_auth` |
| Secrets | Secret Manager | `ENCRYPTION_KEY`, `AUTH_SECRET`, `ADMIN_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | Service `LoadBalancer` externe par défaut, avec une IP statique réservée |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` vaut par défaut `POSTGRES_15` et c'est
  la seule valeur prise en charge par Infisical.
- **L'image de conteneur est construite sur mesure, et non l'image amont.** `Infisical_Common`
  construit `FROM infisical/infisical:${INFISICAL_VERSION}` avec un `entrypoint.sh` d'encapsulation
  qui assemble la chaîne de connexion à la base de données au démarrage du conteneur.
  `application_version = "latest"` correspond à une version éprouvée épinglée
  (`v0.162.10`) comme argument de build.
- **Redis est activé par défaut, et son câblage est mutuellement exclusif par construction.** Lorsque
  `redis_auth` est vide (la valeur par défaut), l'injection en variables d'environnement en clair du Redis
  hébergé sur NFS propre au socle fournit `REDIS_HOST`/`REDIS_PORT`. Lorsque `redis_auth` est défini,
  `Infisical_Common` crée et injecte à la place son propre secret `REDIS_URL`.
- **`site_url` n'est pas calculée automatiquement sur GKE.** Contrairement à la variante Cloud Run, ce
  module transmet `site_url` telle quelle, sans calcul d'URL prévisible.
  La laisser vide signifie que le `SITE_URL` propre à l'application se rabat sur
  `http://localhost:8080` ; le job `admin-bootstrap` n'est pas concerné — son script
  résout le `GKE_SERVICE_URL` injecté par le socle lorsque `INFISICAL_API_URL` est
  vide. Voir le [§3](#3-infisical-application-behaviour).
- **Les sondes de santé ciblent HTTP `/api/status`,** contrairement à la sonde de démarrage
  uniquement TCP de la variante Cloud Run. Prévoyez des valeurs `initial_delay_seconds`/
  `failure_threshold` généreuses au premier démarrage — ce point de terminaison ne renvoie un code 2xx qu'une fois les
  connexions à la base de données (et à Redis, s'il est activé) saines.
- **Aucun stockage objet n'est monté.** Un bucket GCS générique `data` est provisionné via
  la variable `storage_buckets` du socle, mais `gcs_volumes` est vide par
  défaut — Infisical conserve tout son état persistant dans PostgreSQL.
- **`postgres_extensions` est un vestige pour cette application.** La variable vaut par défaut
  `["vector", "uuid-ossp"]` (un reliquat du modèle d'origine du module) mais n'est
  jamais transmise à `App_GKE` — `Infisical_Common` code en dur
  `enable_postgres_extensions = false`. Infisical n'utilise pas pgvector.
- **Le compte administrateur est amorcé sans interface, et non via l'interface web.** Un
  job d'initialisation `admin-bootstrap` exécute la commande `bootstrap` de la CLI `infisical` contre
  le serveur en cours d'exécution. Sur GKE, le pod du job est planifié immédiatement et réessaie
  jusqu'à ce que le serveur réponde — voir le [§3](#3-infisical-application-behaviour).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Infisical {#a-gke-autopilot--the-infisical-workload}

Les pods Infisical sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les
pods demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre les
nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Infisical pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, le scaling et le type de charge de travail sont
gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Infisical stocke toutes les données applicatives (secrets, projets, organisations, utilisateurs,
journaux d'audit) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent
de manière privée via le sidecar **Cloud SQL Auth Proxy** en loopback
(`enable_cloudsql_volume = true` par défaut). Lors du premier déploiement, le job d'initialisation
`db-init` crée la base de données et le rôle applicatifs.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe.

### C. Redis (cache et limitation de débit) {#c-redis-cache--rate-limiting}

Redis est **activé par défaut** (`enable_redis = true`). Lorsque `redis_host` est laissé
vide, l'IP de la VM du serveur NFS est utilisée comme hôte Redis par défaut. Lorsque `redis_auth`
est défini, `Infisical_Common` provisionne son propre secret Secret Manager `REDIS_URL`
au lieu de s'appuyer sur l'injection en variables d'environnement en clair du socle.

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm which Redis path is active in the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `ENCRYPTION_KEY` (chiffre chaque secret stocké par Infisical),
`AUTH_SECRET` (signe les jetons de session JWT) et `ADMIN_PASSWORD` (consommé uniquement
par le job `admin-bootstrap`, jamais injecté dans le pod en cours d'exécution). Un
secret `REDIS_URL` est créé de manière conditionnelle. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~infisical"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`, `reserve_static_ip = true`), de sorte que l'adresse
survit aux redéploiements. Un domaine personnalisé avec un certificat géré par Google peut être
activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées vers Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Infisical {#3-infisical-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job d'initialisation `db-init` exécute
  `postgres:15-alpine`, se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  le rôle et la base de données applicatifs. `execute_on_apply = true`, il
  s'exécute donc à chaque apply et peut être relancé sans risque.
- **La chaîne de connexion à la base de données est assemblée au démarrage du conteneur.** Infisical
  accepte un unique `DB_CONNECTION_URI` ; `entrypoint.sh` encode `DB_PASSWORD` en URL
  et construit l'URI à partir des valeurs distinctes `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_PASSWORD`/
  `DB_NAME` injectées par le socle, en choisissant `sslmode` selon la forme de `DB_HOST`
  (loopback `127.0.0.1` du sidecar Cloud SQL Auth Proxy de GKE → `disable`).
- **Le compte administrateur est amorcé sans interface, et le job réessaie jusqu'à ce que le serveur soit
  joignable.** Le job d'initialisation `admin-bootstrap` (image `infisical/cli:latest`,
  dépend de `db-init`) exécute `infisical bootstrap --ignore-if-bootstrapped`
  contre `INFISICAL_API_URL` (définie à partir de `site_url`). Sur GKE,
  `execute_on_apply = false` ne contrôle que l'*attente* du job par Terraform — le
  pod du job est tout de même planifié et s'exécute immédiatement, en réessayant jusqu'à 20 fois (à 15 s d'intervalle).
  **Si `site_url` est définie, elle doit pointer vers le service réellement joignable.** Lorsqu'elle
  est laissée vide, `admin-bootstrap.sh` se rabat sur le `GKE_SERVICE_URL` injecté par le socle,
  et seulement ensuite sur `http://localhost:8080` si celui-ci n'est pas défini
  non plus. Pour épingler explicitement la cible, définissez `site_url` sur l'IP du LoadBalancer externe
  ou sur le domaine personnalisé (connus une fois que le Service dispose d'une IP externe) et relancez l'apply :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  # set site_url = "https://<that-ip-or-domain>" and re-apply
  ```
- **Le mot de passe administrateur réside uniquement dans Secret Manager.** Récupérez l'identifiant
  amorcé avec :
  ```bash
  gcloud secrets versions access latest --secret=<prefix>-infisical-admin-password --project "$PROJECT"
  ```
- **Point de terminaison de santé.** `/api/status` renvoie HTTP 200 avec un corps JSON une fois
  qu'Infisical, sa connexion à la base de données et (si activé) Redis sont tous sains. Les
  sondes de démarrage et de vivacité ciblent directement ce chemin sur GKE (contrairement à la sonde
  uniquement TCP de la variante Cloud Run) — conservez le délai et le seuil généreux par défaut au
  premier démarrage pendant l'exécution des migrations.
- **Redis est facultatif mais activé par défaut.** Ne définissez `enable_redis = false` que si aucun
  backend de cache/de limitation de débit n'est souhaité.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Infisical ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `infisical` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Infisical` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image. `"latest"` correspond à un argument de build épinglé (`v0.162.10`). |
| `site_url` | `""` | URL publique pour `SITE_URL` et la cible de la CLI `admin-bootstrap`. **Transmise telle quelle — aucune prédiction automatique d'URL sur GKE.** Voir le [§3](#3-infisical-application-behaviour). |
| `admin_email` | `admin@techequity.cloud` | Adresse e-mail du premier compte super-administrateur amorcé. |
| `admin_organization` | `Default Organization` | Nom de l'organisation créée pour le compte amorcé. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | CPU par pod. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `container_port` | `8080` | Port d'écoute d'Infisical. |
| `min_instance_count` | `0` | Nombre minimal de réplicas (`minReplicas` du HPA). |
| `max_instance_count` | `3` | Nombre maximal de réplicas (`maxReplicas` du HPA). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Copie en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les variables Infisical principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | diverses | **Déclarées mais non transmises à `Infisical_Common` — inertes, sans effet sur le déploiement.** |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Laissez vide pour une génération automatique. |
| `workload_type` | `Deployment` | Imposé à `Deployment` à l'appel du socle dans `main.tf` — Infisical ne conserve aucun état qui survive à un redémarrage de pod. |
| `service_type` | `LoadBalancer` | Accès externe par défaut. |
| `session_affinity` | `ClientIP` | Valeur par défaut du socle ; l'authentification propre d'Infisical repose sur JWT, ce n'est donc pas une exigence stricte. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status` | Transmise à `Infisical_Common`. Renvoie 200 une fois les connexions à la base de données (et à Redis, s'il est activé) saines. |
| `liveness_probe` | HTTP `/api/status`, délai initial de 60 s | Transmise à `Infisical_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif — envisagez de faire pointer `path` vers `/api/status`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Pertinent ici uniquement comme source par défaut de l'IP de l'hôte Redis lorsque `redis_host` est vide. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket par défaut au niveau du socle — **provisionné mais jamais monté**. |
| `gcs_volumes` | `[]` | Vide par défaut et inutilisé par Infisical. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis pour le cache et la limitation de débit. |
| `redis_host` | `""` | Laissez vide pour utiliser par défaut l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Lorsqu'elle est définie, fait basculer Infisical sur le secret `REDIS_URL` propre à `Infisical_Common`. |
| `cubejs_api_url` / `hub_api_url` | URL localhost | **Déclarées mais non transmises à `Infisical_Common` — inertes, sans effet.** |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposée — Infisical nécessite PostgreSQL. |
| `db_name` | `infisical` | Nom de la base de données PostgreSQL. Ne le modifiez pas après le déploiement initial. |
| `db_user` | `infisical` | Utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |
| `postgres_extensions` / `enable_postgres_extensions` | `["vector","uuid-ossp"]` / `true` | **Vestiges — non transmises à `App_GKE`.** `Infisical_Common` code en dur `enable_postgres_extensions = false`. Infisical n'utilise pas pgvector. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway pour les noms d'hôte personnalisés + SSL. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre — important puisque `site_url` doit référencer une adresse durable pour `admin-bootstrap` et les liens OAuth/e-mail. |

Tous les autres groupes (Backup & Maintenance, CI/CD, Custom SQL, IAP, Cloud Armor,
StatefulSet, Reliability Policies, VPC Service Controls) se comportent exactement comme
documenté dans [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne au cluster / IP externe du LoadBalancer. |
| `service_url` | URL permettant d'accéder à Infisical. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` inutilisé). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` | Indique si le monitoring est configuré. |
| `initialization_jobs` | Noms des jobs `db-init` et `admin-bootstrap`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `artifact_registry_repository` | État de la CI/CD et registre. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `audit_logging_enabled` | Posture de sécurité. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration via le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs et leurs combinaisons au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ENCRYPTION_KEY` (générée automatiquement) | Ne jamais la renouveler après le premier démarrage | Critical | Son renouvellement rend tous les secrets précédemment stockés définitivement impossibles à déchiffrer. |
| `AUTH_SECRET` (généré automatiquement) | Ne le renouveler que pendant une fenêtre de maintenance | Critical | Son renouvellement invalide toutes les sessions utilisateur actives. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_redis` | Transmettre `var.enable_redis` inconditionnellement à `App_GKE` | Critical | Le coder en dur à `false` lors de l'appel au socle laisse `REDIS_URL` complètement non défini dans le cas courant sans authentification — Infisical plante au démarrage. |
| `database_type` | `POSTGRES_15` | Critical | MySQL n'est pas pris en charge ; toute valeur autre que Postgres rompt entièrement la connexion. |
| `site_url` | À définir après le premier déploiement, une fois l'IP du LoadBalancer/le domaine connus | High | Laissée vide, le `SITE_URL` propre à l'application reste `http://localhost:8080`, ce qui casse les liens d'invitation/d'e-mail et CORS (`admin-bootstrap` résout tout de même `GKE_SERVICE_URL`). Définie sur un hôte qui n'est pas réellement joignable, le job d'amorçage échoue aussi à chaque tentative — aucun compte administrateur n'est jamais créé. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `postgres_extensions` / `enable_postgres_extensions` | N/A | Low | Déclarées mais non transmises à `App_GKE` — les définir n'a aucun effet ; Infisical n'a pas besoin de pgvector. |
| `smtp_host` / `smtp_user` / `smtp_password` / `mail_from` / `cubejs_api_url` / `hub_api_url` | N/A | Low | Déclarées par souci de parité avec la convention mais jamais transmises à `Infisical_Common` — les définir n'a aucun effet. |
| `reserve_static_ip` | `true` (par défaut) | Medium | Sans IP stable, `service_url`/`site_url` peuvent référencer une adresse obsolète d'un redéploiement à l'autre. |
| `memory_limit` | `2Gi` (par défaut) ou plus | Medium | Des valeurs inférieures risquent un OOM sous une charge de récupération de secrets concurrente. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Infisical partagée
avec la variante Cloud Run est décrite dans
**[Infisical_Common](Infisical_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Infisical sur GKE Autopilot](../labs/Infisical_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Infisical sur Google Cloud Run](Infisical_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Infisical Common — Configuration applicative partagée](Infisical_Common.md) — la configuration partagée par les deux cibles de déploiement.
