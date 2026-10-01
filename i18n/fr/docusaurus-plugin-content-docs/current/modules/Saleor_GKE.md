---
title: "Saleor sur GKE Autopilot"
description: "Référence de configuration pour déployer Saleor sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Saleor_GKE.md @ 3055034 sha256:5f93126117ae -->

# Saleor sur GKE Autopilot {#saleor-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Saleor_GKE.png" alt="Saleor sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Saleor est une plateforme d'e-commerce headless open source, pensée d'abord pour GraphQL
et construite sur Python/Django (catalogue de produits, paiement de commande, commandes
et plugins de paiement, le tout exposé via une API GraphQL plutôt qu'une vitrine
intégrée). Ce module déploie Saleor sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Saleor et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, entrée,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Saleor s'exécute dans un conteneur construit sur mesure (`ghcr.io/saleor/saleor:3.23`
encapsulé avec un point d'entrée cloud) sur GKE Autopilot. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Deux charges de travail Kubernetes : l'API Saleor principale (uvicorn, 2 workers + worker/beat Celery colocalisé) et un Dashboard précompilé distinct ; 2 vCPU / 3 GiB par défaut pour le pod principal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — fixé par `Saleor_Common` quelle que soit la valeur de `database_type` |
| Stockage d'objets | Cloud Storage | Un bucket `media` dédié provisionné automatiquement |
| Cache et broker | Redis (facultatif) | Supporte `CACHE_URL`/`CELERY_BROKER_URL` pour le worker Celery colocalisé |
| Secrets | Secret Manager | `SECRET_KEY`, `RSA_PRIVATE_KEY`, `DJANGO_SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | Valeur par défaut du module : `LoadBalancer` ; **le déploiement réel de ce projet s'exécute actuellement en `ClusterIP`** en raison d'un quota d'IP épuisé — voir les remarques ci-dessous |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `Saleor_Common` fixe le moteur de base de données ;
  choisir une autre valeur dans `database_type` n'a aucun effet.
- **Le worker Celery (traitement des commandes, webhooks, e-mails, tâches planifiées)
  s'exécute en colocalisation dans le conteneur du pod principal**, lancé comme processus
  d'arrière-plan par le point d'entrée cloud — et non comme Deployment
  `additional_services` distinct. GKE n'offre pas plus que Cloud Run de moyen de partager
  le build entre l'application principale et un Deployment sidecar.
- **Le dimensionnement des ressources est préréglé : `2000m` de CPU / `3Gi` de mémoire.**
  Il a été confirmé en conditions réelles sur GKE Autopilot que des tailles inférieures
  (même `1Gi`/`2` vCPU, arrondies par Autopilot à `2176Mi`) provoquent des OOMKill sous
  la charge combinée de 2 workers uvicorn + Django + worker/beat Celery.
- **Trois secrets sont générés automatiquement** : `SECRET_KEY`, `RSA_PRIVATE_KEY` (la
  paire de clés de signature JWT de Saleor — ne jamais en effectuer la rotation à la
  légère) et `DJANGO_SUPERUSER_PASSWORD`.
- **Une charge de travail Dashboard distincte et réellement précompilée**
  (`ghcr.io/saleor/saleor-dashboard:3.23`) est déployée aux côtés de l'API en tant
  qu'entrée `additional_services`. Son `API_URL` est intégrée à l'interface servie au
  démarrage du conteneur, résolue à partir de la sentinelle de plan
  `$(GKE_SERVICE_URL)` du socle + `/graphql/`.
- **La valeur par défaut du module pour `service_type` est `LoadBalancer` ; ce
  déploiement s'exécute actuellement en `ClusterIP`** — un choix opérationnel fait dans
  `config/deploy.tfvars` parce que le quota d'IP externes de ce projet
  (`IN_USE_ADDRESSES`) était épuisé au moment du déploiement, et non une décision de
  conception du module. Revenez à la valeur d'origine dès que du quota d'IP est
  disponible.
- **Redis est facultatif et désactivé par défaut** (`enable_redis = false`). Lorsqu'il
  est activé avec `redis_host` laissé vide, il se rabat sur l'IP de la VM du serveur NFS.
- **Les sondes de santé ciblent `/health/`**, sans authentification, avec un 200
  confirmé en local comme en conditions réelles.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — les charges de travail API et Dashboard de Saleor {#a-gke-autopilot--the-saleor-api-and-dashboard-workloads}

Les pods de l'API Saleor sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. Le Dashboard s'exécute comme une seconde charge de travail
indépendante (une entrée `additional_services`) qui sert le bundle statique de
l'interface d'administration.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail pour
  voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe (lorsque `service_type = LoadBalancer`).
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name>-dashboard --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Saleor stocke toutes les données applicatives (produits, commandes, paniers,
utilisateurs, enregistrements de paiement) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur
l'interface de bouclage ; aucune IP publique n'est exposée. Au premier déploiement,
`db-init` crée la base de données et le rôle de l'application, puis `db-migrate` (qui
dépend de `db-init`) applique les migrations de schéma de Django.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** `media` dédié est provisionné automatiquement pour les
ressources produits/médias téléversées dans Saleor. Le compte de service de la charge de
travail y reçoit l'accès. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache et broker Celery) {#d-redis-cache--celery-broker}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true` est défini et que
`redis_host` est laissé vide, l'IP de la VM du serveur NFS est utilisée comme point de
terminaison Redis (nécessite `enable_nfs = true`). Le point d'entrée cloud compose
`CACHE_URL` (base Redis `/0`) et `CELERY_BROKER_URL` (base Redis `/1`) à partir de
`REDIS_HOST`/`REDIS_PORT`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the composed URLs from the running pod's env:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'CACHE_URL|CELERY_BROKER_URL'
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont générés automatiquement et stockés dans Secret Manager : `SECRET_KEY`
(la clé de signature cryptographique de Django), `RSA_PRIVATE_KEY` (la paire de clés de
signature JWT pour tous les jetons d'accès/d'actualisation émis) et
`DJANGO_SUPERUSER_PASSWORD` (mot de passe du compte administrateur d'amorçage). Le mot
de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail serait exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). **Le déploiement réel de ce projet s'exécute
actuellement avec `service_type = ClusterIP`**, car le quota d'IP externes du projet
(`IN_USE_ADDRESSES`) était épuisé au moment du déploiement — vérifiez avec `kubectl
port-forward` plutôt que de vous attendre à une IP publique. Dès que du quota est
disponible, revenez à `service_type = "LoadBalancer"` avec `reserve_static_ip = true`.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:8000
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles (les tests de disponibilité nécessitent un point de
terminaison accessible publiquement).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Saleor {#3-saleor-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init`
  (`postgres:15-alpine`) crée de manière idempotente la base de données et le rôle de
  l'application. `db-migrate` (l'image de l'application,
  `depends_on_jobs = ["db-init"]`) exécute ensuite
  `python3 manage.py migrate --noinput`. Les deux tâches peuvent être relancées sans
  risque.
- **Extensions toujours installées.** `pg_trgm`, `unaccent`, `hstore` et `citext` sont
  installées sans condition par la configuration assemblée de `Saleor_Common` — les
  variables `enable_postgres_extensions`/`postgres_extensions` du module appelant n'ont
  aucun effet supplémentaire sur cet ensemble de base.
- **Le worker + beat Celery s'exécute en colocalisation, pas comme charge de travail
  distincte.** Le traitement des commandes, les webhooks, les e-mails et les tâches
  planifiées s'exécutent tous dans le processus worker d'arrière-plan du pod principal.
- **`SECRET_KEY`, `RSA_PRIVATE_KEY` et `DJANGO_SUPERUSER_PASSWORD` sont immuables après
  le premier démarrage.** `RSA_PRIVATE_KEY` en particulier signe chaque JWT émis par
  Saleor — sa rotation invalide toutes les sessions actives. N'effectuez de rotation que
  pendant une fenêtre de maintenance planifiée.
- **Amorçage du superutilisateur.** Le point d'entrée cloud exécute
  `manage.py createsuperuser --email $SALEOR_SUPERUSER_EMAIL --noinput` à chaque
  démarrage lorsque `DJANGO_SUPERUSER_PASSWORD` est défini (de manière idempotente — sans
  effet une fois l'utilisateur créé). `SALEOR_SUPERUSER_EMAIL` vaut par défaut
  `admin@example.com` et n'est pas exposée comme variable de ce module — c'est la valeur
  par défaut fixe propre à `Saleor_Common`.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/health/` — le
  point de terminaison de santé non authentifié de Saleor, dont il a été confirmé qu'il
  renvoie `200` dès que le serveur ASGI accepte les connexions.
- **L'`API_URL` du Dashboard est intégrée au démarrage du conteneur**, et non lue
  dynamiquement — ce qui a été confirmé via le script
  `/docker-entrypoint.d/50-replace-env-vars.sh` de l'image Dashboard officielle, qui
  remplace `API_URL` par sed dans le fichier `index.html` compilé. Sur GKE, cela utilise
  `$(GKE_SERVICE_URL)` — la sentinelle de plan du socle, résolue en l'URL réelle du
  Service de l'application principale, puisque Kubernetes n'interpole pas `$(VAR)` d'un
  conteneur à l'autre.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Saleor ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par
défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `saleor` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Correspond à l'ARG de build `SALEOR_VERSION` (`3.23` lorsque `latest`) et au tag propre à l'image Dashboard. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "3Gi" }` | Dimensionné pour la charge de travail combinée uvicorn + Celery — voir la Vue d'ensemble. |
| `min_instance_count` | `0` | Nombre minimal de réplicas (minReplicas du HPA). |
| `max_instance_count` | `1` | Nombre maximal de réplicas (maxReplicas du HPA). |
| `container_port` | `8000` | Port d'écoute d'uvicorn — doit correspondre au `CMD` de l'image de base. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par bouclage. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés par-dessus les valeurs par défaut propres à `Saleor_Common` (`ALLOWED_HOSTS`, `SALEOR_SUPERUSER_EMAIL`). Ne définissez pas `SECRET_KEY`, `RSA_PRIVATE_KEY` ni `DJANGO_SUPERUSER_PASSWORD` ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | **Ce déploiement remplace actuellement cette valeur par `ClusterIP` dans `deploy.tfvars`** en raison d'un quota d'IP épuisé — voir la Vue d'ensemble. |
| `workload_type` | `Deployment` (implicite avec `null`) | Saleor se déploie en `Deployment` ; `StatefulSet` n'est pas utilisé. |
| `session_affinity` | `ClientIP` | Routage persistant. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods ; `nfsserver` est requis lorsque `enable_nfs = true`. |
| `termination_grace_period_seconds` | `30` | Secondes d'attente après SIGTERM avant SIGKILL — laisse au worker Celery le temps de terminer les tâches en cours. |

### Groupe 8 — Scripts SQL personnalisés {#group-8--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 11/12 — Jobs et tâches planifiées {#group-1112--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire intégrée `db-init` → `db-migrate`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés (par exemple, commandes de gestion Saleor). |

### Groupe 13/15 — Système de fichiers (NFS) et Redis {#group-1315--filesystem-nfs--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Déclaré mais non utilisé par le chemin de stockage propre à Saleor — les médias sont servis depuis le bucket GCS `media`. C'est aussi la source du repli Redis sur l'IP NFS lorsque `enable_redis = true` et `redis_host = ""`. |
| `enable_redis` | `false` | Active le cache/broker de Saleor sur Redis. |
| `redis_host` | `""` | Se rabat sur l'IP du serveur NFS lorsque `enable_nfs = true`. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 14/16 — Cloud Storage et base de données {#group-1416--cloud-storage--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires, en plus du bucket `media` déclaré par `Saleor_Common`. |
| `database_type` | `POSTGRES` | Déclarée par souci de cohérence avec la convention ; `Saleor_Common` fixe toujours PostgreSQL 15, quelle que soit cette valeur. |
| `application_database_name` | `gkeapp` | Nom de la base de données PostgreSQL. Remplacement recommandé : `saleor_db`. Immuable après le premier déploiement. |
| `application_database_user` | `gkeapp` | Utilisateur de base de données de l'application. Remplacement recommandé : `saleor_user`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Gateway API + une IP statique pour les noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | Recommandé une fois que `service_type` est revenu à `LoadBalancer`. |

### Groupe 10/22 — Observabilité et santé {#group-1022--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health/`, délai 90s | Sonde de démarrage transmise à `Saleor_Common` — laisse à `db-migrate` le temps de se terminer. |
| `liveness_probe` | HTTP `/health/`, délai 60s | Sonde de vivacité transmise à `Saleor_Common`. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif — nécessite un point de terminaison accessible publiquement. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Options standard d'App_GKE pour VPC-SC et les journaux d'audit — consultez
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes (API principale). |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP du LoadBalancer externe — renseignée uniquement lorsque `service_type = LoadBalancer` et qu'une IP statique est réservée ; vide dans le déploiement `ClusterIP` actuel de ce projet. |
| `service_url` | URL permettant d'accéder à Saleor. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (`127.0.0.1` via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (dont `media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image de l'API déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

L'URL propre à la charge de travail Dashboard est renvoyée dans l'environnement de l'API
principale sous la forme `SALEOR_DASHBOARD_URL`, plutôt que comme sortie Terraform de
premier niveau.

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `RSA_PRIVATE_KEY` (généré automatiquement) | Jamais de rotation hors d'une fenêtre de maintenance | Critique | Sa rotation invalide chaque JWT émis — toutes les sessions actives doivent se réauthentifier. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="3Gi" }` | Élevé | Des tailles inférieures provoquent des OOMKill avec l'arrondi mémoire d'Autopilot, ce qui a été confirmé en conditions réelles pour la charge de travail combinée uvicorn + Celery. |
| `service_type` | `LoadBalancer` dès que le quota d'IP le permet | Moyen | `ClusterIP` (l'état actuel de ce projet) rend Saleor inaccessible, sauf via `kubectl port-forward` ou depuis l'intérieur du cluster. |
| `enable_redis` / `redis_host` | Cohérents — définissez les deux ensemble, ou aucun | Élevé | Activer Redis sans hôte accessible (et sans `enable_nfs` pour le repli) casse la composition de `CACHE_URL`/`CELERY_BROKER_URL`. |
| `SALEOR_SUPERUSER_EMAIL` / `DJANGO_SUPERUSER_PASSWORD` | Récupérer rapidement depuis Secret Manager | Élevé | Le compte administrateur d'amorçage est le seul moyen d'accès au premier déploiement. |
| `termination_grace_period_seconds` | ≥ 30s | Moyen | Une valeur trop courte interrompt le worker Celery en pleine tâche lors d'une mise à jour progressive ou d'une réduction d'échelle. |
| `enable_iap` | uniquement lorsque le Dashboard/l'API n'ont pas besoin d'un accès public | Élevé | IAP bloque les requêtes non authentifiées vers les services API et Dashboard. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Saleor partagée avec la
variante Cloud Run est décrite dans **[Saleor_Common](Saleor_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Saleor sur GKE Autopilot](../labs/Saleor_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Saleor sur Google Cloud Run](Saleor_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Saleor Common — Configuration applicative partagée](Saleor_Common.md) — la configuration partagée par les deux cibles de déploiement.
