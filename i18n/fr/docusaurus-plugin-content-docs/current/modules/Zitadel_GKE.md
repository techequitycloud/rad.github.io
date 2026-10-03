---
title: "Zitadel sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Zitadel sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Zitadel_GKE.md @ 15fd4c7 sha256:0e09fe6df3e9 -->

# Zitadel sur GKE Autopilot {#zitadel-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_GKE.png" alt="Zitadel sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel est une plateforme open source de gestion des identités et des accès (IAM)
native du cloud, offrant OpenID Connect, OAuth 2.0, SAML et la gestion des
utilisateurs/organisations. Ce module déploie Zitadel sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Zitadel et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Zitadel s'exécute comme une seule charge de travail web Go. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Zitadel ne prend en charge que PostgreSQL ; MySQL est rejeté au moment de la planification |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (utilisation par l'opérateur ; l'état principal réside dans Postgres) |
| Cache et file d'attente | Aucun | Zitadel stocke tout l'état dans PostgreSQL — pas de Redis, pas de file d'attente |
| Secrets | Secret Manager | `ZITADEL_MASTERKEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec affinité `ClientIP` ; domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = POSTGRES_15` par défaut ; une
  validation au moment de la planification rejette MySQL et tout moteur non-Postgres.
  PostgreSQL 13/14 sont également acceptés.
- **`ZITADEL_MASTERKEY` est généré automatiquement et immuable.** Il fait
  exactement 32 octets et chiffre toutes les données sensibles au repos. **Ne le
  faites jamais pivoter après le premier démarrage** — cela rendrait les données
  précédemment chiffrées (secrets client, matériel de clé) illisibles.
- **Zitadel exécute sa propre configuration + migrations.** Le conteneur
  démarre avec `zitadel start-from-init`, qui crée le schéma et applique les
  migrations de manière idempotente au premier démarrage — il n'y a pas de job de
  migration séparé.
- **Un administrateur de première instance est créé au premier démarrage.**
  L'organisation `ZITADEL` et l'administrateur humain `zitadel-admin`
  sont initialisés avec un mot de passe généré par Secret Manager
  (`PASSWORDCHANGEREQUIRED = false`), afin que vous puissiez vous connecter immédiatement.
- **HTTP/2 avec TLS terminé en amont.** `ZITADEL_EXTERNALSECURE = true`, `ZITADEL_EXTERNALPORT = 443`,
  `ZITADEL_TLS_ENABLED = false`. Zitadel sert HTTP/2 en clair sur 8080 et fait confiance
  au LoadBalancer GKE pour terminer TLS sur `:443`. Définissez
  `container_protocol = "h2c"` si vous avez besoin d'HTTP/2 de bout en bout pour les
  clients de l'API gRPC.
- **`ZITADEL_EXTERNALDOMAIN` doit être défini pour l'accès externe.** Sur GKE, le
  point d'entrée le dérive de l'URL de service injectée, qui est l'adresse
  intra-cluster ; derrière une IP externe ou un domaine personnalisé, vous devez
  remplacer `ZITADEL_EXTERNALDOMAIN` par l'hôte public (voir le tableau des
  pièges) ou l'émetteur OIDC et les redirections de la Console échouent.
- **L'affinité de session est `ClientIP`.** Les requêtes du même client
  restent sur le même pod — utile pour le flux de session de l'interface
  utilisateur de la Console.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la
  mise à l'échelle à zéro) avec `max_instance_count = 5` ; une IP externe statique
  est réservée par défaut afin que l'adresse survive aux redéploiements.
- **NFS est désactivé par défaut.** Zitadel conserve tout l'état dans
  PostgreSQL et n'écrit jamais sur le montage (`enable_nfs = false`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.
L'espace de noms et les autres identifiants sont indiqués dans les [Sorties](#5-outputs)
du déploiement.

### A. GKE Autopilot — la charge de travail Zitadel {#a-gke-autopilot--the-zitadel-workload}

Les pods Zitadel sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre le nombre minimum et maximum de réplicas. Un sidecar Cloud
SQL Auth Proxy s'exécute à côté du conteneur.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Zitadel pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel | grep cloud-entrypoint
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zitadel stocke toutes les données d'application (organisations, utilisateurs,
projets, applications, sessions, clés) dans une instance gérée Cloud SQL pour
PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1` ; aucune IP publique n'est exposée. Lors du
premier déploiement, un job d'initialisation crée la base de données
d'application et un rôle avec `CREATEDB`/`CREATEROLE` ; Zitadel
crée ensuite son propre schéma via `start-from-init`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement (prévention de
l'accès public appliquée), et le compte de service de la charge de travail est
autorisé à y accéder. Zitadel conserve son état principal dans PostgreSQL, de
sorte que le bucket est disponible pour l'utilisation par l'opérateur. Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`ZITADEL_MASTERKEY` (chiffre toutes les données au repos) et le mot de passe
administrateur initial (initialise l'utilisateur humain de première instance
au démarrage). Ils sont livrés au pod via le pilote CSI Secret Store. Le mot
de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store
CSI, et [Zitadel_Common](Zitadel_Common.md) pour l'importance de la clé
maîtresse. Notez que le CRD GKE SecretSync rejette `__` dans les
clés synchronisées — les clés secrètes de Zitadel (`ZITADEL_MASTERKEY`,
`ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD`) utilisent des underscores simples et ne sont pas affectées.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing avec une adresse statique réservée. Un domaine personnalisé avec un
certificat géré par Google peut être activé. Étant donné que Zitadel sert gRPC
+ REST sur HTTP/2, définissez `container_protocol = "h2c"` pour HTTP/2 de bout en bout
lorsque cela est nécessaire.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties standard/erreur des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte facultatifs sont disponibles. Les
lignes de journal `[cloud-entrypoint]` affichent le mode SSL de la base de
données résolu et le domaine externe.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Zitadel {#3-zitadel-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`.
  Il se connecte via le sidecar Cloud SQL Auth Proxy et crée de manière
  idempotente la base de données d'application et un rôle avec `LOGIN CREATEDB
  CREATEROLE`,
  accorde des privilèges sur la base de données et le schéma `public`,
  puis signale au proxy de s'arrêter afin que le pod du job se termine. Le job
  peut être réexécuté en toute sécurité et ne crée **pas** le schéma de Zitadel
  — Zitadel le fait lui-même.
- **Configuration + migrations au démarrage.** Le conteneur exécute
  `zitadel start-from-init`, qui crée le schéma et applique les migrations de
  manière idempotente à chaque démarrage. La mise à niveau de la version de
  l'application applique les modifications de schéma sans étape de migration
  séparée.
- **`ZITADEL_MASTERKEY` est immuable après le premier démarrage.** Il est
  généré une fois (exactement 32 octets) et écrit dans Secret Manager. Le
  modifier rend toutes les données précédemment chiffrées illisibles. Ne le
  touchez que lors d'une migration planifiée et comprise.
- **Administrateur de première exécution.** Connectez-vous avec le nom
  d'utilisateur `zitadel-admin` (par défaut) et le mot de passe de Secret
  Manager :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Créez ensuite un véritable administrateur, désactivez ou restreignez le
  compte initial, et configurez vos organisations, projets et applications
  OIDC/SAML dans la Console.
- **Le domaine externe doit correspondre à l'hôte du navigateur.** L'émetteur
  OIDC et les URI de redirection de la Console sont construits à partir de
  `ZITADEL_EXTERNALDOMAIN`. Sur GKE, le point d'entrée le dérive de l'URL de
  service injectée (intra-cluster), donc pour un accès externe, vous **devez**
  définir `ZITADEL_EXTERNALDOMAIN` (via `environment_variables`) sur l'hôte de l'IP du
  LoadBalancer ou le domaine personnalisé — sinon les connexions et l'échange
  de jetons échouent. Corrigez un déploiement en cours si l'IP a été attribuée
  après le déploiement :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" \
    ZITADEL_EXTERNALDOMAIN=zitadel.example.com
  ```
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/debug/healthz` — un point de terminaison `200` non
  authentifié. Prévoyez environ 7 à 8 minutes au premier démarrage pour la
  configuration + les migrations.
- **Inspecter la configuration/les jobs en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -c zitadel -- env | grep ZITADEL_
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Zitadel sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zitadel` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Zitadel` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image Zitadel ; mappé à un tag épinglé (`v2.71.0`) lorsque `latest`. Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Zitadel est une construction personnalisée fine À PARTIR de l'image ghcr — laissez comme `custom`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/mémoire par pod. |
| `container_port` | `8080` | Zitadel sert gRPC + REST sur HTTP/2 sur 8080. |
| `container_protocol` | `http1` | Définissez `h2c` pour HTTP/2 de bout en bout vers les clients de l'API gRPC. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE maintient ≥ 1 (pas de mise à l'échelle à zéro). |
| `max_instance_count` | `5` | Réplicas maximum ; sûr à augmenter — tout l'état est dans PostgreSQL. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (gardez `true` sur GKE). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale de la requête. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ZITADEL_*` supplémentaires — définissez `ZITADEL_EXTERNALDOMAIN` ici pour l'accès externe. Les valeurs principales de la base de données/TLS/clé maîtresse sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager (évitez `__` dans les clés). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation. **Ne pas activer la rotation de la clé maîtresse.** |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LoadBalancer externe pour la Console et les points de terminaison OIDC. |
| `workload_type` | `null` → Déploiement | Déploiement sans état ; Zitadel conserve tout l'état dans PostgreSQL. |
| `session_affinity` | `ClientIP` | Routage persistant pour le flux de session de l'interface utilisateur de la Console. |
| `namespace_name` | `""` (généré automatiquement) | Espace de noms Kubernetes pour la charge de travail. |
| `termination_grace_period_seconds` | `60` | Secondes à attendre après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Créer des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Non nécessaire — Zitadel stocke tout l'état dans PostgreSQL, pas sur disque. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de démarrage. Prévoir ~7–8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/debug/healthz`, délai de 60s | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Zitadel n'a pas de tâches récurrentes planifiées par la plateforme. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires (aucun requis pour Zitadel). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut : Zitadel est entièrement basé sur PostgreSQL et n'écrit jamais sur le montage. |
| `nfs_mount_path` | `/opt/zitadel/storage` | Chemin de montage à l'intérieur du conteneur (non utilisé). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le(s) bucket(s) GCS déclaré(s). |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; étendez la liste pour des buckets supplémentaires. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

Zitadel n'utilise pas Redis (tout l'état est dans PostgreSQL). `enable_redis`
est désactivé par défaut (`false`) et doit le rester ; les
entrées `redis_*` sont inertes pour ce module.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement (13/14/15). MySQL est rejeté au moment de la planification. |
| `application_database_name` | `zitadel` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `zitadel` | Utilisateur de la base de données d'application (privilèges `CREATEDB`/`CREATEROLE` accordés). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde Cloud SQL automatisé (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez à 30–90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôte personnalisés + certificat géré (une passerelle avec une IP statique est provisionnée automatiquement). N'oubliez pas de définir `ZITADEL_EXTERNALDOMAIN` pour qu'il corresponde. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** L'activation d'IAP nécessite une authentification
> Google Identity pour **toutes** les requêtes entrantes, y compris les clients
> OIDC/machine et les points de terminaison de jetons. N'activez IAP que pour
> une console entièrement privée.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Zitadel. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Requis lorsque IAP est activé (sensible). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher une politique Cloud Armor (WAF) au backend Ingress. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend GKE Ingress. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Zitadel. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données d'application. |
| `database_user` | Utilisateur de la base de données d'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification — un
> `database_type` non-Postgres, `enable_cloudsql_volume` avec `database_type = NONE`, IAP
> sans identifiants OAuth, `min_instance_count > max_instance_count`, Redis activé sans hôte
> résolvable, un `redis_port`/`backup_retention_days` hors de portée, et
> `quota_memory_*` sans suffixe d'unité binaire. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs ci-dessous
> sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (généré automatiquement) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les données précédemment chiffrées (secrets client, matériel de clé) illisibles de manière permanente. |
| `database_type` | `POSTGRES_15` | Critique | Zitadel ne prend en charge que PostgreSQL ; MySQL/autre est rejeté au moment de la planification, et un mauvais moteur interrompt le démarrage. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans source de sauvegarde valide échoue le job d'importation. |
| `ZITADEL_EXTERNALDOMAIN` | Définir sur l'hôte externe | Critique | Sur GKE, il est par défaut l'URL intra-cluster ; pour un accès externe, vous devez le définir sur l'hôte IP du LoadBalancer ou le domaine personnalisé, sinon l'émetteur OIDC et les redirections de la Console échouent et chaque connexion échoue. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; sa désactivation avec une base de données configurée est bloquée par une protection au moment de la planification. |
| `min_instance_count` | `1` | Élevé | GKE nécessite min ≥ 1 ; la protection de validation rejette les valeurs invalides. Maintenir 1 permet à l'IdP d'être toujours accessible. |
| `enable_iap` | uniquement pour les consoles privées | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients OIDC/machine et les points de terminaison de jetons. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les sessions de l'interface utilisateur de la Console peuvent rebondir entre les pods en cours de flux. |
| `container_port` | `8080` | Élevé | Zitadel écoute sur 8080 ; un port non concordant empêche la charge de travail de devenir prête. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `application_version` | Épingler une version | Élevé | `latest` correspond à un tag épinglé aujourd'hui, mais l'épinglage explicite évite les migrations surprises lors du redéploiement. |
| `enable_nfs` | `false` (non utilisé) | Faible | Désactivé par défaut ; Zitadel ne stocke aucun état sur disque, donc l'activer ne fait que gaspiller un montage NFS. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité des données d'identité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Zitadel
partagée avec la variante Cloud Run est décrite dans
**[Zitadel_Common](Zitadel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Zitadel sur GKE Autopilot](../labs/Zitadel_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Zitadel sur Google Cloud Run](Zitadel_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zitadel Common — Configuration d'application partagée](Zitadel_Common.md) — la configuration partagée par les deux cibles de déploiement.
