---
title: "Gotify sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Gotify sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gotify_CloudRun.md @ 15fd4c7 sha256:46b64058b399 -->

# Gotify sur Google Cloud Run {#gotify-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gotify_CloudRun.png" alt="Gotify sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gotify est un serveur open-source (licence MIT), auto-hébergé, pour l'envoi et la
réception de notifications push en temps réel. Les applications publient des messages
via une API REST simple et les clients les reçoivent instantanément via des flux
WebSocket. Ce module déploie Gotify sur **Cloud Run v2** sur la base de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Gotify et sur la manière de
les explorer et de les opérer depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à chaque application Cloud Run — identité de service,
ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gotify s'exécute comme un conteneur Go à binaire unique sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 512 MiB par défaut, CPU toujours actif pour les flux WebSocket |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — ce module n'utilise jamais le SQLite embarqué de Gotify |
| Secrets | Secret Manager | Mot de passe administrateur auto-généré (`GOTIFY_DEFAULTUSER_PASS`) ; mot de passe de la base de données |
| Build de conteneur | Cloud Build + Artifact Registry | Encapsule `ghcr.io/gotify/server` avec un point d'entrée de mappage de base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app` ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est fixé par la
  couche d'application partagée ; le mode SQLite de Gotify n'est pas utilisé, donc
  aucun disque persistant n'est requis.
- **Le conteneur écoute sur le port 80.** `container_port = 80` et le point d'entrée définit
  `GOTIFY_SERVER_PORT = 80`.
- **Le CPU est toujours alloué** (`cpu_always_allocated = true`) avec `min = max = 1`.
  Gotify maintient des flux WebSocket de longue durée et un bus de messages
  intra-processus, de sorte que le CPU ne doit pas être limité entre les requêtes.
  Cela empêche la mise à l'échelle à zéro ; une instance à faible trafic peut basculer
  `cpu_always_allocated = false`, acceptant que la livraison des flux
  soit interrompue pendant l'inactivité.
- **Une seule instance est la valeur par défaut sûre.** Le bus de messages de Gotify
  est intra-processus, de sorte qu'un flux client ne reçoit que les messages livrés à
  l'instance à laquelle il est connecté. La mise à l'échelle au-delà d'une instance
  sans couche de diffusion externe entraîne la perte de messages pour certains
  abonnés.
- **Le mot de passe administrateur est généré automatiquement** et stocké dans Secret
  Manager, injecté comme `GOTIFY_DEFAULTUSER_PASS`. L'administrateur initial (`admin`) est créé
  uniquement lors de la première initialisation de la base de données.
- **Aucun bucket de stockage d'objets n'est provisionné** (`storage_buckets = []`). Les messages,
  applications et jetons résident dans PostgreSQL ; les images d'application
  téléchargées et les plugins résident sur le partage NFS à `/app/data`
  (`enable_nfs = true`, qui doit rester activé — sinon ils disparaissent à chaque
  nouvelle révision ou démarrage à froid).
- **L'image est construite sur mesure.** `container_image_source = "custom"` construit un wrapper
  autour de `ghcr.io/gotify/server` qui mappe les variables de la plateforme `DB_*`
  sur la configuration `GOTIFY_DATABASE_*` (GORM) de Gotify ; `latest` s'ancre à la base
  `2.9.1`.
- **L'ingress public est la valeur par défaut.** `ingress_settings = "all"` afin que les
  applications d'envoi et les clients de réception puissent atteindre l'API REST et
  WebSocket.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Gotify {#a-cloud-run--the-gotify-service}

Gotify s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs. Étant donné que le CPU est toujours alloué et qu'une seule
instance est maintenue, les flux WebSocket restent connectés entre les envois de
messages.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gotify stocke toutes les données d'application (messages, applications, clients,
utilisateurs) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se
connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP
publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée la
base de données et le rôle de l'application ; Gotify applique ensuite son propre
schéma via l'auto-migration GORM lors du premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Le mot de passe administrateur (`GOTIFY_DEFAULTUSER_PASS`) est généré automatiquement et stocké
dans Secret Manager. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotify"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Build de conteneur et Artifact Registry {#d-container-build--artifact-registry}

L'image personnalisée encapsule `ghcr.io/gotify/server` avec un point d'entrée de mappage de
base de données. Cloud Build la construit et la pousse vers Artifact Registry ;
`enable_image_mirroring = true` met en miroir la base amont dans Artifact Registry pour éviter les
limites de débit du registre.

- **Console :** Cloud Build → Historique ; Artifact Registry → Dépôts.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts repositories list --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet l'accès
public requis pour les applications d'envoi et les clients de réception. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud
Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec un test de disponibilité optionnel
contre `/health` (désactivé par défaut) et des politiques d'alerte
optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gotify {#3-gotify-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il se
  connecte via le Cloud SQL Auth Proxy et crée de manière idempotente la base de
  données et le rôle de l'application et accorde les privilèges. Le job peut être
  réexécuté en toute sécurité.
- **Schéma via l'auto-migration GORM.** Gotify crée et migre ses propres tables à
  chaque démarrage — il n'y a pas de job de migration séparé. La mise à niveau de la
  version de l'application applique automatiquement les modifications de schéma.
- **Le compte administrateur est amorcé une seule fois.** `GOTIFY_DEFAULTUSER_NAME = admin` et le
  secret `GOTIFY_DEFAULTUSER_PASS` créent l'administrateur initial uniquement lors de la
  première initialisation de la base de données. Récupérez le mot de passe de Secret
  Manager et changez-le après la première connexion. Changer le secret plus tard ne
  réinitialise pas le mot de passe administrateur.
- **L'envoi et la réception sont authentifiés par jeton.** Après vous être connecté,
  créez une *application* (qui génère un jeton d'application) pour envoyer des
  messages via `POST /message?token=<apptoken>`, et utilisez un jeton *client* pour vous
  abonner via le WebSocket à `/stream?token=<clienttoken>`. Confirmez la santé sans jeton :
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --project "$PROJECT" --format='value(status.url)')/health"
  ```
- **Livraison WebSocket à instance unique.** Étant donné que le bus de messages est
  intra-processus, maintenez `max_instance_count = 1` à moins d'ajouter une couche de
  diffusion externe — sinon un message envoyé à une instance n'est pas livré aux
  clients qui diffusent depuis une autre.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/health` —
  le point de terminaison public qui renvoie `{"health":"green","database":"green"}` une fois que
  PostgreSQL est accessible. La sonde de démarrage par défaut autorise environ 5
  minutes au premier démarrage.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour Gotify sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotify` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Gotify` | Nom lisible par l'homme affiché dans la console. |
| `application_description` | `Gotify push notification server on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag d'image ; `latest` se résout en la base épinglée `2.9.1`. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper de mappage de base de données ; `prebuilt` déploie une URI d'image que vous configurez. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU convient à la plupart des instances. |
| `memory_limit` | `512Mi` | Mémoire par instance ; 512 MiB est le plancher de la gen2. |
| `min_instance_count` | `1` | Gardez à 1 pour que les flux WebSocket restent connectés. |
| `max_instance_count` | `1` | Gardez à 1 — le bus de messages intra-processus ne se diffuse pas sur plusieurs instances. |
| `cpu_always_allocated` | `true` | Requis pour les flux WebSocket ; basculez sur `false` uniquement pour les instances à faible trafic. |
| `container_port` | `80` | Gotify écoute sur le port 80. |
| `execution_environment` | `gen2` | Environnement d'exécution Gen2. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmentez pour les flux de longue durée. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettez en miroir `ghcr.io/gotify/server` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartissez le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux applications d'envoi et aux clients de réception d'atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. Bloque les appelants d'API basés sur des jetons, sauf s'ils portent également une identité. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `GOTIFY_*` supplémentaires. La connexion à la base de données et `GOTIFY_DEFAULTUSER_PASS` sont injectés automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS (nécessite Cloud Armor). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Vide — Gotify n'a pas besoin de stockage de fichiers. Ajoutez des buckets uniquement pour des besoins personnalisés. |
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : les images d'application téléchargées et les plugins résident sous `/app/data` et disparaissent autrement à chaque nouvelle révision ou démarrage à froid. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Gotify utilise PostgreSQL géré. |
| `application_database_name` | `gotify` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `gotify` | Rôle de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | désactivé | Extensions PostgreSQL optionnelles. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs optionnels. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires à côté de Gotify. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 30s, 30 échecs | Sonde de démarrage. Permet environ 5 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/health`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/health` | Sondes au niveau App_CloudRun. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 16 — Redis {#group-16--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Gotify n'a pas besoin de Redis ; laissez désactivé sauf si vous intégrez une instance externe. |
| `redis_host` | `""` | Point de terminaison Redis (utilisé uniquement lorsque `enable_redis = true`). |
| `redis_port` | `6379` | Port Redis. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (découvre automatiquement `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `project_id` / `deployment_id` | ID du projet / suffixe de déploiement. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / rôle de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Gotify). |
| `container_image` | Image déployée. |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD et dépôt connecté. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors de portée, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | La mise à l'échelle au-delà de 1 sans diffusion externe entraîne la perte de messages pour les clients diffusant depuis d'autres instances (bus de messages intra-processus). |
| `application_database_name` / `application_database_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit tous les messages. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans sauvegarde valide échoue le job d'importation. |
| `cpu_always_allocated` | `true` | Élevé | En cas de facturation basée sur les requêtes, le CPU est limité entre les requêtes et la livraison des flux WebSocket est interrompue pendant l'inactivité. |
| `container_port` | `80` | Élevé | Gotify écoute sur le port 80 ; un port non concordant échoue la sonde de démarrage et la révision ne sert jamais. |
| `memory_limit` | `512Mi` | Élevé | En dessous du plancher de 512 MiB de la gen2, le plan est rejeté. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro supprime tous les flux WebSocket actifs lorsque l'instance est récupérée. |
| `ingress_settings` | `all` | Élevé | `internal` bloque les expéditeurs et récepteurs externes d'atteindre le service. |
| `enable_iap` | uniquement lorsque les appelants d'API portent une identité | Élevé | IAP exige une identité Google à chaque requête, bloquant les appelants d'envoi/réception basés sur des jetons uniquement. |
| `GOTIFY_DEFAULTUSER_PASS` (auto-généré) | Changer le mot de passe administrateur après la première connexion | Élevé | Le mot de passe de démarrage ne s'applique qu'à la première initialisation ; laisser le mot de passe administrateur par défaut inchangé est une exposition permanente des identifiants. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'API et l'interface utilisateur sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Gotify
partagée avec la variante GKE est décrite dans **[Gotify_Common](Gotify_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Gotify sur Cloud Run](../labs/Gotify_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gotify sur GKE Autopilot](Gotify_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Gotify Common — Configuration d'application partagée](Gotify_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md) dans la solution **Customer Support Desk**.
