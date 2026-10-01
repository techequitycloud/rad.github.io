---
title: "Docmost sur Google Cloud Run"
description: "Référence de configuration pour déployer Docmost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Docmost_CloudRun.md @ 3055034 sha256:51df350c1000 -->

# Docmost sur Google Cloud Run {#docmost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docmost_CloudRun.png" alt="Docmost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Docmost est une plateforme open source de wiki et de documentation collaborative en temps réel
(une alternative à Confluence/Notion) construite sur NestJS. Ce module déploie Docmost sur
**Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Docmost et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Docmost s'exécute comme un conteneur Node.js (NestJS) sur Cloud Run v2. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service NestJS sur le port 3000, 1 vCPU / 1 GiB par défaut, autoscaling serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Docmost ne prend en charge ni MySQL ni d'autres moteurs |
| Cache et collaboration | Redis | **Obligatoire** pour l'édition en temps réel et les files d'attente en arrière-plan ; activé par défaut |
| Stockage de fichiers | Filestore / NFS | Pièces jointes écrites sur le volume adossé à NFS dans `/app/data/storage` |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement (inutilisé par le pilote `local` par défaut) |
| Secrets | Secret Manager | `APP_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la couche
  applicative partagée ; sélectionner un autre moteur empêche le démarrage.
- **Redis est obligatoire et activé par défaut.** Docmost utilise Redis pour l'édition
  collaborative en temps réel et les files d'attente des jobs en arrière-plan. `enable_redis = true` est la
  valeur par défaut ; laisser `redis_host` vide place Redis sur la VM du serveur NFS.
- **NFS est activé par défaut** (`enable_nfs = true`, `nfs_mount_path = /app/data/storage`).
  Le pilote de stockage `local` de Docmost y écrit les pièces jointes téléversées afin qu'elles survivent
  aux redémarrages et soient partagées entre les instances.
- **`APP_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il signe
  et chiffre les sessions et les données sensibles, et ne doit jamais faire l'objet d'une rotation après le premier démarrage
  sans fenêtre de maintenance — sa rotation déconnecte tout le monde et rend irrécupérables les données
  chiffrées avec l'ancienne valeur.
- **La base de données est jointe via l'IP privée, et non via le socket.** Le pilote
  `postgres.js` de Docmost ne peut pas utiliser le chemin du socket Unix Cloud SQL (ses deux-points perturbent l'analyse
  de l'URL), de sorte que le point d'entrée se connecte à l'**IP privée de Cloud SQL en TCP avec
  `sslmode=require`**. `enable_cloudsql_volume = true` monte néanmoins le socket pour le
  job `db-init`.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max_instance_count = 1`).
  Les démarrages à froid ajoutent quelques secondes de latence après une période d'inactivité ; définissez `min_instance_count = 1` pour
  garder le point de terminaison de collaboration actif.
- **`APP_URL` est injectée avec l'URL prévue du service** (via `service_url_env_var_name = "APP_URL"`)
  et sert à construire les liens absolus et le point de terminaison WebSocket de collaboration de l'éditeur.
- **La configuration initiale se fait via l'interface.** Docmost n'a pas d'identifiants par défaut — le premier
  visiteur crée l'espace de travail initial et le compte administrateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Docmost {#a-cloud-run--the-docmost-service}

Docmost s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre le
nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les
  métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution
et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Docmost stocke toutes les données applicatives (espaces, pages, commentaires, utilisateurs, autorisations) dans une
instance gérée Cloud SQL for PostgreSQL 15. Sur Cloud Run, le service en cours d'exécution se connecte
à l'**IP privée de Cloud SQL en TCP avec SSL** (le pilote `postgres.js` ne peut pas utiliser
le chemin du socket de l'Auth Proxy) ; le job `db-init` se connecte via le socket monté. Lors du
premier déploiement, ce job crée la base de données applicative et l'utilisateur ; Docmost applique ensuite
automatiquement ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs).
Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation
des mots de passe.

### C. Redis (collaboration en temps réel et files d'attente) {#c-redis-real-time-collaboration--queues}

Redis est **activé par défaut** et est obligatoire pour l'éditeur collaboratif en temps réel de Docmost
et le traitement des jobs en arrière-plan. Lorsque `redis_host` est laissé vide et que `enable_nfs`
vaut true, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis ; définissez `redis_host`
(et éventuellement `redis_auth`) pour pointer plutôt vers une instance Redis gérée ou externe.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm the assembled REDIS_URL is present in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Cloud Storage et stockage de fichiers NFS {#d-cloud-storage--nfs-file-storage}

Docmost écrit les pièces jointes téléversées via son pilote de stockage `local` dans
`/app/data/storage`, qui est adossé au volume **NFS** afin que les fichiers soient persistants et
partagés entre les instances. Un bucket de données **Cloud Storage** dédié est également provisionné
automatiquement (disponible si vous faites passer Docmost à un pilote de stockage d'objets).

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour NFS, GCS Fuse et les options CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`APP_SECRET` (utilisé pour signer et chiffrer les sessions et les données sensibles). Le mot de passe
de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docmost"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings = "all"`),
ce qui permet l'accès public nécessaire pour partager les pages du wiki et atteindre le point de terminaison
de collaboration. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers Cloud
Monitoring, avec des tests de disponibilité (uptime checks) et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Docmost {#3-docmost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` à l'aide de
  `postgres:15-alpine`. Il se connecte via le socket du Cloud SQL Auth Proxy et
  crée de manière idempotente la base de données applicative et l'utilisateur, puis accorde les privilèges. Le
  job peut être réexécuté sans risque.
- **Les migrations s'exécutent automatiquement au démarrage.** Docmost exécute ses propres migrations de schéma à
  chaque démarrage via sa commande par défaut `pnpm start`, de sorte que la mise à niveau de la version de l'application
  applique les changements de schéma sans étape de migration distincte.
- **`APP_SECRET` est immuable après le premier démarrage.** Il est généré une seule fois et écrit dans
  Secret Manager. Sa rotation invalide toutes les sessions existantes et rend irrécupérables les données
  chiffrées avec l'ancienne valeur — ne procédez à une rotation que pendant une fenêtre de maintenance
  planifiée.
- **`APP_URL` doit correspondre à l'URL réelle du service.** Elle est injectée avec l'URL `run.app`
  prévue et sert aux liens absolus et au WebSocket de collaboration. Si vous placez
  Docmost derrière un domaine personnalisé, définissez `APP_URL` (via `environment_variables`) sur cette
  URL externe. Inspectez la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health` — le point de terminaison public
  de Docmost qui renvoie 200. Prévoyez environ 2 minutes au premier démarrage (délai initial de 60 secondes plus la fenêtre
  de nouvelles tentatives) pendant l'exécution des migrations.
- **Création du compte au premier lancement.** Docmost est livré sans identifiants par défaut. Accédez à
  l'URL du service et remplissez le formulaire de configuration pour créer le premier espace de travail et l'utilisateur
  administrateur. Faites-le rapidement après le déploiement afin que personne d'autre ne puisse s'approprier l'espace de travail.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Docmost ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails bénéficiant de l'accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docmost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Docmost` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Docmost (associé à l'ARG de build `DOCMOST_VERSION`) ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `false` | Facturation à la requête ; le CPU n'est facturé que pendant le traitement des requêtes. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour garder le point de terminaison de collaboration actif. |
| `max_instance_count` | `1` | À augmenter uniquement si Redis est activé (ce qui est le cas par défaut). |
| `container_port` | `3000` | Docmost écoute sur le port 3000. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Monte le socket du Cloud SQL Auth Proxy (utilisé par `db-init`). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise l'accès public aux pages partagées et au point de terminaison de collaboration. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'acheminer que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger une connexion Google devant Docmost. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales (`NODE_ENV`, `STORAGE_DRIVER`, `APP_URL`) sont définies automatiquement — n'y définissez pas `APP_SECRET`, `DATABASE_URL` ni `REDIS_URL`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |
| `service_url_env_var_name` | `APP_URL` | Injecte l'URL prévue du service sous le nom `APP_URL`. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS définis dans `storage_buckets`. |
| `enable_nfs` | `true` | NFS est **activé** par défaut — il sert de support au chemin des pièces jointes `/app/data/storage`. |
| `nfs_mount_path` | `/app/data/storage` | Chemin de montage correspondant au pilote de stockage local de Docmost. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires en plus du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé — Docmost exige PostgreSQL 15. |
| `db_name` | `docmost` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `docmost` | Utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Rotation du mot de passe de la base de données. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 60s delay | Sonde de démarrage. Prévoyez environ 2 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` 60s delay | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut (lorsque le point de terminaison est public). |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — Docmost utilise Redis pour l'édition en temps réel et les files d'attente. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(set)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_SECRET` (généré automatiquement) | Ne jamais en faire la rotation après le premier démarrage | Critical | Sa rotation invalide toutes les sessions et rend irrécupérables les données chiffrées avec l'ancienne valeur. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critical | Docmost exige PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_redis` | `true` | Critical | L'éditeur en temps réel et les files d'attente de jobs de Docmost ont besoin de Redis ; le désactiver empêche l'application de fonctionner correctement. |
| `enable_nfs` | `true` | High | Sans NFS, les pièces jointes téléversées atterrissent sur un disque éphémère et sont perdues au redémarrage / non partagées entre les instances. |
| `APP_URL` | URL réelle du service / du domaine personnalisé | High | Une URL erronée casse les liens absolus et le point de terminaison WebSocket de collaboration. |
| `max_instance_count` | À augmenter uniquement avec Redis | High | Plusieurs instances sans coordination via un Redis partagé dégradent l'édition collaborative. |
| `ingress_settings` | `all` | High | `internal` bloque le partage externe et le point de terminaison public de collaboration. |
| `enable_iap` | uniquement pour les wikis privés | Medium | IAP bloque tout accès non authentifié, y compris les consultations anonymes de pages si vous les utilisez. |
| `memory_limit` | `1Gi` ou plus | Medium | Des limites très faibles exposent à des arrêts OOM sous une charge d'édition ou de téléversement concurrente. |
| `min_instance_count` | `1` pour les usages sensibles à la latence | Medium | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid sur la première requête après une période d'inactivité. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Docmost, partagée
avec la variante GKE, est décrite dans **[Docmost_Common](Docmost_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Docmost sur Cloud Run](../labs/Docmost_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docmost sur GKE Autopilot](Docmost_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Docmost Common — Configuration applicative partagée](Docmost_Common.md) — la configuration partagée par les deux cibles de déploiement.
