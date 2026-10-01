---
title: "OnlyOffice sur Google Cloud Run"
description: "Référence de configuration pour déployer OnlyOffice sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/OnlyOffice_CloudRun.md @ 3055034 sha256:3cec8a84ada4 -->

# OnlyOffice sur Google Cloud Run {#onlyoffice-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OnlyOffice_CloudRun.png" alt="OnlyOffice sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ONLYOFFICE Document Server est une suite bureautique collaborative en ligne et open source permettant
la coédition en temps réel de documents texte, de feuilles de calcul, de présentations, de PDF et de formulaires —
une alternative auto-hébergée à Google Docs / Microsoft Office Online. Elle n'est généralement pas
ouverte directement par les utilisateurs finaux ; elle est intégrée par une application hôte (Nextcloud,
ownCloud, Seafile ou une intégration personnalisée) via son API et un secret JWT partagé. Ce
module déploie ONLYOFFICE Document Server sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise OnlyOffice et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toute application Cloud Run — identité du service, entrée et équilibrage
de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — consultez le
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

L'image `onlyoffice/documentserver` est « tout compris » : elle embarque ses propres
convertisseurs, nginx et RabbitMQ (AMQP) sous `supervisord`. Ce module construit une fine
surcouche personnalisée autour d'elle et externalise PostgreSQL (Cloud SQL) et Redis ; le
RabbitMQ embarqué reste interne, sur localhost.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur construit sur mesure, 2 vCPU / 4 GiB par défaut, autoscaling serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — une garde au moment du plan rejette MySQL et tout autre moteur |
| Cache / état d'édition | Redis externe | Obligatoire — une garde au moment du plan rejette `enable_redis = false` ; utilise par défaut le Redis colocalisé sur la VM NFS lorsque `redis_host` est vide |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; stockage partagé des pièces jointes et documents entre instances, monté sur `/opt/onlyoffice/storage` |
| Stockage objet | Cloud Storage | Deux buckets par défaut : un bucket `storage` déclaré par `OnlyOffice_Common`, plus un bucket `data` via `storage_buckets` (tous deux conditionnés par `create_cloud_storage`, qui vaut `true` par défaut ici puisque Cloud Run n'offre pas d'option de PVC en mode bloc) |
| Secrets | Secret Manager | `JWT_SECRET` de 48 caractères généré automatiquement ; mot de passe de base de données géré séparément |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Une garde inter-variables au moment du plan, dans le fichier
  `validation.tf` de ce module, rejette tout `database_type` autre que `POSTGRES_13`/`14`/`15`/`NONE`
  — MySQL et SQL Server ne sont pas pris en charge par Document Server.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment du plan fait échouer le déploiement
  si `enable_redis = false`. Lorsque `redis_host` est laissé vide, `enable_nfs` doit rester
  `true` afin que l'IP de la VM NFS colocalisée puisse servir d'hôte Redis par défaut.
- **NFS est activé par défaut** (`enable_nfs = true`, contrairement à la plupart des autres modules
  Cloud Run), car il sert aussi de stockage partagé des pièces jointes et de source du point de terminaison
  Redis par défaut.
- **`JWT_SECRET` est généré une seule fois et ne doit jamais faire l'objet d'une rotation** une fois qu'une application
  hôte (Nextcloud, ownCloud, une intégration personnalisée) a été configurée pour intégrer
  l'éditeur — sa rotation rompt la confiance entre Document Server et chaque
  intégration jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur.
- **Le plancher de mémoire est de 4Gi, et non les 512Mi–2Gi habituels de la plateforme.** La pile
  embarquée client Postgres/client Redis/RabbitMQ/nginx/convertisseurs sous `supervisord` est
  lourde et a besoin de cette marge.
- **`cpu_always_allocated` vaut `false` par défaut (priorité au coût, facturation basée sur les requêtes).**
  Le travail principal d'édition/conversion s'exécute pendant la requête, donc un démarrage à froid reste supportable, mais
  le cache de documents embarqué et la file de conversion RabbitMQ interne sont réinitialisés à
  chaque démarrage à froid. Définissez `true` (avec `min_instance_count >= 1`) pour un éditeur
  toujours chaud.
- **L'image est construite sur mesure, et non préconstruite.** `container_image_source = "custom"`
  enveloppe l'image Docker Hub `onlyoffice/documentserver` avec un `cloud-entrypoint.sh`
  qui fait correspondre les variables `DB_*`/`REDIS_HOST` du socle à la convention propre
  à Document Server. `application_version = "latest"` est épinglée à `8.3.3` au moment du build via
  un ARG de build propre à l'application, `ONLYOFFICE_VERSION` (la variable `APP_VERSION` injectée
  par le socle n'est volontairement pas utilisée, car elle l'emporterait sinon lors de la fusion).
- **Les contrôles de santé ciblent `/healthcheck`, sans authentification**, avec un budget généreux
  pour le premier démarrage (délai initial de 90s, jusqu'à 40 échecs) car la pile embarquée met du temps
  à être prête.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OnlyOffice {#a-cloud-run--the-onlyoffice-service}

OnlyOffice Document Server s'exécute comme un service Cloud Run v2 unique (l'image de surcouche
construite sur mesure) qui s'adapte automatiquement à la charge de requêtes entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OnlyOffice stocke les métadonnées des documents, leurs versions et l'état de l'application dans une instance
gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte de façon privée via le
**Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier déploiement,
le job intégré `db-init` crée le rôle applicatif, la base de données et les droits — Document
Server installe ensuite son propre schéma au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis externe et Cloud Filestore (NFS) {#c-external-redis--cloud-filestore-nfs}

Redis conserve l'état des sessions et de l'édition, qui doit être partagé entre toutes les instances
OnlyOffice — le RabbitMQ embarqué reste interne, mais Redis est externalisé et
**obligatoire** (une garde au moment du plan fait échouer le déploiement si `enable_redis = false`). Lorsque
`redis_host` est laissé vide, le socle injecte l'IP du Redis colocalisé sur la VM NFS
(`enable_nfs` doit alors rester `true`) ; définissez explicitement `redis_host` pour pointer vers une
autre instance Redis. Cloud Filestore (NFS) est activé par défaut et monté sur
`/opt/onlyoffice/storage` pour le stockage partagé des pièces jointes et documents entre instances —
contrairement à la variante GKE, il n'existe pas d'option de PVC en mode bloc, puisque les instances Cloud Run sont
sans état et éphémères.

- **Console :** Compute Engine → VM instances (la VM colocalisée NFS/Redis) ;
  Filestore → Instances.
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the resolved Redis/DB env vars in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de découverte de la VM NFS et la
convention selon laquelle l'hôte Redis se rabat sur l'IP NFS.

### D. Cloud Storage {#d-cloud-storage}

Deux buckets sont provisionnés par défaut : un bucket `storage` déclaré par
`OnlyOffice_Common` (pour les besoins de stockage propres à l'application) et un bucket `data` issu de la
valeur par défaut de `storage_buckets` de ce module — tous deux conditionnés par `create_cloud_storage`, qui
vaut `true` par défaut ici (contrairement à la variante GKE, où il vaut `false` car la
persistance y repose plutôt sur un PVC en mode bloc et NFS).

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~onlyoffice"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret propre à OnlyOffice est généré automatiquement et stocké dans Secret
Manager : **`JWT_SECRET`** (48 caractères, sans caractères spéciaux), qui signe chaque
requête interne à l'API Document Server et doit être présenté par toute application hôte
qui intègre l'éditeur. Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~onlyoffice-jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, le service est accessible à son URL `run.app`. Comme Document Server est
généralement appelé par le backend d'une application hôte (et non directement par les utilisateurs finaux), conservez
`ingress_settings = "all"` à moins que tous les appelants se trouvent dans le VPC. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OnlyOffice {#3-onlyoffice-application-behaviour}

- **Initialisation de la base de données au premier déploiement, sans job de migration distinct.** Le job intégré `db-init`
  s'exécute avec `postgres:15-alpine`. Il résout l'hôte Cloud SQL (le répertoire du socket Unix de l'Auth Proxy,
  avec repli sur l'IP privée de l'instance), attend que
  PostgreSQL soit joignable, crée ou met à jour le rôle applicatif avec le mot de passe
  généré, crée la base de données de l'application et accorde tous les privilèges — il se contente de
  provisionner le rôle, la base et les droits. Document Server installe son propre schéma au
  premier démarrage, il n'y a donc pas d'étape de migration distincte. Le job peut être relancé sans risque
  (`execute_on_apply = true`).
- **`JWT_SECRET` est immuable une fois les intégrations raccordées.** Généré une seule fois (48
  caractères) et écrit dans Secret Manager. `JWT_ENABLED = "true"`,
  `JWT_HEADER = "Authorization"`, `JWT_IN_BODY = "true"` sont définis automatiquement par
  `OnlyOffice_Common`. La rotation du secret invalide la confiance avec chaque application
  hôte intégrant l'éditeur jusqu'à ce que chacune soit reconfigurée avec la nouvelle valeur.
- **La correspondance des variables d'environnement de base de données et Redis se fait dans le `cloud-entrypoint.sh` intégré à l'image.** Il définit
  `DB_TYPE = "postgres"` et `DB_PWD` à partir du `DB_PASSWORD` injecté
  (`DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` correspondent déjà aux noms propres à Document Server),
  et fait correspondre `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` à
  `REDIS_SERVER_HOST`/`REDIS_SERVER_PORT`/`REDIS_SERVER_PASS` avant d'exécuter (`exec`) le script
  amont `/app/ds/run-document-server.sh`. Comme cette logique est intégrée à
  l'image personnalisée, une modification de `cloud-entrypoint.sh` nécessite une reconstruction pour prendre effet.
- **Bogue de l'éditeur propre à Cloud Run, corrigé au moment du build.** Sur Cloud Run, `DB_HOST` est un
  **répertoire** de socket Unix du Cloud SQL Auth Proxy (`/cloudsql/<instance>`), ce qui
  convient à la vraie connexion à la base — mais le script amont `run-document-server.sh` possède sa
  propre porte de disponibilité distincte, `waiting_for_connection()`, qui exécute inconditionnellement
  `nc -z "$DB_HOST" "$DB_PORT"`. `nc` ne peut pas résoudre un chemin de système de fichiers comme hôte TCP,
  de sorte que, sans correctif, il boucle indéfiniment (`Waiting for connection to the /cloudsql/... host
  on port 5432` se répète dans Cloud Logging) et le conteneur ne devient jamais Ready.
  Le Dockerfile du module corrige cette porte par `sed -i` pour qu'elle réussisse immédiatement
  lorsque `$1` est un répertoire existant, en laissant intact le contrôle `nc` d'origine pour les
  vrais hôtes TCP — GKE (dont le sidecar Auth Proxy écoute sur `127.0.0.1`) n'est donc
  pas concerné et ne nécessite aucun correctif. Une assertion `grep -q` placée juste après le `sed` fait échouer
  bruyamment le Cloud Build si une future montée de `ONLYOFFICE_VERSION` modifie la formulation du script
  amont — voir `modules/OnlyOffice_Common/scripts/Dockerfile`.
- **Aucun parcours d'inscription classique.** Document Server n'est généralement pas ouvert directement par
  les utilisateurs finaux — il est intégré via des appels d'API depuis une application hôte (Nextcloud,
  ownCloud, une intégration personnalisée) à l'aide du secret JWT partagé. Il n'y a pas de compte
  administrateur à créer au premier démarrage ; la disponibilité est confirmée via `/healthcheck` et par
  l'ouverture réussie d'un document en coédition depuis l'application hôte.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/healthcheck` — le point de terminaison de Document
  Server qui ne renvoie `true` qu'une fois nginx et les services de documents
  démarrés et la base de données joignable, servi sans authentification. Prévoyez plusieurs minutes au
  premier démarrage (délai initial de 90 secondes, période de 15 secondes, jusqu'à 40 échecs — soit environ
  10 minutes de marge pendant que la pile embarquée démarre et que le schéma s'installe).
- **WOPI est désactivé par défaut.** `WOPI_ENABLED = "false"` ; activez-le via
  `environment_variables` uniquement lors d'une intégration avec un hôte WOPI (par exemple SharePoint).
- **Inspecter l'exécution des jobs et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les
paramètres propres à OnlyOffice ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `onlyoffice` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `ONLYOFFICE Document Server` | Nom lisible affiché dans la console. |
| `description` | _(définie)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image Document Server ; `latest` est épinglée à `8.3.3` au moment du build via l'ARG de build `ONLYOFFICE_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Toujours custom — enveloppe l'image Docker Hub `onlyoffice/documentserver` avec le point d'entrée cloud. |
| `container_image` | `""` | Laissez vide pour utiliser l'image personnalisée construite. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; la pile embarquée a besoin d'au moins 4Gi. |
| `cpu_always_allocated` | `false` | Priorité au coût, facturation basée sur les requêtes. Contrepartie : le cache de documents et la file de conversion RabbitMQ interne sont réinitialisés au démarrage à froid. Définissez `true` (+ `min_instance_count >= 1`) pour un éditeur toujours chaud. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Bornes du nombre de réplicas pods/instances. |
| `container_port` | `80` | Le nginx embarqué de Document Server écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Toujours true — met en miroir l'image de base Docker Hub dans Artifact Registry avant le build personnalisé. |
| `container_build_config` | construction de l'image de surcouche | Configuration du Dockerfile et des arguments de build ; `build_args` définit `ONLYOFFICE_VERSION` (voir la vue d'ensemble). |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Répertoire du socket de l'Auth Proxy. |
| `additional_services` / `additional_containers` | `[]` | Non utilisés par ce module — inertes sauf configuration explicite. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec la convention ; non référencée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Conservez `all` à moins que tous les appelants de l'API Document Server se trouvent dans le VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque les appels d'API des applications hôtes s'il est activé.** |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `network_name` | `""` | Réseau VPC à utiliser ; découvre automatiquement un réseau unique géré par Services_GCP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DB_TYPE`, `JWT_ENABLED`, `JWT_HEADER`, `JWT_IN_BODY`, `WOPI_ENABLED` sont définies automatiquement — ne remplacez pas `JWT_ENABLED`/`JWT_HEADER`/`JWT_IN_BODY` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager au moment du plan. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |
| `module_writable_secret_ids` | `{}` | Non utilisée par ce module (aucun hook post-installation ne réécrit de secrets). |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le provisionnement. Non
utilisés par le déploiement OnlyOffice par défaut (l'installation du schéma est gérée par
Document Server lui-même). Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Conditionne à la fois le bucket `storage` déclaré par Common et la liste `storage_buckets` propre à ce module. Vaut `true` par défaut ici (contrairement au `false` de GKE) puisque Cloud Run n'offre pas d'option de persistance par PVC en mode bloc. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket(s) GCS supplémentaire(s) en plus du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `true` | Activé par défaut — stockage partagé des pièces jointes et source de l'hôte Redis de repli. |
| `nfs_mount_path` | `/opt/onlyoffice/storage` | Chemin de montage dans le conteneur. |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | VM NFS existante à utiliser, ou nom de base d'une VM créée en mode intégré (inline). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Obligatoire — une garde au moment du plan (`validation.tf`) rejette toute valeur autre que `POSTGRES_13`/`14`/`15`/`NONE`. MySQL n'est pas pris en charge. |
| `db_name` | `onlyoffice` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `onlyoffice` | Utilisateur de la base de données applicative. Mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivée | Rotation du mot de passe de la base de données. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Simple miroir pour la cohérence avec le socle — ce module raccorde la base de données via `db_name`/`db_user` ci-dessus, et non via celles-ci ; inertes à moins que le module ne soit raccordé autrement. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` (crée le rôle, la base de données et les droits ; Document Server installe son propre schéma). |
| `cron_jobs` | `[]` | Non utilisée — OnlyOffice n'a aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck`, délai de 90s, période de 15s, 40 échecs | Budget généreux au premier démarrage pour la lourde pile embarquée. |
| `liveness_probe` | HTTP `/healthcheck`, délai de 120s, période de 30s, 3 échecs | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | même chemin, forme structurée | Définitions alternatives des sondes au niveau du service ; `startup_probe`/`liveness_probe` s'appliquent par défaut. |
| `uptime_check_config` | `{ enabled=false, path="/healthcheck" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une garde au moment du plan rejette `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du Redis colocalisé sur la VM NFS (requiert `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
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
| `initialization_jobs` | Noms des jobs d'initialisation (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. OnlyOffice ajoute ses propres gardes inter-variables dans `validation.tf` : `database_type` limité à PostgreSQL, `enable_redis` obligatoire, couplage `redis_host`/`enable_nfs`, `min_instance_count <= max_instance_count` et cohérence entre `enable_cloudsql_volume` et `database_type = "NONE"`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de la moindre ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou 13/14) | Critique | Tout autre moteur est rejeté au moment du plan — MySQL n'est pas pris en charge par Document Server. |
| `enable_redis` | `true` | Critique | Une garde au moment du plan rejette `false` — sans Redis partagé, l'état des sessions et de l'édition ne peut pas être coordonné entre les instances. |
| `redis_host` / `enable_nfs` | Ne laissez `redis_host` vide qu'avec `enable_nfs = true` | Critique | Un `redis_host` vide avec `enable_nfs = false` échoue au moment du plan — il n'y a aucun hôte Redis à résoudre. |
| `JWT_SECRET` (généré automatiquement) | Ne jamais le modifier une fois des intégrations en place | Critique | Sa rotation casse chaque application hôte (Nextcloud/ownCloud/etc.) intégrant l'éditeur jusqu'à ce que toutes soient mises à jour avec la nouvelle valeur. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données et l'utilisateur et rend toutes les données orphelines. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans sauvegarde valide fait échouer le job d'import. |
| `memory_limit` | `4Gi` | Élevé | La pile embarquée client Postgres/client Redis/RabbitMQ/nginx/convertisseurs sous `supervisord` est lourde ; un sous-dimensionnement expose à des arrêts OOM au démarrage ou pendant la conversion de documents. |
| `ingress_settings` | `all` (sauf si tous les appelants sont dans le VPC) | Élevé | L'API de Document Server est normalement appelée par le backend d'une application hôte ; bloquer ce trafic casse toutes les intégrations de l'éditeur. |
| `enable_iap` | uniquement lorsqu'aucune application hôte externe n'appelle l'API | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les appels de l'application hôte à l'API Document Server. |
| `enable_cloudsql_volume` | `true` sauf si `database_type = "NONE"` | Élevé | Une garde au moment du plan rejette la combinaison `enable_cloudsql_volume = true` avec `database_type = "NONE"` — le sidecar Auth Proxy n'aurait aucune instance à laquelle se connecter. |
| `cpu_always_allocated` | `false` (priorité au coût) ou `true` pour un éditeur toujours chaud | Moyen | Avec `false` et la mise à l'échelle à zéro, le cache de documents et la file de conversion RabbitMQ interne sont réinitialisés à chaque démarrage à froid, ce qui ajoute de la latence à la session d'édition suivante. |
| `min_instance_count` | `1` pour éviter les démarrages à froid pendant les sessions d'édition actives | Moyen | La mise à l'échelle à zéro (`0`) ajoute, après une période d'inactivité, une latence sur la première requête de l'ordre de la sonde de démarrage, ressentie par chaque collaborateur qui ouvre un document. |
| `create_cloud_storage` / `storage_buckets` | conserver les valeurs par défaut sauf besoin d'ajuster la persistance | Moyen | Définir `create_cloud_storage = false` supprime aussi le bucket `storage` déclaré par Common, puisque les deux sont conditionnés par le même indicateur. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention réglementaire. |
| `enable_cloud_armor` | à activer en production | Moyen | L'API Document Server est accessible publiquement sans protection WAF. |
| ARG de build `ONLYOFFICE_VERSION` (Dockerfile) | Ne monter de version qu'après avoir vérifié que le correctif `sed`/`grep` de la porte de disponibilité correspond toujours à la formulation amont | Élevé | Le correctif `sed -i` du Dockerfile sur `waiting_for_connection()` de `run-document-server.sh` (qui fait court-circuiter le contrôle `nc -z` par le `DB_HOST` répertoire de socket Cloud SQL) est protégé par une assertion `grep -q` au moment du build. Si une montée de version modifie le texte exact du script amont, le Cloud Build échoue bruyamment à cette étape — la solution est de mettre à jour le motif `sed` dans `modules/OnlyOffice_Common/scripts/Dockerfile`, et non d'ignorer le contrôle. Sans correctif, l'image de l'éditeur se bloque indéfiniment sur Cloud Run (`Waiting for connection to the /cloudsql/... host on port 5432` se répète dans Cloud Logging) car `nc` ne peut jamais résoudre un répertoire de socket Unix comme hôte TCP ; GKE n'est pas concerné puisque son sidecar Auth Proxy écoute sur un véritable hôte TCP `127.0.0.1`. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à OnlyOffice
partagée avec la variante GKE — le secret JWT, l'initialisation de la base de données, l'image de conteneur
et son point d'entrée, les paramètres de base de l'application et le comportement des sondes de santé — est décrite
dans **[OnlyOffice_Common](OnlyOffice_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OnlyOffice sur Cloud Run](../labs/OnlyOffice_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [OnlyOffice sur GKE Autopilot](OnlyOffice_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [OnlyOffice Common — Configuration applicative partagée](OnlyOffice_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Odoo sur Cloud Run](Odoo_CloudRun.md), [Metabase sur Google Cloud Run](Metabase_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) dans la solution **Integrated ERP Platform**.
