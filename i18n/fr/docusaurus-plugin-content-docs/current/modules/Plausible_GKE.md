---
title: "Plausible Analytics sur GKE Autopilot"
description: "Référence de configuration pour déployer Plausible Analytics sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Plausible_GKE.md @ 3055034 sha256:77176de98f3d -->

# Plausible Analytics sur GKE Autopilot {#plausible-analytics-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Plausible_GKE.png" alt="Plausible Analytics sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Plausible Analytics Community Edition est la principale plateforme d'analyse web
open source, sous licence AGPL-3.0 et respectueuse de la vie privée — une
alternative légère à Google Analytics, sans cookies, conforme au RGPD, au CCPA et
à la PECR, que vous possédez entièrement et auto-hébergez. Ce module déploie
Plausible CE sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Plausible est une application Elixir/Phoenix dotée de **deux magasins de
données** : Cloud SQL PostgreSQL 15 contient uniquement les comptes et la
configuration des sites, et **ClickHouse contient tous les événements
d'analyse**. ClickHouse est fourni par le module distinct
[ClickHouse_GKE](ClickHouse_GKE.md) et est **obligatoire** — déployez-le en
premier. Il n'existe délibérément **aucune variante Plausible_CloudRun** :
ClickHouse ne peut pas s'exécuter sur Cloud Run, ce couple suit donc le modèle
GKE uniquement (comme Supabase et Temporal).

Ce guide se concentre sur les services cloud utilisés par Plausible et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Plausible s'exécute sous forme d'une charge de travail web Elixir/Phoenix (BEAM)
sur le port 8000. Le déploiement assemble un ensemble ciblé de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Plausible, 1 vCPU par défaut, autoscaling horizontal de 1 à 10 réplicas |
| Base de données de configuration | Cloud SQL for PostgreSQL 15 | Comptes, sites et paramètres UNIQUEMENT — aucun événement d'analyse |
| Magasin d'événements | ClickHouse ([ClickHouse_GKE](ClickHouse_GKE.md)) | **Obligatoire** — chaque page vue/événement est écrit ici ; déployez-le en premier |
| Secrets | Secret Manager | `SECRET_KEY_BASE` et `TOTP_VAULT_KEY` générés automatiquement ; mot de passe de la base de données ; mot de passe ClickHouse (appartenant à ClickHouse_GKE) |
| Build de l'image | Cloud Build + Artifact Registry | Build personnalisé léger FROM `ghcr.io/plausible/community-edition` |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **ClickHouse n'est pas facultatif.** Une garde de validation au moment du plan
  **bloque l'apply lorsque `clickhouse_url` est vide**, et `module_dependency`
  vaut par défaut `["Services_GCP", "ClickHouse_GKE"]`. Raccordez les outputs de
  ClickHouse_GKE : `clickhouse_url` = `clickhouse_internal_endpoint` (même
  cluster, à privilégier) ou `clickhouse_endpoint` ; `clickhouse_db` =
  `clickhouse_database` ; `clickhouse_user` = `clickhouse_username` ;
  `clickhouse_password_secret` = `clickhouse_password_secret_id`.
- **Le mot de passe ClickHouse franchit les frontières entre modules en toute
  sécurité.** Plausible référence le secret Secret Manager *créé par
  ClickHouse_GKE* ; le socle accorde au compte de service de la charge de travail
  de Plausible le rôle `secretAccessor` sur celui-ci et l'injecte en tant que
  `CLICKHOUSE_PASSWORD`. Aucun mot de passe n'apparaît jamais dans les variables
  Terraform.
- **`application_version = "latest"` est un épinglage, pas un tag.** CE ne
  publie **aucun tag `latest`** sur `ghcr.io/plausible/community-edition` ; le
  build épingle la version éprouvée `v3.2.1` via l'ARG de build propre à
  l'application `PLAUSIBLE_VERSION` (le socle injecte `APP_VERSION` et l'emporte
  lors de cette fusion, d'où le nom d'ARG propre à l'application).
- **`SECRET_KEY_BASE` et `TOTP_VAULT_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Tous deux doivent rester stables : la rotation de
  `SECRET_KEY_BASE` invalide toutes les sessions et déconnecte tous les
  utilisateurs ; la rotation de `TOTP_VAULT_KEY` casse tous les appareils 2FA
  enregistrés.
- **L'inscription est ouverte par défaut.** Créez le premier compte sur
  `<service URL>/register`, puis définissez `DISABLE_REGISTRATION = "true"` (ou
  `"invite_only"`) via `environment_variables`.
- **Port 8000 ; sondes sur `/api/health`.** Le point de terminaison de santé
  répond sans authentification ; les sondes de démarrage/vivacité ne reçoivent
  donc jamais de 401/403.
- **La valeur par défaut livrée est de 512Mi de mémoire**, et non 1Gi —
  `container_resources` vaut par défaut `1000m` / `512Mi` dans ce module (voir le
  § 4 ci-dessous), ce qui remplace la valeur par défaut de 1Gi de la couche
  partagée. 1Gi est un plancher recommandé pour l'environnement d'exécution BEAM
  et la file de jobs Oban intégrée au processus, vers lequel les opérateurs
  devraient monter en production — et non ce qui est déployé d'emblée.
- **Pas de NFS, pas de buckets GCS.** Tout l'état réside dans PostgreSQL et
  ClickHouse.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Plausible {#a-gke-autopilot--the-plausible-workload}

Les pods Plausible sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods
dimensionne le Deployment entre le nombre minimal et le nombre maximal de
réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Plausible pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods -A | grep plausible          # find the namespace and pods
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/"$(kubectl get deploy -n "$NAMESPACE" -o jsonpath='{.items[0].metadata.name}')" --tail=100
  ```

Le point d'entrée journalise sa configuration composée au démarrage — repérez
les lignes `[plausible-entrypoint]` qui indiquent l'hôte de `DATABASE_URL`,
l'hôte ClickHouse et `BASE_URL`.

### B. Cloud SQL for PostgreSQL 15 — comptes et configuration {#b-cloud-sql-for-postgresql-15--accounts-and-configuration}

Plausible stocke les comptes, sites, objectifs et paramètres dans une instance
gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de manière privée via le
sidecar **Cloud SQL Auth Proxy** — le point d'entrée se connecte toujours en TCP
sur `127.0.0.1:5432` (les hôtes de type chemin de socket sont ramenés à
`127.0.0.1`, car les URL `postgresql://` ne peuvent pas contenir de chemin de
socket). Au premier déploiement, un Job `db-init` (`postgres:15-alpine`) crée le
rôle et la base de données de l'application ; les propres migrations de
Plausible s'exécutent au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

**Les événements d'analyse ne sont PAS ici.** Si vous interrogez PostgreSQL à la
recherche de pages vues, vous ne trouverez rien — les événements résident dans
ClickHouse.

### C. ClickHouse — le magasin d'événements (via ClickHouse_GKE) {#c-clickhouse--the-event-store-via-clickhouse_gke}

Chaque page vue et chaque événement personnalisé est écrit dans ClickHouse,
déployé et détenu par le module distinct [ClickHouse_GKE](ClickHouse_GKE.md) (un
StatefulSet doté d'un volume persistant). Plausible se connecte à l'aide de la
`CLICKHOUSE_DATABASE_URL` composée ; au premier démarrage, `db createdb` de CE
crée la base d'événements si elle est absente et `db migrate` applique le schéma
ClickHouse.

- **CLI :**
  ```bash
  kubectl get pods -A | grep clickhouse                 # the ClickHouse workload
  # Ping ClickHouse from inside the cluster (endpoint = the clickhouse_url you wired in):
  kubectl run ch-ping --rm -it --restart=Never --image=curlimages/curl -- \
    curl -s "<clickhouse_url>/ping"                     # expect: Ok.
  # Confirm the composed wiring inside the Plausible pod:
  kubectl exec -n "$NAMESPACE" deploy/<deploy-name> -- env | grep PLATFORM_CLICKHOUSE
  ```

### D. Secret Manager {#d-secret-manager}

Quatre secrets comptent pour une instance Plausible en cours d'exécution :

| Secret | Propriétaire | Rôle |
|---|---|---|
| `secret-<prefix>-plausible-secret-key-base` | Plausible_Common | Signature des sessions Phoenix — **ne jamais effectuer de rotation** (déconnecte tout le monde) |
| `secret-<prefix>-plausible-totp-vault-key` | Plausible_Common | Chiffre au repos les secrets TOTP de 2FA — **ne jamais effectuer de rotation** (casse toute la 2FA) |
| Secret du mot de passe de la base de données | Socle App_GKE | Mot de passe de l'utilisateur applicatif Cloud SQL |
| Secret du mot de passe ClickHouse | ClickHouse_GKE | Injecté en tant que `CLICKHOUSE_PASSWORD` ; le compte de service de Plausible reçoit `secretAccessor` |

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~plausible"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Cloud Build et Artifact Registry — l'image personnalisée {#e-cloud-build--artifact-registry--the-custom-image}

L'image est une enveloppe légère : `FROM ghcr.io/plausible/community-edition:<tag>`
plus le point d'entrée cloud (`plausible-entrypoint.sh`, en pur POSIX `sh` —
l'image ne contient ni bash, ni node, ni python). Le point d'entrée encode les
identifiants en URL à l'aide d'un encodeur par pourcentage en pur shell, compose
`DATABASE_URL` et `CLICKHOUSE_DATABASE_URL`, attribue par défaut à `BASE_URL`
l'URL de service prévue par la plateforme, puis exécute `db createdb` +
`db migrate` de CE (protégé par un verrou consultatif) avant de lancer le serveur
par `exec`.

- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/$PROJECT/<repo> --include-tags | grep plausible
  ```

Les modifications du point d'entrée sont intégrées à l'image — elles nécessitent
un nouveau build + un redéploiement. Les scripts des jobs
(`create-db-and-user.sh`) sont montés au moment de l'apply — aucun nouveau build
n'est nécessaire.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe avec une adresse statique réservée. Un domaine personnalisé avec un
certificat géré par Google peut être activé.

Sur les projets limités par le **quota d'IP statiques externes globales**,
définissez `reserve_static_ip = false` et `enable_custom_domain = false`. La
valeur par défaut `enable_custom_domain = true` active la Gateway HTTPS propre à
l'application (HTTPS nip.io sans configuration) même sans domaine personnalisé,
et la Gateway réserve une IP statique **globale** ; lorsque les deux sont
désactivés, le Service se rabat sur une IP LoadBalancer éphémère et ne consomme
aucune adresse statique. Le module associé [ClickHouse_GKE](ClickHouse_GKE.md) —
dont le seul consommateur est Plausible au sein du cluster — peut en outre
définir `service_type = "ClusterIP"` pour ne nécessiter aucune IP externe.

- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT" --filter="name~plausible"
  ```

Définissez `base_url` (ou laissez-la vide pour utiliser l'URL prévue par la
plateforme) — elle pilote l'extrait du script de suivi que Plausible affiche pour
chaque site et les liens de ses e-mails.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques GKE et Cloud SQL vers Cloud Monitoring. Un test de disponibilité
facultatif cible `/api/health`.

- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Plausible {#3-plausible-application-behaviour}

- **Amorçage de la base de données en deux phases.** Le Job `db-init` crée le
  rôle et la base de données PostgreSQL (de manière idempotente, réexécutable
  sans risque). Ensuite, à chaque démarrage du conteneur, le point d'entrée
  exécute `db createdb` de CE (crée la base d'événements ClickHouse si elle est
  absente) et `db migrate` (migrations PostgreSQL + ClickHouse, protégées par un
  verrou consultatif pour que des réplicas concurrents n'entrent pas en conflit),
  avant `exec /entrypoint.sh run`.
- **Échec franc si ClickHouse est absent.** Si `PLATFORM_CLICKHOUSE_URL` est
  vide à l'exécution, le point d'entrée se termine avec le code 1 et une erreur
  explicite indiquant le correctif (déployer ClickHouse_GKE et définir
  `clickhouse_url`). En pratique, vous ne le voyez jamais, car la validation au
  moment du plan le détecte en amont.
- **Premier compte via `/register`.** Aucun identifiant n'est créé d'avance.
  Ouvrez `<service URL>/register`, créez le premier compte, ajoutez votre site,
  et Plausible affiche l'extrait de suivi
  (`<script defer data-domain="yourdomain.com" src=".../js/script.js"></script>`).
  Fermez ensuite l'inscription avec `DISABLE_REGISTRATION = "true"` (ou
  `"invite_only"`) dans `environment_variables` et appliquez via **Update**
  (mettre à jour).
- **`BASE_URL` est essentielle au bon fonctionnement.** Elle pilote l'URL de
  l'extrait et les liens des e-mails. Le point d'entrée lui attribue par défaut
  l'URL de service prévue par la plateforme (`GKE_SERVICE_URL`) ; définissez
  `base_url` explicitement lorsque le service est exposé derrière un domaine
  personnalisé.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /api/health`, non authentifié par conception, qui renvoie un corps JSON
  d'état tel que
  `{"sessions":"ok","postgres":"ok","clickhouse":"ok",...}` — une vérification
  rapide de bout en bout que les deux magasins de données sont joignables. Ne
  redirigez pas les sondes vers des pages authentifiées (elles renverraient
  401/403 et le pod ne deviendrait jamais Ready).
- **Mises à niveau de version.** Définissez `application_version` sur un tag CE
  explicite (par ex. `v3.2.1`) et appliquez ; une nouvelle image est construite
  et les migrations s'exécutent au démarrage suivant.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Plausible ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet, identité et ClickHouse {#group-1--project-identity--clickhouse}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `clickhouse_url` | `""` | **Obligatoire en pratique** — le plan est bloqué si elle est vide. Point de terminaison de base `http(s)://host[:port]` nu, sans identifiants ni chemin : `clickhouse_internal_endpoint` de ClickHouse_GKE (à privilégier) ou `clickhouse_endpoint`. |
| `clickhouse_password_secret` | `""` | Sortie `clickhouse_password_secret_id` de ClickHouse_GKE. Le socle accorde l'accès au compte de service de la charge de travail et injecte `CLICKHOUSE_PASSWORD`. |
| `clickhouse_db` | `plausible_events_db` | Sortie `clickhouse_database` de ClickHouse_GKE. |
| `clickhouse_user` | `plausible` | Sortie `clickhouse_username` de ClickHouse_GKE. |
| `base_url` | `""` | `BASE_URL` publique — pilote l'extrait de suivi et les liens des e-mails. Vide, elle utilise l'URL de service prévue par la plateforme. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `plausible` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image CE. `latest` est épinglé sur `v3.2.1` au moment du build (CE n'a pas de tag `latest`) ; définissez un tag explicite pour mettre à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Conservez `custom` — le point d'entrée de l'image enveloppe compose les deux URL de base de données. |
| `container_port` | `8000` | `HTTP_PORT` de Plausible CE. |
| `container_resources` | `1000m` / `512Mi` | CPU/mémoire par pod. Augmentez la mémoire vers le plancher de 1Gi requis par BEAM + Oban en production. |
| `min_instance_count` / `max_instance_count` | `1` / `10` | Bornes du HPA. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy ; le point d'entrée utilise son écouteur TCP sur `127.0.0.1:5432`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base dans Artifact Registry avant le build. |
| `workload_type` | `Deployment` | Plausible est sans état (l'état réside dans Cloud SQL + ClickHouse). |

### Groupe 6 — Cluster GKE, variables d'environnement et secrets {#group-6--gke-cluster-environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires — par ex. `{ DISABLE_REGISTRATION = "true" }` après le premier compte. Ne définissez pas `DATABASE_URL`, `CLICKHOUSE_DATABASE_URL`, `SECRET_KEY_BASE` ni `TOTP_VAULT_KEY` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `gke_cluster_name` / `namespace_name` | `""` | Vide, découvre automatiquement le cluster Services_GCP / génère automatiquement l'espace de noms. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `None` | Sans état — n'importe quel pod peut servir n'importe quelle requête. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health`, délai de 30s, seuil de 30 | Fenêtre généreuse pour les migrations du premier démarrage. |
| `health_check_config` | HTTP `/api/health`, période de 30s, seuil de 3 | Sonde de vivacité. |
| `uptime_check_config` | désactivé, `/api/health` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`postgres:15-alpine` + `create-db-and-user.sh`). |
| `cron_jobs` / `additional_services` | `[]` | CronJobs planifiés / services auxiliaires. |

### Groupe 15 — Redis {#group-15--redis}

`enable_redis`, `redis_host`, `redis_port` et `redis_auth` sont des **miroirs
inertes, par convention,** des variables du socle — Plausible n'utilise pas
Redis.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `plausible` | Nom de la base de données PostgreSQL (préfixé par le tenant par le socle). Immuable après le premier déploiement. |
| `application_database_user` | `plausible` | Rôle de base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Les groupes 5 (IAP), 7 (sauvegarde/StatefulSet), 8 (ResourceQuota), 9 (SQL
personnalisé/PDB), 12 (CI/CD), 13 (NFS — désactivé), 14 (stockage/registre), 17
(import de sauvegarde), 19 (domaine personnalisé/IP statique), 21 (Cloud
Armor/CDN) et 22 (VPC-SC/journalisation d'audit) sont des entrées standard
d'App_GKE — consultez [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `stage_service_cluster_ips` | ClusterIP(s) internes au cluster. |
| `service_external_ip` | IP LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Plausible (ouvrez d'abord `/register` ici). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (magasin de configuration uniquement). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Plausible). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt (réexécutez l'apply si `false` sur un nouveau cluster intégré (inline)). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan. En outre, la garde de validation propre à
> `Plausible_GKE` rejette une `clickhouse_url` vide, des nombres d'instances avec
> `min > max`, IAP sans identifiants OAuth et un sidecar Cloud SQL avec
> `database_type = "NONE"` — le tout avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_version` de ClickHouse_GKE | Conservez l'épinglage `24.12-alpine` | Critique | Remplacer l'épinglage de ClickHouse par une version non testée a déjà cassé Plausible en amont (plausible/analytics#3855) — les migrations ou les requêtes échouent contre un ClickHouse incompatible. Plausible épingle la version de ClickHouse pour une bonne raison. |
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais effectuer de rotation | Critique | La rotation invalide toutes les sessions Phoenix — tous les utilisateurs sont déconnectés d'un coup. |
| `TOTP_VAULT_KEY` (généré automatiquement) | Ne jamais effectuer de rotation | Critique | La rotation rend inutilisables tous les appareils 2FA enregistrés ; les utilisateurs concernés ne peuvent plus se connecter avec la 2FA. |
| `clickhouse_url` | `clickhouse_internal_endpoint` de ClickHouse_GKE | Élevé (bloqué) | Laissée vide, le déploiement est **bloqué au moment du plan** par la garde de validation — déployez d'abord ClickHouse_GKE et collez son output. Une URL erronée mais non vide échoue à l'exécution (le point d'entrée/les migrations ne peuvent pas joindre le magasin d'événements). |
| `clickhouse_password_secret` | `clickhouse_password_secret_id` de ClickHouse_GKE | Élevé | Secret absent ou erroné → `CLICKHOUSE_PASSWORD` est absent et l'authentification ClickHouse échoue ; les pods redémarrent en boucle lors de la migration. |
| `DISABLE_REGISTRATION` | `"true"` (ou `"invite_only"`) après le premier compte | Moyen | L'inscription reste **ouverte par défaut** — quiconque trouve l'URL peut créer un compte sur votre instance d'analyse. |
| `application_version` | `latest` (épingle `v3.2.1`) ou un tag CE explicite | Élevé | CE ne publie aucun tag `latest` ; sans l'épinglage, le build échouerait avec `MANIFEST_UNKNOWN`. Épinglez des versions explicites en production. |
| `application_database_name` / `application_database_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et rend orpheline la configuration des comptes/sites. |
| `container_resources.memory_limit` | `1Gi` | Élevé | En dessous du plancher BEAM + Oban intégré au processus, les pods subissent un OOM sous charge ou pendant les migrations. |
| `base_url` | URL du domaine personnalisé le cas échéant | Élevé | Une `BASE_URL` erronée place un mauvais `src` de script dans chaque extrait de suivi et casse les liens des e-mails. |
| `path` des sondes | `/api/health` | Élevé | Rediriger les sondes vers une page authentifiée renvoie 401/403 — le pod ne devient jamais Ready alors que l'application a bien démarré. |
| `enable_cloudsql_volume` | `true` | Élevé | Le point d'entrée se connecte à `127.0.0.1:5432` via le sidecar Auth Proxy ; le désactiver casse le chemin PostgreSQL (et c'est bloqué lorsque `database_type = "NONE"`). |
| `enable_iap` | `false` pour une analyse publique | Élevé | IAP devant Plausible bloque le script de suivi sur vos sites web — les navigateurs des visiteurs ne peuvent pas envoyer d'événements en POST à travers un écran de connexion Google. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| Ordre de suppression | Plausible d'abord, puis ClickHouse | Moyen | Détruire ClickHouse alors que Plausible tourne encore laisse les pods redémarrer en boucle contre un magasin d'événements disparu (et l'autorisation sur le secret en suspens). |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |

---

Pour le comportement du socle mentionné tout au long de ce guide — IAM et
Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Plausible (secrets, point d'entrée, amorçage de la base de données) est décrite
dans **[Plausible_Common](Plausible_Common.md)**, et le magasin d'événements dans
**[ClickHouse_GKE](ClickHouse_GKE.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Plausible Analytics sur GKE Autopilot](../labs/Plausible_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Plausible Common — Configuration applicative partagée](Plausible_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [PostHog sur GKE Autopilot](PostHog_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Product Analytics**.
