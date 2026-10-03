---
title: "GoToSocial sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de GoToSocial sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GoToSocial_CloudRun.md @ 15fd4c7 sha256:f86fae708980 -->

# GoToSocial sur Google Cloud Run {#gotosocial-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoToSocial_CloudRun.png" alt="GoToSocial sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoToSocial est un serveur ActivityPub/Fediverse léger et auto-hébergé — une
petite alternative à Mastodon, écrite sous la forme d'un seul binaire Go
statique. Ce module déploie GoToSocial sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par GoToSocial et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoToSocial s'exécute comme un conteneur binaire Go unique sur Cloud Run v2,
déployé directement à partir de l'image officielle `docker.io/superseriousbusiness/gotosocial`
— pas de build personnalisé. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go sur le port 8080, 2 vCPU / 4 GiB par défaut ; mise à l'échelle automatique sans serveur ; **`max_instance_count` fixé à 1** |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — fixé à `POSTGRES_15` ; MySQL non pris en charge. Base de données créée avec le classement obligatoire `LC_COLLATE='C' LC_CTYPE='C'` |
| Stockage d'objets | Cloud Storage | Un bucket `storage` + compte de service HMAC dédié, consommé inconditionnellement via le client compatible S3 natif de GoToSocial — pas de montage GCS FUSE |
| Secrets | Secret Manager | `SUPERUSER_PASSWORD` auto-généré, paire clé d'accès/secrète HMAC S3 ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé via Cloud Armor |

**Valeurs par défaut judicieuses à connaître dès le départ :**

- **PostgreSQL 15 avec le classement `C` est obligatoire.** `database_type =
  "POSTGRES_15"` est la valeur par défaut, et le `validation.tf` de `GoToSocial_CloudRun`
  rejette tout `database_type` non-Postgres au moment de la planification. Le job `db-init`
  crée en outre la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` —
  GoToSocial refuse de démarrer avec tout autre classement.
- **Image pré-construite, pas personnalisée.** `container_image_source = "prebuilt"`
  déploie `docker.io/superseriousbusiness/gotosocial` directement. Le propre dépôt en amont de GoToSocial
  a été déplacé vers Codeberg, mais le registre de conteneurs vers lequel il
  publie est toujours Docker Hub. Aucun wrapper de point d'entrée n'est
  nécessaire — la configuration se fait entièrement via des variables
  d'environnement `GTS_*` discrètes que le binaire lit nativement.
- **Pas de job de migration.** GoToSocial crée et met à jour son propre
  schéma automatiquement à chaque démarrage ; `db-init` ne prépare que la
  base de données et le rôle de classement C.
- **`max_instance_count` est fixé à 1.** Le cache en cours de traitement de GoToSocial
  n'a pas de synchronisation inter-instances ; l'amont ne prend pas en charge
  plusieurs instances sur la même base de données/stockage. `min_instance_count = 0`
  (mise à l'échelle à zéro) est sûr — la contrainte d'instance unique
  concerne la concurrence, pas la chaleur entre les redémarrages.
- **Cloud SQL est atteint via TCP chiffré vers l'IP privée, pas un socket
  Unix.** Le mécanisme `db_host_env_var_name` de `App_CloudRun`
  alias toujours l'IP privée brute de Cloud SQL (pas le chemin du socket
  `DB_HOST` que Cloud Run résout autrement), donc `GTS_DB_TLS_MODE` est
  remplacé par `"enable"` (chiffrer sans vérifier) plutôt que le
  `"disable"` correct pour GKE — voir §3 et le tableau des pièges.
- **Pas de montage GCS FUSE.** Le stockage des médias/avatars/pièces jointes
  utilise le client compatible S3 natif de GoToSocial pointant vers le point
  de terminaison XML d'interopérabilité S3 de GCS via un compte de service
  HMAC dédié — pas un montage de système de fichiers.
- **Les sondes de santé sont TCP, pas HTTP.** Les points de terminaison
  `/readyz`/`/livez` de GoToSocial rejettent toute
  requête sans en-tête `User-Agent` avec une réponse
  anti-scraper `418` — ni le sondeur HTTP de Cloud Run ni un
  `curl` nu n'en envoie un. La sonde de vivacité est
  entièrement désactivée sur Cloud Run (son API rejette purement et
  simplement une sonde de vivacité de socket TCP) ; la sonde de démarrage
  seule régule le trafic.
- **Aucun compte administrateur n'existe tant que vous n'avez pas déclenché
  manuellement `admin-create`.** GoToSocial n'a pas de flux
  d'inscription web pour le premier compte. Voir §3 et le tableau des pièges.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont
définis. Les noms des services et des ressources sont indiqués dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service GoToSocial {#a-cloud-run--the-gotosocial-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GoToSocial stocke toutes les données de l'application (comptes, statuts,
suivis, métadonnées des médias) dans une instance gérée de Cloud SQL pour
PostgreSQL 15, créée avec le classement obligatoire `C` par le
job `db-init`. Le service se connecte via TCP chiffré à l'IP privée de
l'instance (voir §3 pour savoir pourquoi, contrairement à la plupart des
applications Cloud Run de ce catalogue, il ne s'agit *pas* d'une connexion
par socket Unix).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~gotosocial"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot
de passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage — médias, avatars, pièces jointes {#c-cloud-storage--media-avatars-attachments}

Un bucket **Cloud Storage** dédié (suffixe `storage`) et un compte de
service détenant une **clé HMAC** sont provisionnés automatiquement,
accordant au SA de stockage `roles/storage.objectAdmin` sur le bucket. Contrairement au
stockage S3 opt-in vu ailleurs dans ce catalogue, GoToSocial écrit dans ce
bucket inconditionnellement dès le premier démarrage — `GTS_STORAGE_BACKEND=s3` n'est
pas facultatif.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud storage ls gs://<storage-bucket>/
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse (non utilisé ici) et les
options CMEK.

### D. Secret Manager {#d-secret-manager}

Le conteneur principal de GoToSocial lit `SUPERUSER_PASSWORD` (uniquement via le
job `admin-create`, pas le serveur en cours d'exécution), `GTS_STORAGE_S3_ACCESS_KEY` et
`GTS_STORAGE_S3_SECRET_KEY` comme variables d'environnement basées sur des secrets. Le
mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation, et [GoToSocial_Common](GoToSocial_Common.md) §2 pour savoir pourquoi
ces secrets transitent par `secret_ids`/`module_secret_env_vars`, et non par le
champ `secret_environment_variables` (mort) de l'objet de configuration par application.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings
= "all"`,
requis pour la fédération ActivityPub publique). Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests
de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GoToSocial {#3-gotosocial-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `scripts/db-init.sh` en utilisant `postgres:15-alpine`. Il
  attend que Cloud SQL accepte les connexions, puis crée de manière
  idempotente le rôle d'application et la base de données avec `LC_COLLATE='C' LC_CTYPE='C'`
  (GoToSocial refuse de démarrer autrement), accorde les privilèges et se
  termine. Peut être réexécuté en toute sécurité (`execute_on_apply = true`,
  `max_retries = 3`).
- **Pas de job de migration séparé.** GoToSocial migre son propre schéma
  automatiquement à chaque démarrage du serveur.
- **Le compte administrateur nécessite un déclenchement manuel — c'est le
  piège n°1 de ce module pour l'opérateur.** GoToSocial n'a pas de flux
  d'inscription basé sur le web et pas de point de terminaison REST pour le
  tout premier compte — il est uniquement en ligne de commande (`gotosocial admin account create` /
  `admin account promote`). Confirmé en direct : la CLI panique avec `NewSignup: instance application not
  yet created, run the server at least once before creating users`
  sauf si le processus du serveur principal a déjà démarré avec succès une
  fois. Les jobs d'initialisation de Cloud Run s'exécutent toujours *avant*
  que la première révision du service n'existe du tout, donc `admin-create` est
  créé avec `execute_on_apply = false` par conception — il ne peut pas réussir
  pendant l'`apply` initial. Une fois que le service est confirmé
  sain (voir Tâche 2 dans le lab), déclenchez-le manuellement :
  ```bash
  gcloud run jobs execute <service-name>-admin-create --region "$REGION" --project "$PROJECT" --wait
  ```
  Récupérez le mot de passe généré :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~superuser-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
- **`GTS_DB_TLS_MODE` est `"enable"` sur Cloud Run, pas `"disable"` ou
  `"require"` — une véritable asymétrie au niveau de la Fondation.**
  L'implémentation `db_host_env_var_name` de `App_CloudRun` alias toujours
  l'**IP privée** brute de Cloud SQL (`local.db_internal_ip`), pas le chemin du
  socket Unix `DB_HOST` que Cloud Run résout autrement — malgré le
  nom/la description de la variable impliquant "hôte". (L'équivalent de
  `App_GKE` est plus intelligent : il préfère le bouclage `127.0.0.1`
  du sidecar cloud-sql-proxy, donc GKE conserve correctement `"disable"`.) Une
  connexion TCP IP privée brute à Cloud SQL nécessite un chiffrement, donc
  un `"disable"` simple échoue ("pas de chiffrement"). `"require"`
  n'est *pas* non plus la solution — confirmé en direct, il exige une
  vérification complète du certificat (documentation de GoToSocial :
  `"require"` = "un certificat valide doit être présenté"), ce qui
  échoue avec le certificat de Cloud SQL ("x509: impossible de valider le
  certificat ... ne contient pas d'IP SANs"). `"enable"` est correct —
  la documentation de GoToSocial confirme que cela signifie "TLS sera tenté,
  mais le certificat de la base de données ne sera pas vérifié" (la
  sémantique classique libpq `sslmode=require`-non-`verify-full`). `gotosocial.tf`
  définit cette surcharge via `module_env_vars`.
- **Chemin de santé — TCP uniquement, et pourquoi `curl` a besoin d'un
  `User-Agent`.** GoToSocial sert de véritables points de terminaison
  non authentifiés `/readyz` (DB `SELECT`, 500 en cas
  d'échec) et `/livez` (200 bon marché), mais les deux rejettent
  toute requête sans en-tête `User-Agent` avec une réponse
  `418 I'm a teapot` — confirmé en direct : `{"error": "I'm a teapot: no user-agent sent with request"}`. Ni le
  sondeur HTTP de Cloud Run ni un `curl` nu n'en envoie un, donc
  **chaque** commande de vérification manuelle contre cette application
  nécessite un drapeau explicite `-A`/`--user-agent` :
  ```bash
  curl -A "gotosocial-check/1.0" -s "$SERVICE_URL/readyz"
  ```
  La sonde de démarrage est TCP sur le port 8080 ; la sonde de vivacité est
  entièrement désactivée (l'API de Cloud Run rejette purement et simplement
  une sonde de vivacité de socket TCP).
- **Propagation IAM du stockage.** GoToSocial panique au démarrage s'il ne
  peut pas atteindre son backend de stockage S3. L'octroi `roles/storage.objectAdmin` du SA
  de stockage est câblé contre la propre sortie `storage_buckets` de la
  Fondation (pas un `depends_on` de module entier, ce qui
  provoquerait un blocage) — mais un premier déploiement frais peut encore
  voir le tout premier démarrage du conteneur courir le délai de propagation
  IAM d'environ 1 à 2 minutes. Il s'agit d'une nouvelle tentative unique
  attendue et occasionnelle, pas d'un bug.
- **Inspectez les jobs d'initialisation et la configuration en cours
  d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (correspondant à la balise `{{UIMeta group=N}}` de chaque
variable dans `variables.tf`). Seuls les paramètres spécifiques ou
notables pour GoToSocial sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `cr`) de toute variante GKE co-déployée (par exemple `gke`) — CR+GKE du même locataire entrent en collision sur le nom du service, les secrets et les buckets. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotosocial` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `GoToSocial` | Nom lisible par l'homme affiché dans la console. |
| `description` | `GoToSocial — a lightweight, self-hosted ActivityPub/Fediverse server` | Description du service. |
| `application_version` | `latest` | Tag d'image Docker Hub. |
| `host` | `gotosocial.local` | `GTS_HOST` — le domaine public. Intégré à chaque URI ActivityPub au moment de la création, **immuable après le premier démarrage**. Définissez votre vrai domaine avant la production. |
| `account_domain` | `""` | `GTS_ACCOUNT_DOMAIN` — domaine de poignée de vanité facultatif, distinct de `host`. Par défaut `host` lorsqu'il est vide. Même risque d'immuabilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle de Docker Hub. `custom` est pris en charge mais inutile — GoToSocial n'a pas besoin de wrapper. |
| `container_image` | `""` | Remplace l'URI de l'image ; laissez vide pour utiliser l'image GoToSocial par défaut. |
| `cpu_limit` | `2000m` | 2 vCPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` permet la mise à l'échelle à zéro — sûr pour GoToSocial (contrainte de concurrence, pas de chaleur). |
| `max_instance_count` | `1` | **Plafond architectural strict** — le cache en cours de traitement de GoToSocial n'a pas de synchronisation inter-instances. Ne pas augmenter. |
| `container_port` | `8080` | Valeur par défaut native `GTS_PORT` de GoToSocial. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — le cœur de requête/réponse de GoToSocial n'a pas de processus de travail en arrière-plan séparé nécessitant du CPU entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse/NFS (non utilisés par la configuration par défaut de GoToSocial, mais cohérent avec le catalogue). |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Injecte le montage du socket Cloud SQL Auth Proxy, bien que GoToSocial se connecte via TCP à l'IP privée quoi qu'il arrive (voir §3) — le montage n'est pas utilisé par le chemin de la base de données de cette application mais il est inoffensif de le laisser activé. |
| `enable_image_mirroring` | `true` | Miroir de l'image Docker Hub dans Artifact Registry (évite les limites de débit de tirage de Docker Hub). |

### Groupe 5 — Accès, réseau {#group-5--access-networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis — la fédération et l'accès client nécessitent tous deux une accessibilité publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la fédération** — ne convient que pour une instance entièrement privée. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair fusionnées dans les valeurs par défaut de `GoToSocial_Common`. |
| `secret_environment_variables` | `{}` | Références de secrets destinées à l'opérateur — séparées de, et à ne pas confondre avec, le mécanisme `secret_ids` que `GoToSocial_Common` utilise lui-même (voir [GoToSocial_Common](GoToSocial_Common.md) §2). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Exécution standard de scripts SQL personnalisés d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés — doivent correspondre à `host`. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS — utile pour la diffusion de médias. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS — `gotosocial.tf` fournit le vrai bucket média `storage` via la sortie de `GoToSocial_Common`, remplaçant la valeur par défaut générique `data` de cette variable. |
| `enable_nfs` | `false` | Provisionne Filestore. **Non utilisé par GoToSocial** — le stockage des médias se fait via le client S3 natif, pas un montage. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. Non utilisés par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Validé par le plan** — `validation.tf` rejette tout sauf PostgreSQL 13/14/15 ou `NONE`. |
| `db_name` | `gotosocial` | La base de données réellement créée (avec le classement `C`) et injectée comme `GTS_DB_DATABASE`. Immuable après le premier déploiement. |
| `db_user` | `gotosocial` | Le rôle réellement créé et injecté comme `GTS_DB_USER` ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `GTS_DB_ADDRESS` / `GTS_DB_PORT` / `GTS_DB_USER` / `GTS_DB_DATABASE` / `GTS_DB_PASSWORD` | **Définis par `main.tf`, et non laissés à leurs valeurs par défaut de variables génériques vides** — c'est le mécanisme qui permet au binaire GoToSocial de lire ses propres noms `GTS_DB_*` tout en obtenant des valeurs de la génération standard `DB_*` de la Fondation. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire intégrée `db-init` + `admin-create` fournie par `GoToSocial_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme n'est définie pour GoToSocial. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, `/readyz` (chemin d'information uniquement), `initial_delay_seconds=15`, `failure_threshold=10` | Le seul type de sonde qui fonctionne contre les points de terminaison de santé de GoToSocial protégés par User-Agent. |
| `liveness_probe` | `enabled = false` | Désactivé — l'API de Cloud Run rejette purement et simplement les sondes de vivacité TCP ; la sonde de démarrage seule régule le trafic. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, divers | Sondes structurées alternatives ; remplacées par `startup_probe`/`liveness_probe` ci-dessus pour ce module. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut (nécessiterait également un vérificateur envoyant `User-Agent` pour réussir contre `/readyz`/`/livez` — un simple test `/` est la valeur par défaut la plus sûre ici). |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | GoToSocial n'a aucune dépendance Redis — son cache est en cours de traitement. Laissez `false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (l'IP privée de Cloud SQL sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket média `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `admin-create`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification.
> `GoToSocial_CloudRun` lui-même ajoute des vérifications `validation.tf` pour
> `min_instance_count > max_instance_count`, Redis activé sans hôte, et `database_type` loin de
> PostgreSQL — donc contrairement à certains modules de ce catalogue, l'erreur
> MySQL **est** détectée au moment de la planification ici, pas seulement à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `host` (`GTS_HOST`) | Définissez votre vrai domaine avant le premier déploiement | Critique | Intégré à chaque URI d'acteur/objet ActivityPub au moment de la création ; le modifier après l'existence de comptes/publications réels rompt la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `max_instance_count` | `1` (ne pas augmenter) | Critique | Le cache en cours de traitement de GoToSocial n'a pas de synchronisation inter-instances ; l'amont ne prend pas en charge plusieurs instances sur la même base de données/stockage — l'augmentation de cette valeur produit une incohérence des données/du cache, pas seulement un coût supplémentaire. |
| `GTS_DB_TLS_MODE` | `enable` (défini automatiquement par `gotosocial.tf`, ne pas remplacer par `disable`/`require`) | Critique | `disable` échoue purement et simplement contre le chemin TCP IP privée de Cloud SQL sur Cloud Run (pas de chiffrement) ; `require` échoue à la vérification du certificat contre le certificat de Cloud SQL (pas d'IP SANs) — seul `enable` (chiffrer sans vérifier) fonctionne ici. |
| `database_type` | `POSTGRES_15` | Critique | Validé au moment de la planification par le propre `GoToSocial_CloudRun` de `validation.tf` — MySQL/SQL Server sont rejetés avant l'apply, contrairement à d'autres modules de ce catalogue. |
| Câblage IAM du stockage (`google_storage_bucket_iam_member`) | Laisser tel quel (référence `module.app_cloudrun.storage_buckets["storage"]`) | Critique | GoToSocial panique au démarrage sans accès S3. Une alternative `depends_on = [module.app_cloudrun]` bloquerait le déploiement contre sa propre condition préalable IAM. |
| Sondes de santé (`startup_probe`/`liveness_probe`) | Laisser `type = "TCP"` | Élevé | Les `/readyz`/`/livez` de GoToSocial rejettent toute requête sans en-tête `User-Agent` (`418`) ; passer à `type = "HTTP"` fait échouer la sonde indéfiniment quel que soit le chemin, car le sondeur de Cloud Run n'en envoie jamais. |
| Job `admin-create` | Déclencher manuellement après le déploiement | Élevé | GoToSocial n'a pas de flux d'inscription web pour le premier compte, et le job ne peut pas s'exécuter au moment de l'apply sur Cloud Run (les jobs d'initialisation précèdent toujours la première révision) — ignorer cette étape laisse l'instance sans connexion administrateur utilisable. |
| Vérifications manuelles `curl`/de santé | Toujours passer `-A "<agent>"` | Moyen | Les `curl` nus (et la plupart des clients/moniteurs HTTP par défaut) obtiennent `418 I'm a teapot` de la porte User-Agent anti-scraper de GoToSocial, même sur des points de terminaison "non authentifiés" — facile à diagnostiquer à tort comme une panne. |
| `enable_redis` | `false` (par défaut) | Faible | GoToSocial n'a aucune dépendance Redis ; laisser ce `true` n'a aucun effet fonctionnel mais ajoute une configuration de dépendance NFS inutile. |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | Laisser tel quel (les alias `GTS_DB_*` sont définis dans `main.tf`) | Critique | Ce sont eux qui permettent au binaire de GoToSocial de lire les informations de connexion à la base de données de la Fondation — les remplacer rompt entièrement la connexion à la base de données. |
| `enable_iap` | `false` pour une instance publique | Moyen | IAP bloque le trafic de fédération ActivityPub non authentifié — ne convient que pour une instance entièrement privée/de test. |
| Propagation IAM du stockage au premier déploiement | Attendez-vous à une éventuelle nouvelle tentative unique | Faible | Le tout premier démarrage du conteneur d'un nouveau déploiement peut courir le délai de propagation de l'octroi IAM du SA de stockage (environ 1 à 2 minutes) ; l'application se rétablit lors de la révision/nouvelle tentative suivante sans qu'aucun changement de configuration ne soit nécessaire. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à GoToSocial partagée avec la variante GKE (secrets,
les jobs `db-init`/`admin-create` et le compte de service de
stockage) est définie dans **[GoToSocial_Common](GoToSocial_Common.md)**
(source du module : `modules/GoToSocial_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoToSocial sur Cloud Run](../labs/GoToSocial_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoToSocial sur GKE Autopilot](GoToSocial_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoToSocial Common — Configuration d'application partagée](GoToSocial_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) dans la solution **Créateur et publication de médias**.
