---
title: "Shlink sur GKE Autopilot"
description: "Référence de configuration pour déployer Shlink sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Shlink_GKE.md @ 3055034 sha256:dea400df00e6 -->

# Shlink sur GKE Autopilot {#shlink-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Shlink_GKE.png" alt="Shlink sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Shlink est un raccourcisseur d'URL open source auto-hébergé qui expose une API
REST, un client web, la génération de codes QR et des analyses détaillées du
suivi des visites. Ce module déploie Shlink sur **GKE Autopilot** au-dessus du
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide porte sur les services cloud qu'utilise Shlink et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — consultez le
[guide du socle App_GKE](App_GKE.md) plutôt que de les retrouver répétés ici.

---

## 1. Vue d'ensemble {#1-overview}

Shlink s'exécute comme une seule charge de travail PHP/Swoole sans état, dont
tout l'état réside dans PostgreSQL — il n'y a aucune persistance de système de
fichiers à gérer.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul conteneur sur le port `8080`, `1000m` de CPU / `512Mi` de mémoire par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixé à `POSTGRES_15` |
| Stockage d'objets | Cloud Storage | Aucun provisionné — Shlink stocke tout dans PostgreSQL |
| Secrets | Secret Manager | `INITIAL_API_KEY` généré automatiquement (première clé d'API REST) et mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est fixé
  par le module Common ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface de bouclage.**
  `enable_cloudsql_volume = true` injecte un sidecar cloud-sql-proxy ; App_GKE
  définit alors `DB_HOST = DB_IP = 127.0.0.1`. Shlink lit `DB_HOST`/`DB_USER`/
  `DB_NAME`/`DB_PASSWORD` directement depuis l'environnement — aucun remappage
  dans le point d'entrée n'est nécessaire.
- **`DB_NAME`/`DB_USER` sont volontairement laissés non définis par le module Common.**
  Le socle crée le rôle/la base de données Cloud SQL selon sa propre convention
  de nommage propre au tenant et injecte les valeurs réelles ; les prédéfinir
  avec les noms courts `shlink`/`shlink` ferait s'authentifier avec un rôle
  jamais créé.
- **Aucun système de fichiers persistant.** `gcs_volumes` vaut `[]` par défaut
  et NFS n'est pas relié — Shlink stocke les URL courtes, les visites et les
  clés d'API entièrement dans PostgreSQL ; il n'y a donc rien à persister en
  dehors de la base de données.
- **Les migrations de base de données s'exécutent automatiquement au démarrage du conteneur.**
  L'image officielle `shlinkio/shlink` exécute ses propres migrations de schéma
  au démarrage ; il n'existe pas de tâche de migration distincte (seulement
  `db-init`, qui crée le rôle/la base de données).
- **`INITIAL_API_KEY` est généré automatiquement** et stocké dans Secret
  Manager, puis injecté comme variable d'environnement secrète du conteneur
  afin que Shlink amorce sa première clé d'API REST au démarrage initial.
  Récupérez-le après le déploiement — Shlink n'a pas de connexion
  administrateur par nom d'utilisateur/mot de passe ; tout accès repose sur
  des clés d'API.
- **Le Dockerfile construit toujours `FROM shlinkio/shlink:stable`** —
  contrairement à la plupart des modules à build personnalisé de ce dépôt,
  `application_version` n'est **pas** relié au tag de l'image via un ARG de
  build (`container_build_config` conserve `build_args = {}`). Modifier
  `application_version` n'a aucun effet sur l'image construite. {/* TODO: verify this is intentional and not a gap */} Épinglez une version précise en modifiant directement
  la ligne `FROM` du `Dockerfile` du module Common.
- **Passe de 1 à 3 pods par défaut** (`min_instance_count = 1`,
  `max_instance_count = 3`). Shlink est sans état à chaque requête vis-à-vis de
  PostgreSQL, la mise à l'échelle horizontale est donc sûre d'emblée.
- **`DEFAULT_DOMAIN` n'est pas prédéfini.** Le nom d'hôte public utilisé pour
  générer les URL courtes n'est connu qu'après le déploiement — définissez-le
  via `environment_variables` une fois l'IP du LoadBalancer ou le domaine
  personnalisé connu.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Shlink {#a-gke-autopilot--the-shlink-workload}

Les pods Shlink sont planifiés sur Autopilot, qui facture le CPU et la mémoire
que les pods demandent réellement. La charge de travail n'a pas de stockage
persistant ; elle est donc déployée comme un `Deployment` standard avec la
stratégie `RollingUpdate` par défaut.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Shlink pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Shlink stocke toutes les données de l'application (URL courtes, enregistrements
de visites, tags et clés d'API) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods la joignent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors du premier
déploiement, la tâche `db-init` (avec `postgres:15-alpine`) crée de manière
idempotente le rôle et la base de données de l'application, accorde la
propriété et les privilèges, puis arrête son propre sidecar de proxy via le
point de terminaison `quitquitquit`.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions,
  les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets soutiennent le déploiement : `INITIAL_API_KEY` (la première clé
d'API REST de Shlink, générée automatiquement par `Shlink_Common` et injectée
comme variable d'environnement secrète afin que l'application l'amorce au
premier démarrage) et le mot de passe de la base de données (géré par le
socle). Sur GKE, les secrets sont projetés dans les pods via le pilote Secret
Store CSI / SecretSync.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~shlink"
  gcloud secrets versions access latest --secret=<initial-api-key-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration de Secret Store CSI et la
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`, `reserve_static_ip = true` afin que
l'adresse survive aux redéploiements). Un domaine personnalisé avec un
certificat géré par Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network →
  IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et
les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les
métriques de GKE et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de
disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Shlink {#3-shlink-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Elle attend que
  PostgreSQL soit joignable, puis, de manière idempotente, crée (`CREATE`) ou
  modifie (`ALTER`) le rôle et la base de données de l'application, accorde la
  propriété et `ALL PRIVILEGES`, et accorde `ALL ON SCHEMA public`. La tâche
  peut être relancée sans risque (`execute_on_apply = true`). Elle
  s'authentifie en tant que `postgres` avec le même secret que le propre
  `DB_PASSWORD` de l'application (`ROOT_PASSWORD` et `DB_PASSWORD` référencent
  tous deux `database_password_secret`). {/* TODO: verify ROOT_PASSWORD vs DB_PASSWORD sharing the same secret is intentional */}
- **Les migrations de base de données s'exécutent au démarrage, sans tâche de migration distincte.**
  L'image officielle `shlinkio/shlink` exécute ses propres migrations de schéma
  au démarrage du conteneur sur la base de données vide créée par `db-init` ;
  il n'y a aucune étape de migration `execute_on_apply` à attendre au-delà de
  `db-init` lui-même.
- **Pas de compte administrateur — accès par clé d'API.** Shlink n'a pas de
  nom d'utilisateur/mot de passe administrateur. `Shlink_Common` génère
  `INITIAL_API_KEY` et l'injecte comme variable d'environnement secrète ;
  l'image la lit au premier démarrage pour créer la première clé d'API REST
  valide. Récupérez-la dans Secret Manager (voir [2.C](#c-secret-manager)) et
  utilisez-la comme en-tête `X-Api-Key` auprès de l'API REST ou pour la
  connexion au client web.
- **La connectivité à la base de données passe par l'interface de bouclage via le sidecar Auth Proxy.**
  Avec `enable_cloudsql_volume = true` (par défaut), App_GKE injecte
  `DB_HOST = DB_IP = 127.0.0.1` ; Shlink lit directement `DB_HOST`, `DB_USER`,
  `DB_NAME` et `DB_PASSWORD` — aucune gestion de chemin de socket ni de DSN
  sous forme d'URL n'est nécessaire.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  des sondes **HTTP** `GET /rest/health` — un point de terminaison public et
  non authentifié qui renvoie HTTP 200 avec `{"status":"pass"}`
  (`application/health+json`). Il n'y a pas de page d'accueil web sur `/`
  (elle renvoie 404) ; utilisez donc aussi `/rest/health` pour les
  vérifications manuelles. `failure_threshold = 30` avec
  `period_seconds = 10` sur la sonde de démarrage couvre ~300 s pour les
  migrations du premier démarrage.
- **Sans état — mise à l'échelle horizontale sûre.** Tout l'état réside dans
  PostgreSQL ; les valeurs par défaut `min_instance_count = 1` /
  `max_instance_count = 3` et la stratégie de déploiement `RollingUpdate`
  standard sont donc sûres sans autre réglage.
- **Définissez `DEFAULT_DOMAIN` une fois l'IP/le domaine connu.** Il n'est pas
  prédéfini — ajoutez-le via `environment_variables` une fois l'IP du
  LoadBalancer ou le domaine personnalisé attribué, afin que les URL courtes
  générées utilisent le bon hôte public :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" DEFAULT_DOMAIN=shlink.example.com
  ```
- **Géolocalisation facultative des visites.** Shlink peut déterminer la
  géolocalisation des visiteurs via une base de données MaxMind GeoLite2 si un
  `GEOLITE_LICENSE_KEY` est fourni ; ce module ne le définit pas — ajoutez-le
  via `environment_variables` si vous souhaitez la géolocalisation. {/* TODO: verify exact env var name and download behaviour against the running image */}
- **Inspectez le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DB_
  curl -s http://<external-ip-or-domain>/rest/health
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Shlink ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `shlink` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Non relié au build de l'image — le Dockerfile construit toujours `FROM shlinkio/shlink:stable`. |
| `admin_username` | `shlink` | Non utilisé par Shlink (authentification par clé d'API, pas de comptes administrateur). Conservé pour la parité d'interface du wrapper. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Cloud Build construit la fine image wrapper `shlinkio/shlink:stable`. |
| `container_image` | `shlinkio/shlink:stable` | Utilisé uniquement lorsque `container_image_source = "prebuilt"`. |
| `container_port` | `8080` | Le serveur HTTP de Shlink écoute sur `8080`. |
| `container_resources.cpu_limit` | `1000m` | 1 vCPU. |
| `container_resources.memory_limit` | `512Mi` | Suffisant pour le runtime PHP basé sur Swoole. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pods (`minReplicas` du HPA). |
| `max_instance_count` | `3` | Nombre maximal de réplicas de pods — peut être augmenté sans risque, Shlink étant sans état. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (interface de bouclage) — obligatoire sur GKE. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de montage du socket Unix pour le sidecar du proxy. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'API REST et le client web de Shlink. |
| `workload_type` | `null` → `Deployment` | Deployment (sans état, stratégie `RollingUpdate`). |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Aucun bucket défini par le module Common — Shlink n'en a pas besoin. |
| `gcs_volumes` | `[]` | Vide par défaut — Shlink stocke toutes ses données dans PostgreSQL et n'a besoin d'aucun système de fichiers persistant. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — le seul moteur pris en charge. |
| `application_database_name` | `shlink` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `shlink` | Utilisateur de la base de données de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/rest/health`, `failure_threshold=30`, `period_seconds=10` | Public, non authentifié — couvre ~300 s pour les migrations du premier démarrage. |
| `health_check_config` | HTTP `/rest/health`, `failure_threshold=3`, `period_seconds=30` | Sonde de vivacité ; même point de terminaison public. |
| `uptime_check_config` | `enabled=false`, `path=/rest/health` | À activer pour un test de disponibilité externe Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL permettant de joindre Shlink. |
| `health_check_url` | URL de test de santé prête à être interrogée avec curl (`/rest/health`) — utilisez-la plutôt que `/`, qui renvoie 404. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Shlink). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`) et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre
> sans état, IAP sans identités autorisées, des `quota_memory_*` fournis sous
> forme d'entiers bruts, un `container_port`/`backup_retention_days` hors plage.
> Une configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource ; la plupart des erreurs
> ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (fixe) | Critical | Non modifiable — Shlink ne prend en charge que PostgreSQL. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et rend orphelins toutes les URL courtes et l'historique des visites. |
| `environment_variables` (`DB_NAME`/`DB_USER`) | Ne pas définir manuellement | Critical | Les remplacer par les noms courts `shlink`/`shlink` contourne le rôle propre au tenant du socle et provoque `password authentication failed`. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:5432` est indispensable à la connectivité à la base de données sur GKE. |
| `INITIAL_API_KEY` (généré automatiquement) | À récupérer après le déploiement | High | Shlink n'a pas de connexion administrateur — perdre la trace de ce secret sans en effectuer la rotation vous bloque l'accès à l'API REST et au client web. |
| Chemin de `startup_probe_config` / `health_check_config` | `/rest/health` | High | Pointer les sondes vers `/` (404) ou vers un point de terminaison authentifié empêche le pod de devenir Ready. |
| `max_instance_count` | `3` (ou plus) | Low | Shlink est sans état ; dépasser 3 est sûr si le trafic le justifie — aucun risque lié au stockage partagé ou aux verrous. |
| `DEFAULT_DOMAIN` (défini après le déploiement) | URL du LoadBalancer externe/du domaine | Medium | Un domaine erroné ou absent fait pointer les URL courtes générées vers le mauvais hôte. |
| `memory_limit` | `512Mi` | Medium | Le plancher de mémoire gen2/Autopilot et les besoins du runtime Swoole ; augmentez-le si les pods subissent des OOM sous une charge soutenue. |
| `quota_memory_requests` / `_limits` | Unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et tout `DEFAULT_DOMAIN` codé en dur. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention réglementaire des données d'URL courtes et de l'historique des visites. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et
Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Shlink
partagée avec la variante Cloud Run est décrite dans **[Shlink_Common](Shlink_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Shlink sur GKE Autopilot](../labs/Shlink_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Shlink sur Google Cloud Run](Shlink_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Shlink Common — Configuration applicative partagée](Shlink_Common.md) — la configuration partagée par les deux cibles de déploiement.
