---
title: "Cal.com sur GKE Autopilot"
description: "Référence de configuration pour déployer Cal.com sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CalCom_GKE.md @ 3055034 sha256:02befd3e63db -->

# Cal.com sur GKE Autopilot {#calcom-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalCom_GKE.png" alt="Cal.com sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.com est une plateforme de planification open source sous licence AGPL — l'alternative
auto-hébergée à Calendly — construite avec **Next.js** et **Prisma** sur PostgreSQL. Ce
module déploie Cal.com sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud utilisés par Cal.com et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.com s'exécute sous la forme d'une charge de travail web Next.js. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Cal.com (Prisma/`pg`) cible uniquement PostgreSQL |
| Stockage d'objets | Cloud Storage (aucun par défaut) | Cal.com stocke tout son état dans PostgreSQL ; aucun bucket de téléversement n'est créé |
| Cache | Redis (facultatif) | Désactivé par défaut ; utilisé pour la mise en cache / la limitation de débit |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; le schéma Prisma de Cal.com cible uniquement PostgreSQL.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. N'effectuez jamais leur rotation après le premier démarrage sans fenêtre de
  maintenance — la rotation de `CALENDSO_ENCRYPTION_KEY` rend indéchiffrables tous les identifiants
  de calendrier/OAuth stockés, et celle de `NEXTAUTH_SECRET` invalide toutes les sessions.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  prennent par défaut l'URL du service du cluster (définie à partir de `GKE_SERVICE_URL` à l'exécution) ; définissez
  `webapp_url` sur l'adresse du LoadBalancer externe ou sur le domaine personnalisé dès qu'elle est connue, faute de quoi
  les liens de réservation/OAuth seront erronés.
- **Le schéma est créé au démarrage, pas par un job de migration.** Le job `db-init` se contente
  de provisionner la base de données et le rôle vides ; Cal.com exécute `prisma migrate deploy` à
  chaque démarrage. Prévoyez plusieurs minutes pour le premier démarrage.
- **Le plancher de mémoire est de 2 GiB.** Cal.com (Next.js 16) plante en OOM au démarrage en dessous de 2 GiB.
- **L'affinité de session est `ClientIP` par défaut**, ce qui maintient les requêtes d'un client sur le
  même pod pour un comportement cohérent de l'interface et des sessions.
- **Le sidecar Cloud SQL Auth Proxy est utilisé par défaut** (`enable_cloudsql_volume = true`),
  ce qui fournit à Cal.com un point de terminaison PostgreSQL en loopback `127.0.0.1` en clair (le proxy
  termine le mTLS).
- **Redis est désactivé par défaut.** Ne l'activez que pour servir de cache / de support à la limitation de débit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cal.com {#a-gke-autopilot--the-calcom-workload}

Les pods Cal.com sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés
par les pods. L'Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal
et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Cal.com pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.com stocke toutes les données applicatives (utilisateurs, types d'événements, réservations, identifiants des calendriers
connectés) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de façon privée
via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ; aucune IP publique n'est exposée. Lors du
premier déploiement, un Job d'initialisation crée la base de données et le rôle de l'application, et
Cal.com applique son schéma via Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Cal.com conserve tout son état dans PostgreSQL ; **aucun bucket de données n'est donc créé par défaut**
(`storage_buckets` est vide). Des buckets supplémentaires peuvent toujours être déclarés via
`storage_buckets` si des intégrations personnalisées le nécessitent.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, Cal.com l'utilise
comme backend de cache / de limitation de débit. Lorsque `redis_host` est laissé vide et que `enable_nfs`
vaut true, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager :
`NEXTAUTH_SECRET` (signe les jetons de session NextAuth.js) et `CALENDSO_ENCRYPTION_KEY`
(chiffre les identifiants de calendrier/OAuth stockés). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé (`enable_custom_domain = true` par défaut), et une IP statique est réservée afin que
l'adresse survive aux redéploiements. Définissez `webapp_url` sur l'URL externe obtenue afin que
les liens de réservation/OAuth générés par Cal.com soient corrects.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cal.com {#3-calcom-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` à l'aide de
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  le rôle et la base de données de l'application, puis accorde les privilèges sur le schéma
  `public`. Il ne crée **pas** le schéma applicatif — c'est le rôle de Cal.com.
- **Migrations de schéma au démarrage.** Le script de démarrage de l'image exécute `prisma migrate deploy`
  à chaque démarrage, créant le schéma au premier démarrage et appliquant les nouvelles migrations lors des
  mises à niveau de version — aucune étape de migration distincte. Prévoyez plusieurs minutes pour le premier
  démarrage avant que le pod ne passe à l'état Ready.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont immuables après le premier démarrage.**
  Modifier `CALENDSO_ENCRYPTION_KEY` rend indéchiffrables tous les identifiants de calendrier/OAuth stockés
  (chaque intégration doit être réautorisée) ; modifier `NEXTAUTH_SECRET`
  déconnecte tous les utilisateurs. N'effectuez de rotation que lors d'une fenêtre de maintenance planifiée.
- **L'URL publique nécessite l'IP externe.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  sont définies à partir de `GKE_SERVICE_URL` à l'exécution. Une fois l'IP du LoadBalancer (ou le domaine
  personnalisé) attribuée, définissez `webapp_url` sur cette adresse :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Vous pouvez aussi définir `environment_variables`/`webapp_url` dans la configuration du module avant
  le déploiement.
- **Configuration au premier lancement.** Ouvrez l'URL externe et terminez l'intégration Cal.com pour
  créer le compte administrateur/propriétaire initial, puis configurez au moins un calendrier
  connecté. Cal.com auto-hébergé autorise par défaut l'inscription en libre-service — restreignez-la
  (ou placez IAP devant le service) si l'instance ne doit pas être publique.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`. La fenêtre de démarrage généreuse
  (délai initial de 0 seconde, jusqu'à une fenêtre de 30×30s tentatives ≈ 15 minutes) absorbe les
  migrations Prisma du premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls les paramètres
propres à Cal.com ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calcom` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Cal.com` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Cal.com (définit `CALCOM_VERSION`) ; fixez une version précise en production. |
| `webapp_url` | `""` | URL publique pour `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Vide → l'URL du cluster à l'exécution ; définissez l'adresse du LoadBalancer/du domaine personnalisé dès qu'elle est connue. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_port` | `3000` | Port d'écoute de Cal.com. |
| `cpu_limit` | `2000m` | CPU par pod. |
| `memory_limit` | `2Gi` | **Minimum 2 GiB** — Next.js 16 plante en OOM en dessous. |
| `min_instance_count` | `0` | Nombre minimal de réplicas. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour les connexions par socket/loopback. Laissez à `true` pour la connectivité PostgreSQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Cal.com dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY` ni `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager (p. ex. identifiants SMTP ou d'application OAuth). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `Deployment` | `Deployment` (sans état) ou `StatefulSet`. Cal.com est sans état — conservez `Deployment`. |
| `session_affinity` | `ClientIP` | Routage persistant afin que les requêtes d'un client atteignent le même pod. |
| `termination_grace_period_seconds` | `30` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Active les modèles de PVC. Inutile — Cal.com stocke tout son état dans PostgreSQL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume partagé facultatif ; héberge aussi le Redis colocalisé lorsqu'il est activé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis comme backend de cache / de limitation de débit. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `calcom` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur de base de données de l'application. Immuable après le premier déploiement. |
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 ; les autres moteurs ne sont pas pris en charge. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` | `true` | **Valeur par défaut propre à GKE** — remplace la désactivation par défaut de `CalCom_Common`. Déclenche le Job Kubernetes privilégié `<service>-db-extensions` d'`App_GKE`. |
| `postgres_extensions` | `["vector", "uuid-ossp"]` | Extensions que le job `db-extensions` crée à l'avance. `vector` (pgvector) est requise par le schéma Prisma de Cal.com ; sans elle, la commande non privilégiée `CREATE EXTENSION IF NOT EXISTS` de l'application échoue avec une erreur d'autorisation refusée. `CalCom_CloudRun` ne transmet pas du tout ces deux variables. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Cal.com. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et du job d'import (facultatif). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — `min_instance_count > max_instance_count`, IAP sans client OAuth, Redis activé sans `redis_host` ni NFS, `enable_cloudsql_volume` avec `database_type = NONE`, et des valeurs de ResourceQuota en unités binaires. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (généré automatiquement) | Aucune rotation après le premier démarrage | Critique | Sa rotation rend indéchiffrables tous les identifiants de calendrier/OAuth stockés — chaque intégration doit être réautorisée. |
| `NEXTAUTH_SECRET` (généré automatiquement) | Rotation uniquement lors d'une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions utilisateur actives et impose une reconnexion immédiate. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Le schéma Prisma de Cal.com cible uniquement PostgreSQL ; tout autre moteur empêche le démarrage. |
| `webapp_url` | URL du LoadBalancer externe / du domaine | Critique | Une URL erronée ou non définie est intégrée à chaque lien de réservation/OAuth ; la valeur par défaut de l'image, `localhost:3000`, empêche le serveur de démarrer. |
| `enable_redis` + `redis_host`/`enable_nfs` | paire cohérente | Élevé | Redis activé sans hôte ni NFS fait échouer une précondition au moment du plan — `REDIS_URL` serait vide et Cal.com ne pourrait pas se connecter. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 2 GiB, Next.js 16 plante en OOM au démarrage et le pod ne passe jamais à l'état Ready. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance de session, les requêtes d'un client passent d'un pod à l'autre, ce qui perturbe les sessions de l'interface. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy fournit le point de terminaison PostgreSQL en loopback ; le désactiver avec une base de données réelle est bloqué par un garde-fou au moment du plan. |
| `enable_postgres_extensions` / `postgres_extensions` | `true` / `["vector", "uuid-ossp"]` | Élevé | GKE les active par défaut (contrairement à la désactivation par défaut propre à `CalCom_Common` et contrairement à `CalCom_CloudRun`, qui ne les transmet pas du tout) afin que le job privilégié `db-extensions` crée à l'avance `vector` — sans cela, la commande non privilégiée `CREATE EXTENSION IF NOT EXISTS` propre à Cal.com se heurte à une erreur d'autorisation refusée sur Cloud SQL. |
| `enable_iap` | uniquement pour les instances privées | Élevé | IAP bloque toutes les requêtes non authentifiées — y compris les intégrations et les pages de réservation publiques. |
| Inscription ouverte | à désactiver pour les instances privées | Élevé | Cal.com auto-hébergé autorise l'inscription en libre-service ; la laisser ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `min_instance_count` ≤ `max_instance_count` | conserver l'ordre | Moyen | Une plage HPA incohérente fait échouer une précondition au moment du plan. |
| Délais de `startup_probe` | conserver la valeur par défaut généreuse | Moyen | Une fenêtre trop serrée fait échouer la sonde pendant les migrations Prisma du premier démarrage, bloquant le déploiement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Cal.com, partagée avec la variante Cloud Run, est décrite dans
**[CalCom_Common](CalCom_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cal.com sur GKE Autopilot](../labs/CalCom_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cal.com sur Google Cloud Run](CalCom_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalCom Common — Configuration applicative partagée](CalCom_Common.md) — la configuration partagée par les deux cibles de déploiement.
