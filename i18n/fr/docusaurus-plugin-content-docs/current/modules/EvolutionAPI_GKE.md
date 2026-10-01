---
title: "EvolutionAPI sur GKE Autopilot"
description: "Référence de configuration pour déployer EvolutionAPI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/EvolutionAPI_GKE.md @ 3055034 sha256:27e89519a496 -->

# EvolutionAPI sur GKE Autopilot {#evolutionapi-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/EvolutionAPI_GKE.png" alt="EvolutionAPI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Evolution API est une passerelle open source Node.js vers l'API WhatsApp Business
(construite sur la bibliothèque Baileys) qui provisionne des instances WhatsApp,
envoie et reçoit des messages, et expose une API REST ainsi qu'une interface de
gestion (manager) pour intégrer WhatsApp à d'autres systèmes. Ce module déploie
Evolution API sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Evolution API et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Evolution API s'exécute comme une charge de travail web Node.js sur GKE Autopilot.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 2 vCPU / 4 GiB par défaut ; **épinglé à un seul réplica** |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Evolution API utilise Prisma, uniquement avec PostgreSQL |
| Cache | Redis | **Activé par défaut** (`CACHE_REDIS_URI`) ; met en cache l'état des instances et des messages |
| Stockage objet | Cloud Storage | Un bucket de données dédié, provisionné automatiquement |
| Secrets | Secret Manager | `AUTHENTICATION_API_KEY` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec affinité de session `ClientIP` ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; Evolution API utilise Prisma et ne prend pas en
  charge d'autres moteurs.
- **La charge de travail est épinglée à un seul réplica** (`min_instance_count = 1`,
  `max_instance_count = 1`). Evolution API conserve en mémoire, par pod, les sessions
  de socket WhatsApp (Baileys) actives ; ces sessions ne sont **pas** partagées entre
  réplicas, si bien que la mise à l'échelle horizontale fragmente les connexions
  actives. N'augmentez pas `max_instance_count`.
- **`AUTHENTICATION_API_KEY` est généré automatiquement** et stocké dans Secret
  Manager. C'est la clé d'administration globale d'Evolution API, et elle ne doit
  **jamais faire l'objet d'une rotation après le premier démarrage** — la renouveler
  rend injoignables les instances WhatsApp déjà provisionnées et renvoie `401` à tout
  client qui détient encore l'ancienne clé.
- **Redis est activé par défaut** (`enable_redis = true`). Laissez `redis_host` vide
  pour utiliser l'IP de la VM du serveur NFS comme point de terminaison Redis
  (nécessite `enable_nfs = true`), ou pointez-le vers une instance gérée explicite.
- **L'affinité de session est `ClientIP`** et le type de Service est `LoadBalancer`
  par défaut, ce qui expose une IP externe pour les rappels de webhook WhatsApp et
  l'interface de gestion.
- **La mémoire est de 4 GiB par défaut** — Evolution API a besoin d'au moins 2 GiB
  pour fonctionner de manière fiable.
- **`SERVER_URL` reçoit une valeur par défaut à l'exécution** de la part du point
  d'entrée du conteneur, à partir de l'URL de service injectée, de sorte que les URL
  de QR code et de rappel de webhook reflètent l'adresse réelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Evolution API {#a-gke-autopilot--the-evolution-api-workload}

Les pods Evolution API sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. La charge de travail s'exécute en un seul
réplica par conception.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Evolution API pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Evolution API stocke toutes les données applicatives (instances WhatsApp, contacts,
conversations, historique des messages) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods s'y connectent de manière privée via le sidecar **Cloud SQL
Auth Proxy** sur une boucle locale TCP (`127.0.0.1`) ; aucune IP publique n'est
exposée. Au premier déploiement, un Job d'initialisation crée la base de données et
l'utilisateur de l'application ; les migrations Prisma créent ensuite le schéma au
démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=evolution --database=evolution --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`evolution`), l'utilisateur (`evolution`)
et le secret Secret Manager contenant le mot de passe figurent tous dans les
[sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la
rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié est provisionné automatiquement pour le
stockage de fichiers d'Evolution API. Le compte de service de la charge de travail
reçoit l'accès. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Cache Redis {#d-redis-cache}

Redis est **activé par défaut** (`enable_redis = true`). Evolution API l'utilise pour
mettre en cache les instances et les messages (`CACHE_REDIS_URI`, index de base Redis
`6`). Lorsque `redis_host` est laissé vide et que `enable_nfs = true`, l'IP de la VM
du serveur NFS sert de point de terminaison Redis ; le point d'entrée du conteneur
assemble l'URI à l'exécution.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the cache URI is injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CACHE_REDIS
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`AUTHENTICATION_API_KEY` — la clé d'API d'administration globale d'Evolution API,
montée via le pilote Secret Store CSI. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~api-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
avec une affinité de session `ClientIP` — nécessaire pour que les requêtes d'un client
WhatsApp restent attachées à l'unique pod qui détient son socket. Un domaine
personnalisé avec un certificat géré par Google peut être activé, et une IP statique
peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
et Cloud SQL sont envoyées à Cloud Monitoring. Le point d'entrée émet des marqueurs
`[cloud-entrypoint]` qui confirment au démarrage la configuration résolue de la base
de données, de Redis et de l'URL. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application EvolutionAPI {#3-evolutionapi-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et le rôle
  `evolution`, accorde les privilèges et fait de l'utilisateur de l'application le
  propriétaire du schéma `public`, puis signale au sidecar du proxy de s'arrêter afin
  que le pod du Job se termine. Le job peut être réexécuté sans risque.
- **Migrations Prisma au démarrage.** Evolution API exécute `prisma migrate deploy` à
  chaque démarrage du conteneur (via le script encapsulé `deploy_database.sh`), de
  sorte que la mise à niveau de la version de l'application applique les modifications
  de schéma sans étape de migration distincte. Sur GKE, le sidecar cloud-sql-proxy
  est une boucle locale TCP ; le point d'entrée se connecte donc avec
  `sslmode=disable`.
- **`AUTHENTICATION_API_KEY` est immuable après le premier démarrage.** La clé
  d'administration globale est générée une seule fois et écrite dans Secret Manager.
  La renouveler rend injoignables toutes les instances WhatsApp déjà provisionnées et
  renvoie `401` à tout client qui détient encore l'ancienne clé. Ne la renouvelez que
  lors d'une migration planifiée.
- **Réplica unique par conception.** Les sessions de socket WhatsApp (Baileys)
  résident dans la mémoire du pod et ne sont pas partagées entre réplicas.
  `min_instance_count = 1` en garde un en cours d'exécution ; `max_instance_count = 1`
  évite de fragmenter les connexions actives. Ne procédez pas à une mise à l'échelle
  horizontale. L'affinité de session `ClientIP` maintient chaque client attaché au
  pod.
- **URL de rappel webhook / QR.** Le point d'entrée attribue par défaut à `SERVER_URL`
  l'URL de service injectée. Une fois l'IP externe du LoadBalancer attribuée, définissez
  `SERVER_URL` (via `environment_variables`) sur l'URL externe afin que les rappels de
  QR code et de webhook utilisent une adresse joignable :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
- **Configuration initiale.** Après le déploiement, récupérez
  `AUTHENTICATION_API_KEY` dans Secret Manager et utilisez-la (comme en-tête `apikey`)
  pour accéder à l'interface de gestion sur `/manager`, créez une instance WhatsApp
  (`POST /instance/create`), puis scannez le QR code renvoyé depuis WhatsApp sur votre
  téléphone pour connecter le numéro.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent la racine `/` —
  un point de terminaison d'état non authentifié qui répond dès que le serveur est
  opérationnel. Prévoyez plusieurs minutes au premier démarrage, le temps que les
  migrations Prisma s'exécutent.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Evolution API ou notables pour elle
sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec
leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `evolutionapi` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `v2.1.1` | Tag de l'image Evolution API ; `latest` correspond à un `v2.1.1` épinglé dans l'argument de build. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pod ; en garde un en cours d'exécution pour les sockets WhatsApp en mémoire. |
| `max_instance_count` | `1` | **Épinglé à 1.** Ne l'augmentez pas — les sessions ne sont pas partagées entre les pods. |
| `container_port` | `8080` | Evolution API écoute sur le port 8080 (`SERVER_PORT`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour la connectivité PostgreSQL. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose une IP externe pour les rappels de webhook et l'interface de gestion. |
| `workload_type` | `null` (résolu automatiquement en `Deployment`) | Deployment sans état (tout l'état réside dans PostgreSQL et Redis). |
| `session_affinity` | `ClientIP` | Routage persistant, afin que les requêtes d'un client atteignent le pod qui détient son socket WhatsApp. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne la VM du serveur NFS, qui héberge également le point de terminaison Redis (voir le groupe 15). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active le cache Redis d'Evolution API (`CACHE_REDIS_URI`). |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `evolution` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `evolution` | Utilisateur de base de données de l'application. Immuable après le premier déploiement. |

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
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Evolution API. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un conflit `StatefulSet`, IAP sans identité autorisée, des unités `quota_memory_*` non binaires, un `redis_port`/`backup_retention_days` hors plage, `enable_cloudsql_volume = false` sur une application adossée à une base de données. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTICATION_API_KEY` (généré automatiquement) | Ne jamais la renouveler après le premier démarrage | Critical | La renouveler rend injoignable chaque instance WhatsApp déjà provisionnée et renvoie `401` à tous les clients qui détiennent l'ancienne clé. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit tout l'historique des messages. |
| `max_instance_count` | `1` | Critical | La mise à l'échelle horizontale fragmente les sessions de socket WhatsApp en mémoire entre les pods, ce qui rompt les connexions actives et duplique les livraisons de webhook. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'importation. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; le désactiver rompt la connexion à la base de données. |
| `enable_redis` | `true` | High | Le désactiver supprime le cache des instances et des messages d'Evolution API ; l'application est configurée pour s'y attendre (`CACHE_REDIS_ENABLED = true`). |
| `redis_host` | `""` (NFS) ou explicite | High | Lorsque Redis est activé mais que NFS est désactivé et qu'aucun hôte n'est défini, l'URI du cache est vide et la mise en cache est désactivée silencieusement. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes peuvent être routées hors de l'unique pod qui détient le socket WhatsApp, ce qui casse les opérations sur les instances. |
| `service_type` | `LoadBalancer` | High | `ClusterIP` rend l'interface de gestion et les points de terminaison de webhook injoignables depuis l'extérieur du cluster. |
| `min_instance_count` | `1` | High | GKE exige min ≥ 1 ; le garde-fou de validation rejette les valeurs invalides. Conserver 1 préserve les sockets WhatsApp actifs. |
| `enable_iap` | uniquement lorsque les webhooks ne sont pas nécessaires | High | IAP bloque toutes les requêtes non authentifiées, y compris les rappels de webhook externes. |
| `application_version` | Épingler (p. ex. `v2.1.1`) | Medium | `latest` correspond à un tag épinglé, mais épingler explicitement évite des mises à niveau surprises qui exécutent de nouvelles migrations Prisma. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Evolution API,
partagée avec la variante Cloud Run, est décrite dans
**[EvolutionAPI_Common](EvolutionAPI_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Evolution API sur GKE Autopilot](../labs/EvolutionAPI_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [EvolutionAPI Common — Configuration applicative partagée](EvolutionAPI_Common.md) — la configuration partagée par les deux cibles de déploiement.
