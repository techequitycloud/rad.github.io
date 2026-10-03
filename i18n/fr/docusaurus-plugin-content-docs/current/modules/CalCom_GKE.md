---
title: "Cal.com sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Cal.com sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CalCom_GKE.md @ 15fd4c7 sha256:876ab23505f4 -->

# Cal.com sur GKE Autopilot {#calcom-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalCom_GKE.png" alt="Cal.com sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.com est une plateforme de planification open source sous licence AGPL —
l'alternative auto-hébergée à Calendly — construite avec **Next.js** et
**Prisma** sur PostgreSQL. Ce module déploie Cal.com sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Cal.com et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.com s'exécute comme une charge de travail web Next.js. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 2 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Cal.com (Prisma/`pg`) cible uniquement PostgreSQL |
| Stockage d'objets | Cloud Storage (aucun par défaut) | Cal.com stocke tout l'état dans PostgreSQL ; aucun bucket de téléchargement n'est créé |
| Cache | Redis (optionnel) | Désactivé par défaut ; utilisé pour la mise en cache / la limitation de débit |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; le schéma Prisma de Cal.com cible
  uniquement PostgreSQL.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Ne les faites jamais pivoter après le premier
  démarrage sans fenêtre de maintenance — faire pivoter `CALENDSO_ENCRYPTION_KEY` rend
  toutes les informations d'identification de calendrier/OAuth stockées
  indéchiffrables, et faire pivoter `NEXTAUTH_SECRET` invalide toutes les sessions.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  par défaut à l'URL du service du cluster (définie à partir de `GKE_SERVICE_URL`
  à l'exécution) ; définissez `webapp_url` à l'adresse du LoadBalancer
  externe ou au domaine personnalisé une fois connus, sinon les liens de
  réservation/OAuth seront incorrects.
- **Le schéma est créé au démarrage, et non par un job de migration.** Le job
  `db-init` ne provisionne que la base de données et le rôle vides ;
  Cal.com exécute `prisma migrate deploy` à chaque démarrage. Prévoyez plusieurs
  minutes pour le premier démarrage.
- **La mémoire minimale est de 2 GiB.** Cal.com (Next.js 16) plante par manque
  de mémoire au démarrage en dessous de 2 GiB.
- **L'affinité de session est `ClientIP` par défaut**, gardant les
  requêtes d'un client sur le même pod pour un comportement cohérent de l'UI/session.
- **Le sidecar Cloud SQL Auth Proxy est utilisé par défaut** (`enable_cloudsql_volume = true`),
  donnant à Cal.com un point de terminaison PostgreSQL `127.0.0.1` en
  boucle locale avec du texte en clair (le proxy termine mTLS).
- **Redis est désactivé par défaut.** Ne l'activez que pour le cache / la
  limitation de débit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont rapportés dans les
[Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Cal.com {#a-gke-autopilot--the-calcom-workload}

Les pods Cal.com sont planifiés sur Autopilot, qui facture le CPU/la mémoire
que les pods demandent réellement. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Cal.com pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.com stocke toutes les données d'application (utilisateurs, types
d'événements, réservations, informations d'identification de calendrier
connecté) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Les pods y
accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ;
aucune adresse IP publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et le rôle de l'application, et
Cal.com applique son schéma via Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Cal.com conserve tout l'état dans PostgreSQL, donc **aucun bucket de données
n'est créé par défaut** (`storage_buckets` est vide). Des buckets
supplémentaires peuvent toujours être déclarés via `storage_buckets` si
nécessaire pour des intégrations personnalisées.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Redis (cache optionnel) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé,
Cal.com l'utilise comme backend de cache / de limitation de débit. Lorsque
`redis_host` est laissé vide et que `enable_nfs` est vrai, l'adresse IP
de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `NEXTAUTH_SECRET` (signe les jetons de session NextAuth.js) et
`CALENDSO_ENCRYPTION_KEY` (chiffre les informations d'identification de calendrier/OAuth
stockées). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et la
rotation de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat
géré par Google peut être activé (`enable_custom_domain = true` par défaut), et une
adresse IP statique est réservée afin que l'adresse survive aux
redéploiements. Définissez `webapp_url` sur l'URL externe résultante afin
que les liens de réservation/OAuth générés par Cal.com soient corrects.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des vérifications de disponibilité et des règles
d'alerte optionnelles sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Cal.com {#3-calcom-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle
  et la base de données de l'application et accorde des privilèges sur le
  schéma `public`. Il ne crée **pas** le schéma de l'application —
  c'est le travail de Cal.com.
- **Migrations de schéma au démarrage.** Le script de démarrage de l'image
  exécute `prisma migrate deploy` à chaque démarrage, créant le schéma au premier
  démarrage et appliquant de nouvelles migrations lors des mises à niveau de
  version — pas d'étape de migration séparée. Prévoyez plusieurs minutes pour
  le premier démarrage avant que le pod ne devienne Ready.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont immuables après le premier
  démarrage.** Changer `CALENDSO_ENCRYPTION_KEY` rend toutes les informations
  d'identification de calendrier/OAuth stockées indéchiffrables (chaque
  intégration doit être ré-autorisée) ; changer `NEXTAUTH_SECRET` déconnecte
  tous les utilisateurs. Ne faites pivoter que pendant une fenêtre de
  maintenance planifiée.
- **L'URL publique nécessite l'adresse IP externe.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  sont définis à partir de `GKE_SERVICE_URL` à l'exécution. Une fois que
  l'adresse IP du LoadBalancer (ou le domaine personnalisé) est attribuée,
  définissez `webapp_url` sur cette adresse :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
  Ou définissez `environment_variables`/`webapp_url` dans la configuration du module
  avant le déploiement.
- **Configuration initiale.** Ouvrez l'URL externe et complétez
  l'intégration de Cal.com pour créer le compte administrateur/propriétaire
  initial, puis configurez au moins un calendrier connecté. Cal.com
  auto-hébergé autorise l'inscription en libre-service par défaut —
  restreignez-la (ou placez un IAP devant le service) si l'instance ne doit
  pas être publique.
- **Chemin de santé.** La sonde de démarrage cible `/` (une
  redirection 307, que le kubelet accepte) ; la sonde de vivacité cible
  `/api/auth/providers`, qui renvoie un 200 littéral. La sonde de vivacité est
  répliquée dans la vérification de santé de la passerelle, qui nécessite
  un 200, donc la pointer vers `/` laisse la passerelle servir
  des 503. La fenêtre de démarrage généreuse (délai initial de 0 seconde,
  jusqu'à une fenêtre de nouvelle tentative de 30×30s ≈ 15 minutes)
  s'adapte aux migrations Prisma du premier démarrage.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Cal.com sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calcom` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Cal.com` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Cal.com (définit `CALCOM_VERSION`) ; épingler à une version spécifique en production. |
| `webapp_url` | `""` | URL publique pour `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Vide → l'URL du cluster d'exécution ; définir sur l'adresse du LoadBalancer/domaine personnalisé une fois connue. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et autoscaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_port` | `3000` | Port sur lequel Cal.com écoute. |
| `cpu_limit` | `2000m` | CPU par pod. |
| `memory_limit` | `2Gi` | **Minimum 2 GiB** — Next.js 16 plante par manque de mémoire en dessous. |
| `min_instance_count` | `0` | Réplicas minimum. |
| `max_instance_count` | `3` | Réplicas maximum. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy pour les connexions socket/loopback. Garder `true` pour la connectivité PostgreSQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Cal.com dans Artifact Registry avant le déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY` ou `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom du secret Secret Manager (par exemple, informations d'identification SMTP ou d'application OAuth). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `Deployment` | `Deployment` (sans état) ou `StatefulSet`. Cal.com est sans état — garder `Deployment`. |
| `session_affinity` | `ClientIP` | Routage persistant pour que les requêtes d'un client atteignent le même pod. |
| `termination_grace_period_seconds` | `30` | Secondes à attendre après SIGTERM avant SIGKILL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | Activer les modèles PVC. Non nécessaire — Cal.com stocke tout l'état dans PostgreSQL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume partagé optionnel ; héberge également Redis co-localisé lorsqu'il est activé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis comme backend de cache / de limitation de débit. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'adresse IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `calcom` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 ; les autres moteurs ne sont pas pris en charge. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_postgres_extensions` | `true` | **Valeur par défaut GKE uniquement** — remplace la valeur par défaut désactivée de `CalCom_Common`. Déclenche le job Kubernetes privilégié `App_GKE` de `<service>-db-extensions`. |
| `postgres_extensions` | `["vector", "uuid-ossp"]` | Extensions que le job `db-extensions` pré-crée. `vector` (pgvector) est requis par le schéma Prisma de Cal.com ; sans cela, le `CREATE EXTENSION IF NOT EXISTS` non privilégié de l'application échoue avec une erreur de permission refusée. `CalCom_CloudRun` ne transmet pas du tout ces deux variables. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées en cas de déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Cal.com. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — `min_instance_count > max_instance_count`,
> IAP sans client OAuth, Redis activé sans `redis_host` ni NFS, `enable_cloudsql_volume`
> avec `database_type = NONE`, et les valeurs ResourceQuota en unités binaires. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les informations d'identification de calendrier/OAuth stockées indéchiffrables — chaque intégration doit être ré-autorisée. |
| `NEXTAUTH_SECRET` (auto-généré) | Ne faire pivoter que dans une fenêtre de maintenance | Critique | Le faire pivoter invalide toutes les sessions utilisateur actives, forçant une reconnexion immédiate. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Le schéma Prisma de Cal.com cible uniquement PostgreSQL ; tout autre moteur interrompt le démarrage. |
| `webapp_url` | LoadBalancer externe / URL de domaine | Critique | Une URL incorrecte ou non définie est intégrée à chaque lien de réservation/OAuth ; la valeur par défaut `localhost:3000` de l'image empêche le serveur de démarrer. |
| `enable_redis` + `redis_host`/`enable_nfs` | paire cohérente | Élevé | Redis activé sans hôte et sans NFS échoue à une précondition de planification — `REDIS_URL` serait vide et Cal.com ne pourrait pas se connecter. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 2 GiB, Next.js 16 plante par manque de mémoire au démarrage et le pod ne devient jamais Ready. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes d'un client sautent entre les pods, perturbant les sessions UI. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy fournit le point de terminaison de bouclage PostgreSQL ; le désactiver avec une vraie base de données est bloqué par une garde de planification. |
| `enable_postgres_extensions` / `postgres_extensions` | `true` / `["vector", "uuid-ossp"]` | Élevé | GKE les active par défaut (contrairement à la valeur par défaut désactivée de `CalCom_Common` et contrairement à `CalCom_CloudRun`, qui ne les transmet pas du tout) de sorte que le job privilégié `db-extensions` pré-crée `vector` — sans cela, le `CREATE EXTENSION IF NOT EXISTS` non privilégié de Cal.com rencontre une erreur de permission refusée sur Cloud SQL. |
| `enable_iap` | uniquement pour les instances privées | Élevé | IAP bloque toutes les requêtes non authentifiées — y compris les intégrations et les pages de réservation publiques. |
| Inscription ouverte | désactiver pour les instances privées | Élevé | Cal.com auto-hébergé autorise l'inscription en libre-service ; le laisser ouvert permet à quiconque ayant l'URL de créer un compte. |
| `min_instance_count` ≤ `max_instance_count` | garder ordonné | Moyen | Une plage HPA conflictuelle échoue à une précondition de planification. |
| `startup_probe` timing | garder la valeur par défaut généreuse | Moyen | Une fenêtre trop courte fait échouer la sonde pendant les migrations Prisma du premier démarrage, bloquant le déploiement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Cal.com
partagée avec la variante Cloud Run est décrite dans
**[CalCom_Common](CalCom_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Cal.com sur GKE Autopilot](../labs/CalCom_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cal.com sur Google Cloud Run](CalCom_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalCom Common — Configuration d'application partagée](CalCom_Common.md) — la configuration partagée par les deux cibles de déploiement.
