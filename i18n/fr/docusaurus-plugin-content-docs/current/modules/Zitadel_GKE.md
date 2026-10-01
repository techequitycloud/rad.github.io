---
title: "Zitadel sur GKE Autopilot"
description: "Référence de configuration pour déployer Zitadel sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Zitadel_GKE.md @ 3055034 sha256:32bf7b5d07dd -->

# Zitadel sur GKE Autopilot {#zitadel-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Zitadel_GKE.png" alt="Zitadel sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Zitadel est une plateforme open source et cloud-native de gestion des identités et des accès (IAM)
qui fournit OpenID Connect, OAuth 2.0, SAML ainsi que la gestion des utilisateurs et des organisations. Ce
module déploie Zitadel sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud qu'utilise Zitadel et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, entrée (ingress), autoscaling, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Zitadel s'exécute comme une unique charge de travail web en Go. Le déploiement assemble un ensemble ciblé
de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Zitadel ne prend en charge que PostgreSQL ; MySQL est rejeté au moment du plan |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement (à l'usage de l'opérateur ; l'état principal réside dans Postgres) |
| Cache et file d'attente | Aucun | Zitadel stocke tout son état dans PostgreSQL — pas de Redis, pas de file d'attente |
| Secrets | Secret Manager | `ZITADEL_MASTERKEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec affinité `ClientIP` ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = POSTGRES_15` par défaut ; une garde de validation
  au moment du plan rejette MySQL et tout moteur autre que Postgres. PostgreSQL 13/14 sont également
  acceptés.
- **`ZITADEL_MASTERKEY` est généré automatiquement et immuable.** Il fait exactement 32
  octets et chiffre toutes les données sensibles au repos. **Ne le renouvelez jamais après le premier démarrage** —
  cela rendrait illisibles les données chiffrées auparavant (secrets client, éléments de clé).
- **Zitadel exécute lui-même sa configuration initiale et ses migrations.** Le conteneur démarre avec
  `zitadel start-from-init`, qui crée le schéma et applique les migrations de manière
  idempotente au premier démarrage — il n'y a pas de tâche de migration distincte.
- **Un administrateur de première instance est créé au premier démarrage.** L'organisation `ZITADEL` et l'administrateur
  humain `zitadel-admin` sont initialisés avec un mot de passe généré provenant de Secret Manager
  (`PASSWORDCHANGEREQUIRED = false`), ce qui vous permet de vous connecter immédiatement.
- **HTTP/2 avec TLS terminé en amont.** `ZITADEL_EXTERNALSECURE = true`,
  `ZITADEL_EXTERNALPORT = 443`, `ZITADEL_TLS_ENABLED = false`. Zitadel sert du HTTP/2 en clair
  sur 8080 et s'en remet au LoadBalancer GKE pour terminer TLS sur `:443`. Définissez
  `container_protocol = "h2c"` si vous avez besoin de HTTP/2 de bout en bout pour des clients d'API gRPC.
- **`ZITADEL_EXTERNALDOMAIN` doit être défini pour l'accès externe.** Sur GKE, le point d'entrée
  le déduit de l'URL de service injectée, qui est l'adresse interne au cluster ; derrière une
  IP externe ou un domaine personnalisé, vous devez remplacer `ZITADEL_EXTERNALDOMAIN` par l'hôte
  public (voir le tableau des pièges), faute de quoi l'émetteur OIDC et les redirections de la Console ne fonctionnent plus.
- **L'affinité de session est `ClientIP`.** Les requêtes d'un même client restent sur le même
  pod — utile pour le parcours de session de l'interface Console.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la mise à zéro) avec
  `max_instance_count = 5` ; une IP externe statique est réservée par défaut afin que l'adresse
  survive aux redéploiements.
- **NFS est activé par défaut mais inutilisé par l'application.** Zitadel conserve tout son état dans
  PostgreSQL ; vous pouvez définir `enable_nfs = false` sauf si une autre raison l'exige.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Zitadel {#a-gke-autopilot--the-zitadel-workload}

Les pods Zitadel sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods
demandent effectivement. Le Horizontal Pod Autoscaling dimensionne le déploiement entre les nombres minimal
et maximal de réplicas. Un sidecar Cloud SQL Auth Proxy s'exécute à côté du conteneur.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Zitadel pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel --tail=100
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c zitadel | grep cloud-entrypoint
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle et le type de charge de travail (Deployment
ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Zitadel stocke toutes les données applicatives (organisations, utilisateurs, projets, applications,
sessions, clés) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent
de manière privée via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ; aucune IP publique n'est
exposée. Lors du premier déploiement, un job d'initialisation crée la base de données applicative et un
rôle doté de `CREATEDB`/`CREATEROLE` ; Zitadel crée ensuite son propre schéma via
`start-from-init`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~zitadel"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous indiqués dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatiques et le renouvellement du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement (prévention de l'accès public
appliquée), et le compte de service de la charge de travail y reçoit l'accès. Zitadel conserve son état
principal dans PostgreSQL, si bien que le bucket est disponible pour l'usage de l'opérateur. Des buckets supplémentaires peuvent
être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : `ZITADEL_MASTERKEY`
(chiffre toutes les données au repos) et le mot de passe administrateur initial (initialise l'humain de la première instance
au démarrage). Ils sont fournis au pod via le pilote Secret Store CSI. Le
mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~zitadel"
  # Read the initial admin password to log in the first time:
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et le renouvellement, et
[Zitadel_Common](Zitadel_Common.md) pour le caractère critique de la masterkey. Notez que la
CRD SecretSync de GKE rejette `__` dans les clés synchronisées — les clés de secret de Zitadel
(`ZITADEL_MASTERKEY`, `ZITADEL_FIRSTINSTANCE_ORG_HUMAN_PASSWORD`) utilisent des tirets bas
simples et ne sont pas concernées.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe avec une
adresse statique réservée. Un domaine personnalisé avec un certificat géré par Google peut être
activé. Comme Zitadel sert gRPC + REST sur HTTP/2, définissez `container_protocol = "h2c"`
pour du HTTP/2 de bout en bout lorsque c'est nécessaire.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles. Les lignes de journal
`[cloud-entrypoint]` indiquent le mode SSL de la base de données et le domaine externe résolus.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Zitadel {#3-zitadel-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` avec
  `postgres:15-alpine`. Il se connecte via le sidecar Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données applicative et un rôle doté de `LOGIN CREATEDB
  CREATEROLE`, accorde les privilèges sur la base de données et le schéma `public`, puis signale au
  proxy de s'arrêter afin que le pod de la tâche se termine. La tâche peut être réexécutée sans risque et ne crée **pas**
  le schéma de Zitadel — Zitadel s'en charge lui-même.
- **Configuration initiale + migrations au démarrage.** Le conteneur exécute `zitadel start-from-init`, qui
  crée le schéma et applique les migrations de manière idempotente à chaque démarrage. La mise à niveau de la
  version de l'application applique les modifications de schéma sans étape de migration distincte.
- **`ZITADEL_MASTERKEY` est immuable après le premier démarrage.** Elle est générée une seule fois (exactement
  32 octets) et écrite dans Secret Manager. La modifier rend illisibles toutes les données
  chiffrées auparavant. N'y touchez que dans le cadre d'une migration planifiée et maîtrisée.
- **Administrateur du premier lancement.** Connectez-vous avec le nom d'utilisateur `zitadel-admin` (par défaut) et le mot de passe
  issu de Secret Manager :
  ```bash
  gcloud secrets versions access latest \
    --secret="secret-<resource_prefix>-zitadel-admin-password" --project "$PROJECT"
  ```
  Créez ensuite un véritable administrateur, désactivez ou restreignez le compte initial, puis configurez vos
  organisations, projets et applications OIDC/SAML dans la Console.
- **Le domaine externe doit correspondre à l'hôte du navigateur.** L'émetteur OIDC et les URI de redirection de la Console
  sont construits à partir de `ZITADEL_EXTERNALDOMAIN`. Sur GKE, le point d'entrée le déduit de l'URL de
  service injectée (interne au cluster) ; pour l'accès externe, vous **devez** donc définir
  `ZITADEL_EXTERNALDOMAIN` (via `environment_variables`) sur l'hôte de l'IP du LoadBalancer ou sur
  le domaine personnalisé — sinon les connexions et l'échange de jetons échouent. Corrigez un déploiement
  en cours d'exécution si l'IP a été attribuée après le déploiement :
  ```bash
  kubectl set env deploy/<service-name> -n "$NAMESPACE" \
    ZITADEL_EXTERNALDOMAIN=zitadel.example.com
  ```
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/debug/healthz` — un
  point de terminaison non authentifié qui renvoie `200`. Prévoyez environ 7 à 8 minutes au premier démarrage pour la configuration initiale + les migrations.
- **Inspecter la configuration en cours d'exécution / les tâches :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -c zitadel -- env | grep ZITADEL_
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Zitadel ou notables pour lui sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `zitadel` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Zitadel` | Nom lisible affiché dans la Console. |
| `application_version` | `latest` | Tag d'image Zitadel ; associé à un tag figé (`v2.71.0`) lorsqu'il vaut `latest`. Figez-le explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Zitadel est un build personnalisé léger FROM l'image ghcr — laissez `custom`. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | CPU/mémoire par pod. |
| `container_port` | `8080` | Zitadel sert gRPC + REST sur HTTP/2 sur le port 8080. |
| `container_protocol` | `http1` | Définissez `h2c` pour du HTTP/2 de bout en bout vers les clients d'API gRPC. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE en conserve ≥ 1 (pas de mise à zéro). |
| `max_instance_count` | `5` | Nombre maximal de réplicas ; peut être augmenté sans risque — tout l'état est dans PostgreSQL. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (laissez `true` sur GKE). |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ZITADEL_*` supplémentaires — définissez ici `ZITADEL_EXTERNALDOMAIN` pour l'accès externe. Les valeurs principales de base de données, TLS et masterkey sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager (évitez `__` dans les clés). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de renouvellement. **N'activez pas le renouvellement de la masterkey.** |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LoadBalancer externe pour la Console et les points de terminaison OIDC. |
| `workload_type` | `null` → Deployment | Deployment sans état ; Zitadel conserve tout son état dans PostgreSQL. |
| `session_affinity` | `ClientIP` | Routage persistant pour le parcours de session de l'interface Console. |
| `namespace_name` | `""` (généré automatiquement) | Espace de noms Kubernetes de la charge de travail. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Inutile — Zitadel stocke tout son état dans PostgreSQL, pas sur disque. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/debug/healthz`, délai de 60 s | Sonde de démarrage. Prévoyez environ 7 à 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/debug/healthz`, délai de 60 s | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée. |
| `cron_jobs` | `[]` | Non utilisé — Zitadel n'a aucune tâche récurrente planifiée par la plateforme. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires (aucun n'est requis pour Zitadel). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut mais **inutilisé** — Zitadel conserve tout son état dans PostgreSQL ; vous pouvez sans risque le définir sur `false`. |
| `nfs_mount_path` | `/opt/zitadel/storage` | Chemin de montage dans le conteneur (inutilisé). |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le ou les buckets GCS déclarés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Un bucket `data` est déclaré par défaut ; complétez la liste pour des buckets supplémentaires. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

Zitadel n'utilise pas Redis (tout l'état est dans PostgreSQL). `enable_redis` vaut
`false` par défaut et doit rester désactivé ; les entrées `redis_*` sont sans effet pour ce module.

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PostgreSQL uniquement (13/14/15). MySQL est rejeté au moment du plan. |
| `application_database_name` | `zitadel` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `zitadel` | Utilisateur de la base de données applicative (doté de `CREATEDB`/`CREATEROLE`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Renouvellement du mot de passe de la base de données sans interruption. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques Cloud SQL (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré (une Gateway avec une IP statique est provisionnée automatiquement). Pensez à définir `ZITADEL_EXTERNALDOMAIN` en conséquence. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP impose une authentification par identité Google pour **toutes** les
> requêtes entrantes, y compris les clients OIDC/machine et les points de terminaison de jetons. N'activez IAP que pour une
> console entièrement privée.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Zitadel. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

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
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Zitadel. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`) et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation au moment du plan héritée.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `database_type` autre que Postgres, `enable_cloudsql_volume` avec `database_type = NONE`, IAP sans identifiants OAuth, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, un `redis_port`/`backup_retention_days` hors plage et `quota_memory_*` sans suffixe d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ZITADEL_MASTERKEY` (généré automatiquement) | Ne jamais la renouveler après le premier démarrage | Critical | La renouveler rend définitivement illisibles toutes les données chiffrées auparavant (secrets client, éléments de clé). |
| `database_type` | `POSTGRES_15` | Critical | Zitadel ne prend en charge que PostgreSQL ; MySQL ou tout autre moteur est rejeté au moment du plan, et un mauvais moteur empêche le démarrage. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et le rôle et détruit toutes les données d'identité. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans source de sauvegarde valide fait échouer la tâche d'import. |
| `ZITADEL_EXTERNALDOMAIN` | Définir sur l'hôte externe | Critical | Sur GKE, il prend par défaut l'URL interne au cluster ; pour l'accès externe, vous devez le définir sur l'hôte de l'IP du LoadBalancer ou sur le domaine personnalisé, faute de quoi l'émetteur OIDC et les redirections de la Console ne fonctionnent plus et toutes les connexions échouent. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL ; le désactiver alors qu'une base de données est configurée est bloqué par une garde au moment du plan. |
| `min_instance_count` | `1` | High | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. Conserver 1 garantit que l'IdP reste toujours joignable. |
| `enable_iap` | uniquement pour les consoles privées | High | IAP bloque toutes les requêtes non authentifiées, y compris les clients OIDC/machine et les points de terminaison de jetons. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les sessions de l'interface Console peuvent basculer d'un pod à l'autre en cours de parcours. |
| `container_port` | `8080` | High | Zitadel écoute sur 8080 ; un port incohérent empêche la charge de travail de passer à l'état Ready. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers sans unité sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `application_version` | Figer une version | High | `latest` correspond aujourd'hui à un tag figé, mais le figer explicitement évite des migrations inattendues lors d'un redéploiement. |
| `enable_nfs` | `false` (inutilisé) | Low | Activé par défaut alors que Zitadel ne stocke aucun état sur disque ; le laisser activé gaspille un montage NFS. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour la rétention réglementaire des données d'identité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Zitadel et partagée avec la variante Cloud Run est décrite dans
**[Zitadel_Common](Zitadel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Zitadel sur GKE Autopilot](../labs/Zitadel_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Zitadel sur Google Cloud Run](Zitadel_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Zitadel Common — configuration applicative partagée](Zitadel_Common.md) — la configuration partagée par les deux cibles de déploiement.
