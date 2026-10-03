---
title: "Coder sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Coder sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Coder_GKE.md @ 15fd4c7 sha256:778a3536fdb1 -->

# Coder sur GKE Autopilot {#coder-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Coder_GKE.png" alt="Coder sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Coder est une plateforme open-source auto-hébergée pour le provisionnement
d'environnements de développement à distance ("espaces de travail") définis
sous forme de code avec Terraform. Elle se présente sous la forme d'un
unique binaire Go (`coder server`) qui sert l'interface utilisateur/API du
plan de contrôle web et proxy les connexions WebSocket pour les IDE de
navigateur et les sessions de terminal vers les espaces de travail en cours
d'exécution. Ce module déploie le **plan de contrôle** Coder sur **GKE
Autopilot** au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée Google Cloud et Kubernetes. Le
provisionnement des espaces de travail réels nécessite en outre un
provisionneur configuré et une cible de calcul (par exemple un cluster
Kubernetes ou un modèle de VM cloud) configurés après le déploiement — ce
module ne fait que mettre en place le plan de contrôle.

Ce guide se concentre sur les services cloud que Coder utilise et sur la
façon de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Le plan de contrôle de Coder est sans état — tout l'état, y compris ses clés
de signature auto-générées, réside dans PostgreSQL — le déploiement relie
donc un petit ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go sur le port 3000, 2 vCPU / 4 GiB par défaut, un réplica (`max_instance_count = 1`) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — MySQL est rejeté au moment du plan |
| Stockage d'objets | Cloud Storage | Un bucket `storage` provisionné automatiquement par `Coder_Common` |
| Secrets | Secret Manager | Seulement le mot de passe de la base de données géré par la Fondation — Coder n'a pas de secret d'application propre |
| Ingress | Cloud Load Balancing | Ingress Kubernetes avec une IP statique globale réservée ; domaine personnalisé optionnel |
| Build de conteneur | Cloud Build + Artifact Registry | Encapsule l'image amont `ghcr.io/coder/coder` avec un point d'entrée cloud |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est requis.** `database_type` par défaut à `POSTGRES_15` ; une
  validation au moment du plan dans `validation.tf` rejette tout ce qui n'est
  pas `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas
  pris en charge.
- **`container_image_source = "custom"` est requis, pas optionnel.** L'image amont
  `ghcr.io/coder/coder` ne peut pas analyser le câblage de la base de données de la
  Fondation par elle-même ; Cloud Build l'encapsule avec un point d'entrée
  cloud qui assemble `CODER_PG_CONNECTION_URL` et `CODER_ACCESS_URL` au démarrage du
  conteneur.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur le loopback.** GKE
  injecte `DB_HOST = 127.0.0.1` ; le point d'entrée construit un DSN
  `postgres://` avec `sslmode=disable` (le proxy termine déjà la connexion
  TLS) et encode le mot de passe en URL.
- **Pas de NFS, pas de Redis, et pas de secret d'application.** Tout l'état
  de Coder — espaces de travail, modèles, utilisateurs, sessions, file
  d'attente de build et clés de signature auto-générées — réside dans
  PostgreSQL. `enable_nfs` et `enable_redis` par défaut à
  `false` et ne sont pas nécessaires pour un fonctionnement normal.
- **Pas de job de migration séparé.** Coder exécute ses propres migrations
  de schéma au démarrage ; le seul job d'initialisation est `db-init`,
  qui crée la base de données et le rôle vides.
- **Un réplica par défaut.** `min_instance_count = 1`, `max_instance_count = 1`. Le mode
  multi-réplica de Coder est sa fonctionnalité de haute disponibilité, qui
  nécessite une licence premium : sans elle, des réplicas supplémentaires
  servent l'API et l'interface utilisateur mais ne rejoignent jamais le maillage
  de relais de Coder, de sorte que les sessions de terminal et SSH de l'espace
  de travail dépendraient du réplica choisi par l'équilibreur de charge.
- **`session_affinity = ClientIP`** maintient le trafic de terminal/IDE riche en WebSocket
  d'un navigateur épinglé au même pod pendant toute la session.
- **Ingress et une IP statique sont provisionnés prêts à l'emploi**
  (`enable_custom_domain = true`, `reserve_static_ip = true`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de
noms et les autres identifiants sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. GKE Autopilot — la charge de travail du plan de contrôle Coder {#a-gke-autopilot--the-coder-control-plane-workload}

Les pods Coder s'exécutent sur Autopilot, facturés pour le CPU/la mémoire
réellement demandés par les pods. Comme le plan de contrôle est sans état, la
charge de travail s'exécute comme un `Deployment` standard avec une
stratégie `RollingUpdate` (pas de contrainte `Recreate` basée sur NFS).
L'exécution de plus d'un réplica nécessite le mode haute disponibilité sous
licence de Coder (voir ci-dessus).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la
  charge de travail Coder pour les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get hpa -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, la mise à l'échelle
HPA et le type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Coder stocke tout — espaces de travail, modèles, utilisateurs, journaux
d'audit, sessions et ses propres clés de signature — dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Les pods l'atteignent via le sidecar **Cloud
SQL Auth Proxy** sur `127.0.0.1:5432` ; aucune IP publique n'est exposée. Lors
du premier déploiement, le job `db-init` crée la base de données et le
rôle de l'application ; le moteur de migration de Coder crée ensuite le
schéma au démarrage du serveur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs).
Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement par `Coder_Common` et le compte de service de la charge de
travail se voit accorder l'accès. Il n'est pas actuellement monté dans le
conteneur Coder par défaut — Coder ne nécessite pas de système de fichiers
partagé, car l'état réside dans PostgreSQL.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse
(`gcs_volumes`) si vous avez besoin d'en attacher un pour un workflow
personnalisé.

### D. Secret Manager {#d-secret-manager}

Coder est inhabituel parmi les applications avec état en ce qu'il ne crée
**aucun secret d'application propre** — il auto-génère ses clés de signature
et les persiste dans la base de données PostgreSQL `coder` au premier
démarrage. La seule information d'identification que Secret Manager détient
est le mot de passe de la base de données géré par la Fondation. Sur GKE,
les secrets sont projetés dans les pods via le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~coder"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store
CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via un Ingress Kubernetes
soutenu par une IP statique globale (`reserve_static_ip = true` afin que l'adresse
survive aux redéploiements). Un domaine personnalisé avec un certificat géré
par Google peut être activé via `application_domains`. Étant donné que Coder
proxy des connexions WebSocket de longue durée pour le terminal web et le
trafic d'applications d'espace de travail, maintenez `session_affinity = ClientIP` afin que
les requêtes d'un client atterrissent sur le même pod pendant la durée d'une
session.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC →
  Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Le stdout/stderr des pods est acheminé vers Cloud Logging ; les métriques GKE
et Cloud SQL sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte optionnelles sont disponibles
(`uptime_check_config` est désactivé par défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Coder {#3-coder-application-behaviour}

- **Configuration de la base de données au premier déploiement, pas de job de
  migration séparé.** Le job `db-init` exécute `db-init.sh` en
  utilisant `postgres:15-alpine`. Il attend le sidecar Cloud SQL Auth Proxy, crée de
  manière idempotente le rôle et la base de données `coder`, accorde
  les privilèges et réaffecte le propriétaire du schéma `public`, puis
  signale au sidecar proxy de s'arrêter (`--quitquitquit`) afin que le pod du
  Job se termine. Coder exécute ensuite ses propres migrations de schéma au
  démarrage du serveur — il n'y a pas de job de migration dédié, contrairement
  aux applications avec une étape `db-migrate` séparée.
- **Aucun compte administrateur n'est pré-provisionné.** Le premier
  utilisateur à atteindre l'interface utilisateur web après un démarrage
  réussi complète la configuration interactive de première exécution de Coder
  (création du compte administrateur initial). Il n'y a pas de secret de mot
  de passe administrateur auto-généré à récupérer.
- **Assemblage du DSN au démarrage du conteneur, non intégré à l'image.**
  `entrypoint.sh` (dans `Coder_Common/scripts/`) construit `CODER_PG_CONNECTION_URL` à
  partir des valeurs `DB_*` injectées par la Fondation, car le pilote
  Go de Coder attend une URL `postgres://` et ne peut pas analyser la forme
  par mot-clé libpq. Sur GKE, `DB_HOST=127.0.0.1` (le sidecar Auth Proxy) se
  résout en `sslmode=disable` ; le mot de passe est encodé en pourcentage
  RFC-3986 afin que les caractères spéciaux ne cassent pas l'URL.
  `CODER_ACCESS_URL` par défaut à `GKE_SERVICE_URL` injecté par la
  Fondation.
- **Le trafic riche en WebSocket nécessite un routage persistant.** Le
  terminal web, le proxy d'application d'espace de travail et le
  `coder ssh`/port-forward de la CLI utilisent tous des connexions
  WebSocket de longue durée via le plan de contrôle. Maintenez
  `session_affinity = ClientIP` (la valeur par défaut) afin que la connexion d'un client
  persiste sur un seul pod ; `max_instance_count` reste à 1 à moins que vous ne
  déteniez une licence Coder avec haute disponibilité.
- **Chemins des sondes de santé.** Les sondes de démarrage et de vivacité
  ciblent toutes deux **HTTP `GET /health`** avec un délai initial de 60
  secondes ; la sonde de démarrage permet jusqu'à 30 échecs à une période de
  15 secondes pour absorber la migration de schéma de Coder au premier
  démarrage. La sonde de disponibilité fournie par Common (utilisée par le
  câblage `additional_services`/readiness de la Fondation) cible
  `GET /healthz` séparément.
- **La télémétrie est désactivée par défaut** (`CODER_TELEMETRY_ENABLE = "false"`), et
  `CODER_VERBOSE = "false"`.
- **Plan de contrôle uniquement — les espaces de travail nécessitent un
  provisionneur + une cible.** Ce module déploie `coder server` ;
  l'exécution d'espaces de travail réels nécessite en outre la
  configuration d'un provisionneur et d'une cible de calcul (par exemple un
  autre cluster/espace de noms Kubernetes, ou des modèles de VM cloud) via le
  système de modèles de Coder après la première connexion.
- **Vérifier le déploiement :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep CODER_
  curl -s https://<service-url>/healthz
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Coder sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `coder` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de Coder ; `latest` correspond à un tag épinglé (`v2.24.1`) via l'ARG de build `CODER_VERSION` spécifique à l'application afin qu'il ne se résolve jamais contre un `ghcr.io/coder/coder:latest` inexistant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Requis — l'image amont ne peut pas être déployée pré-construite ; Cloud Build l'encapsule avec le point d'entrée d'assemblage DSN. |
| `container_port` | `3000` | Port de liaison `CODER_HTTP_ADDRESS` de Coder. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | 2 vCPU / 4 GiB par défaut pour le plan de contrôle. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | Limites de réplicas. Plus d'un réplica nécessite le mode haute disponibilité sous licence de Coder. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE ; une garde au moment du plan le rejette lorsque `database_type = "NONE"`. |
| `enable_image_mirroring` | `true` | Toujours activé pour Coder — l'image de base provenant de GHCR est mise en miroir dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur/API de Coder. |
| `workload_type` | `null` → `Deployment` | Déploiement (sans état, `RollingUpdate` standard). |
| `session_affinity` | `ClientIP` | Routage persistant afin que la session WebSocket d'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non requis — tout l'état est dans PostgreSQL. Si activé, `nfs_mount_path` doit être un répertoire réel, jamais un sous-chemin de `/opt/coder` (le binaire `coder`, un fichier). |
| `nfs_mount_path` | `/home/coder/data` | Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — les sessions et la file d'attente de build résident dans PostgreSQL, contrairement aux applications qui nécessitent un cache/une file d'attente externe. |
| `redis_host` | `""` | Pertinent uniquement si `enable_redis = true` ; une garde au moment du plan exige soit `redis_host` soit `enable_nfs = true`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Coder nécessite PostgreSQL 13+ ; MySQL est rejeté au moment du plan (`validation.tf`). |
| `application_database_name` | `coder` | Nom de la base de données. Immuable après le premier déploiement — le renommage recrée la base de données et orpheline tout l'état de Coder. |
| `application_database_user` | `coder` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Un Ingress Kubernetes est provisionné prêt à l'emploi. |
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).
Note : `elasticsearch_url`, `elasticsearch_username` et `elasticsearch_password_secret` sont déclarés dans
`variables.tf` pour la parité du catalogue mais ne sont **pas transmis** à
l'appel de la Fondation dans `main.tf` — Coder n'a pas
d'intégration Elasticsearch dans ce module, donc les définir n'a aucun effet.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Coder. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un nombre d'instances
> hors limites, IAP activé sans identifiants OAuth, `quota_memory_*` donné
> comme des entiers bruts. Coder_GKE ajoute en outre ses propres gardes dans
> `validation.tf` (`database_type` PostgreSQL uniquement, la
> précondition hôte/NFS Redis, le volume Cloud SQL vs le conflit
> `database_type = "NONE"`). Une configuration invalide fait échouer le **plan** avec
> une erreur claire et nommée avant la création de toute ressource, de sorte
> que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au
> moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critique | Tout moteur non-PostgreSQL est rejeté au moment du plan ; en forcer un contourne la garde et casse chaque requête émise par Coder. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les espaces de travail, modèles, utilisateurs et clés de signature auto-générées. |
| `container_image_source` | `custom` | Critique | Passer à `prebuilt` pointe GKE vers l'image brute `ghcr.io/coder/coder`, qui ne peut pas assembler `CODER_PG_CONNECTION_URL` à partir des variables de base de données de la Fondation et ne démarre pas. |
| `enable_cloudsql_volume` | `true` | Critique | Requis pour la connectivité de la base de données sur GKE ; une garde au moment du plan le bloque également lorsque `database_type = "NONE"` pour éviter un sidecar proxy sans rien à connecter. |
| `nfs_mount_path` (si `enable_nfs=true`) | Un répertoire réel, par exemple `/home/coder/data` | Critique | Monter sur `/opt/coder` — le binaire `coder` lui-même — masque l'exécutable et le conteneur ne démarre pas. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, une session de terminal/IDE WebSocket en cours peut être acheminée vers un pod différent en cours de session et être interrompue. |
| `enable_redis` | `false` | Moyen | Non nécessaire — l'activer sans `redis_host` défini ou `enable_nfs=true` échoue à la validation au moment du plan ; même correctement configuré, cela ajoute une dépendance inutilisée puisque Coder conserve tout l'état dans PostgreSQL. |
| `max_instance_count` | `1` | Élevé | Coder multi-réplica est une fonctionnalité de haute disponibilité sous licence premium ; les réplicas supplémentaires sans licence ne rejoignent jamais le maillage de relais, de sorte que les connexions d'espace de travail se rompent selon le réplica qui les sert. |
| `quota_memory_requests` / `_limits` | Unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui rompt le DNS, `CODER_ACCESS_URL` et toute redirection OAuth/OIDC enregistrée. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité de l'historique des espaces de travail/modèles. |
| `elasticsearch_url` / `elasticsearch_username` / `elasticsearch_password_secret` | Laisser vide | Faible | Inerte dans ce module (non transmis à l'appel de la Fondation) — les définir n'a aucun effet et n'active pas l'intégration de la recherche. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Coder
partagée avec la variante Cloud Run est décrite dans
**[Coder_Common](Coder_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Coder sur GKE Autopilot](../labs/Coder_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Coder sur Google Cloud Run](Coder_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Coder Common — Configuration d'application partagée](Coder_Common.md) — la configuration partagée par les deux cibles de déploiement.
