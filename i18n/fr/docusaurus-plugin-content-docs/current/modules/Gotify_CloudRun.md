---
title: "Gotify sur Google Cloud Run"
description: "Référence de configuration pour déployer Gotify sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gotify_CloudRun.md @ 3055034 sha256:e442636b82a9 -->

# Gotify sur Google Cloud Run {#gotify-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gotify_CloudRun.png" alt="Gotify sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gotify est un serveur open source (sous licence MIT) auto-hébergé permettant d'envoyer
et de recevoir des notifications push en temps réel. Les applications publient des
messages via une API REST simple et les clients les reçoivent instantanément via des
flux WebSocket. Ce module déploie Gotify sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise Gotify et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gotify s'exécute sous la forme d'un conteneur Go à binaire unique sur Cloud Run v2.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 MiB par défaut, CPU toujours alloué pour les flux WebSocket |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — ce module n'utilise jamais le SQLite intégré de Gotify |
| Secrets | Secret Manager | Mot de passe administrateur généré automatiquement (`GOTIFY_DEFAULTUSER_PASS`) ; mot de passe de la base de données |
| Build du conteneur | Cloud Build + Artifact Registry | Encapsule `ghcr.io/gotify/server` avec un point d'entrée de mappage de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est fixé par la
  couche applicative partagée ; le mode SQLite de Gotify n'est pas utilisé, aucun
  disque persistant n'est donc nécessaire.
- **Le conteneur écoute sur le port 80.** `container_port = 80` et le point d'entrée
  définit `GOTIFY_SERVER_PORT = 80`.
- **Le CPU est toujours alloué** (`cpu_always_allocated = true`) avec `min = max = 1`.
  Gotify maintient des flux WebSocket de longue durée et un bus de messages interne au
  processus ; le CPU ne doit donc pas être bridé entre les requêtes. Cela empêche la
  mise à l'échelle à zéro ; une instance à faible trafic peut passer
  `cpu_always_allocated = false`, en acceptant que la diffusion des flux soit suspendue
  pendant les périodes d'inactivité.
- **Une seule instance est la valeur par défaut sûre.** Le bus de messages de Gotify
  est interne au processus : un flux client ne reçoit que les messages remis à
  l'instance à laquelle il est connecté. Dépasser une instance sans couche de
  diffusion externe fait perdre des messages à certains abonnés.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret
  Manager, puis injecté sous la forme `GOTIFY_DEFAULTUSER_PASS`. L'administrateur
  initial (`admin`) n'est créé que lors de la première initialisation de la base de
  données.
- **Aucun stockage objet n'est provisionné** (`storage_buckets = []`,
  `enable_nfs = false`). Les messages, applications et jetons résident dans PostgreSQL.
- **L'image est construite sur mesure.** `container_image_source = "custom"` construit
  une image qui encapsule `ghcr.io/gotify/server` et mappe les variables `DB_*` de la
  plateforme vers la configuration `GOTIFY_DATABASE_*` (GORM) de Gotify ; `latest` est
  épinglé sur la base `2.9.1`.
- **L'entrée publique est la valeur par défaut.** `ingress_settings = "all"` afin que
  les applications émettrices et les clients récepteurs puissent atteindre l'API REST
  et le WebSocket.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Gotify {#a-cloud-run--the-gotify-service}

Gotify s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements progressifs sûrs. Comme le CPU est toujours alloué et qu'une instance
unique est maintenue, les flux WebSocket restent connectés entre deux envois de
messages.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gotify stocke toutes les données de l'application (messages, applications, clients,
utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y
connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune
IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation
crée la base de données et le rôle de l'application ; Gotify applique ensuite son
propre schéma par auto-migration GORM au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le mot de passe administrateur (`GOTIFY_DEFAULTUSER_PASS`) est généré automatiquement
et stocké dans Secret Manager. Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotify"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Build du conteneur et Artifact Registry {#d-container-build--artifact-registry}

L'image personnalisée encapsule `ghcr.io/gotify/server` avec un point d'entrée de
mappage de la base de données. Cloud Build la construit et la pousse vers Artifact
Registry ; `enable_image_mirroring = true` met en miroir l'image de base amont dans
Artifact Registry afin d'éviter les limites de débit des registres.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`, ce qui offre l'accès public
nécessaire aux applications émettrices et aux clients récepteurs. Un équilibreur de
charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec un test de
disponibilité facultatif sur `/health` (désactivé par défaut) et des règles d'alerte
facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gotify {#3-gotify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données et le rôle de l'application, puis accorde les privilèges. La tâche peut être
  relancée sans risque.
- **Schéma par auto-migration GORM.** Gotify crée et migre ses propres tables à chaque
  démarrage — il n'existe pas de tâche de migration distincte. La mise à niveau de la
  version de l'application applique automatiquement les modifications de schéma.
- **Le compte administrateur n'est initialisé qu'une fois.**
  `GOTIFY_DEFAULTUSER_NAME = admin` et le secret `GOTIFY_DEFAULTUSER_PASS` créent
  l'administrateur initial uniquement lors de la première initialisation de la base de
  données. Récupérez le mot de passe dans Secret Manager et modifiez-le après la
  première connexion. Modifier le secret par la suite ne réinitialise pas le mot de
  passe administrateur.
- **L'envoi et la réception sont authentifiés par jeton.** Après vous être connecté,
  créez une *application* (qui fournit un jeton d'application) pour envoyer des
  messages via `POST /message?token=<apptoken>`, et utilisez un jeton *client* pour
  vous abonner via le WebSocket à `/stream?token=<clienttoken>`. Vérifiez l'état de
  santé sans jeton :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --project "$PROJECT" --format='value(status.url)')/health"
  ```
- **Diffusion WebSocket sur une instance unique.** Le bus de messages étant interne au
  processus, conservez `max_instance_count = 1` sauf si vous ajoutez une couche de
  diffusion externe — sinon un message envoyé à une instance n'est pas remis aux
  clients connectés en flux à une autre.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` — le
  point de terminaison public qui renvoie `{"health":"green","database":"green"}` dès
  que PostgreSQL est joignable. La sonde de démarrage par défaut accorde environ
  5 minutes au premier démarrage.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gotify ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotify` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Gotify` | Nom lisible affiché dans la console. |
| `application_description` | `Gotify push notification server on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de l'image ; `latest` correspond à la base épinglée `2.9.1`. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image d'encapsulation qui mappe la base de données ; `prebuilt` déploie une URI d'image que vous configurez. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU convient à la plupart des instances. |
| `memory_limit` | `512Mi` | Mémoire par instance ; 512 MiB est le minimum en gen2. |
| `min_instance_count` | `1` | Conservez 1 pour que les flux WebSocket restent connectés. |
| `max_instance_count` | `1` | Conservez 1 — le bus de messages interne au processus ne diffuse pas entre les instances. |
| `cpu_always_allocated` | `true` | Requis pour les flux WebSocket ; ne passez à `false` que pour des instances à faible trafic. |
| `container_port` | `80` | Gotify écoute sur le port 80. |
| `execution_environment` | `gen2` | Environnement d'exécution de deuxième génération. |
| `timeout_seconds` | `300` | Durée maximale d'une requête ; augmentez-la pour les flux de longue durée. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Duplique `ghcr.io/gotify/server` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux applications émettrices et aux clients récepteurs d'atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. Bloque les appelants de l'API authentifiés uniquement par jeton, sauf s'ils présentent aussi une identité. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GOTIFY_*` supplémentaires. La connexion à la base de données et `GOTIFY_DEFAULTUSER_PASS` sont injectés automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS (nécessite Cloud Armor). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Gotify n'a besoin d'aucun stockage de fichiers. N'ajoutez des buckets que pour des besoins spécifiques. |
| `enable_nfs` | `false` | Désactivé par défaut ; ne l'activez que pour rendre persistant le stockage sur disque des images et plugins de Gotify. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Gotify utilise PostgreSQL géré. |
| `application_database_name` | `gotify` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gotify` | Rôle de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions PostgreSQL facultatives. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init`. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs facultatifs. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires aux côtés de Gotify. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 30 s, 30 échecs | Sonde de démarrage. Accorde environ 5 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30 s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/health` | Sondes au niveau d'App_CloudRun. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Gotify n'a pas besoin de Redis ; laissez désactivé sauf pour intégrer une instance externe. |
| `redis_host` | `""` | Point de terminaison Redis (utilisé uniquement lorsque `enable_redis = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (découvre automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `project_id` / `deployment_id` | ID du projet / suffixe du déploiement. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / rôle de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Gotify). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | État du CI/CD et dépôt connecté. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Dépasser 1 sans diffusion externe fait perdre des messages aux clients connectés en flux à d'autres instances (bus de messages interne au processus). |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et détruit tous les messages. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans sauvegarde valide fait échouer la tâche d'import. |
| `cpu_always_allocated` | `true` | Élevé | Avec une facturation à la requête, le CPU est bridé entre les requêtes et la diffusion des flux WebSocket se bloque pendant l'inactivité. |
| `container_port` | `80` | Élevé | Gotify écoute sur le port 80 ; un port différent fait échouer la sonde de démarrage et la révision ne sert jamais de trafic. |
| `memory_limit` | `512Mi` | Élevé | En dessous du minimum gen2 de 512 MiB, le plan est rejeté. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro interrompt tous les flux WebSocket actifs chaque fois que l'instance est récupérée. |
| `ingress_settings` | `all` | Élevé | La valeur `internal` empêche les émetteurs et récepteurs externes d'atteindre le service. |
| `enable_iap` | uniquement lorsque les appelants de l'API présentent une identité | Élevé | IAP exige une identité Google sur chaque requête, ce qui bloque les appelants qui envoient ou reçoivent uniquement par jeton. |
| `GOTIFY_DEFAULTUSER_PASS` (généré automatiquement) | Modifier le mot de passe administrateur après la première connexion | Élevé | Le mot de passe d'initialisation ne s'applique qu'à la première initialisation ; laisser le mot de passe administrateur par défaut inchangé constitue une exposition permanente d'identifiants. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | à activer en production | Moyen | L'API et l'interface sont accessibles publiquement sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Gotify partagée avec la variante GKE est décrite dans
**[Gotify_Common](Gotify_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gotify sur Cloud Run](../labs/Gotify_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Gotify sur GKE Autopilot](Gotify_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gotify Common — Configuration applicative partagée](Gotify_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md) dans la solution **Customer Support Desk**.
