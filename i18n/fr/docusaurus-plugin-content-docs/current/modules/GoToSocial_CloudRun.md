---
title: "GoToSocial sur Google Cloud Run"
description: "Référence de configuration pour déployer GoToSocial sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/GoToSocial_CloudRun.md @ 3055034 sha256:4dfc04624e1f -->

# GoToSocial sur Google Cloud Run {#gotosocial-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoToSocial_CloudRun.png" alt="GoToSocial sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoToSocial est un serveur ActivityPub/Fediverse léger et auto-hébergé — une
petite alternative à Mastodon, écrite sous la forme d'un unique binaire Go
statique. Ce module déploie GoToSocial sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise GoToSocial et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité du service, ingress et équilibrage de charge, scaling et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoToSocial s'exécute sous la forme d'un conteneur contenant un unique binaire
Go sur Cloud Run v2, déployé directement à partir de l'image officielle
`docker.io/superseriousbusiness/gotosocial` — sans construction personnalisée.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go sur le port 8080, 2 vCPU / 4 GiB par défaut ; autoscaling serverless ; **`max_instance_count` fixé de manière stricte à 1** |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge. Base de données créée avec le classement obligatoire `LC_COLLATE='C' LC_CTYPE='C'` |
| Stockage d'objets | Cloud Storage | Un bucket `storage` + un compte de service HMAC dédié, utilisés sans condition via le client natif compatible S3 de GoToSocial — aucun montage GCS FUSE |
| Secrets | Secret Manager | `SUPERUSER_PASSWORD` et paire de clés d'accès/secrète HMAC S3 générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé via Cloud Armor en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 avec le classement `C` est obligatoire.** `database_type =
  "POSTGRES_15"` est la valeur par défaut, et le `validation.tf` de `GoToSocial_CloudRun`
  rejette au moment du plan tout `database_type` autre que Postgres. Le job `db-init`
  crée en outre la base de données avec `LC_COLLATE='C' LC_CTYPE='C'` —
  GoToSocial refuse de démarrer avec tout autre classement.
- **Image préconstruite, et non personnalisée.** `container_image_source = "prebuilt"`
  déploie directement `docker.io/superseriousbusiness/gotosocial`. Le dépôt
  amont de GoToSocial a migré vers Codeberg, mais le registre de conteneurs
  dans lequel il publie reste Docker Hub. Aucun point d'entrée enveloppant n'est
  nécessaire — la configuration passe entièrement par des variables
  d'environnement `GTS_*` distinctes que le binaire lit nativement.
- **Pas de job de migration.** GoToSocial crée et met à niveau son propre schéma
  automatiquement à chaque démarrage ; `db-init` se contente de préparer la base
  de données en classement C et le rôle.
- **`max_instance_count` est fixé de manière stricte à 1.** Le cache intégré au
  processus de GoToSocial ne dispose d'aucune synchronisation entre instances ;
  le projet amont ne prend pas en charge plusieurs instances sur la même base de
  données ou le même stockage. `min_instance_count = 0` (mise à l'échelle à zéro)
  est sans risque — la contrainte d'instance unique concerne la concurrence, et
  non le maintien à chaud entre les redémarrages.
- **Cloud SQL est joint en TCP chiffré sur l'IP privée, et non par un socket
  Unix.** Le mécanisme `db_host_env_var_name` d'`App_CloudRun` pointe toujours
  vers l'IP privée brute de Cloud SQL (et non vers le chemin de socket auquel
  `DB_HOST` se résout autrement sur Cloud Run) ; `GTS_DB_TLS_MODE` est donc
  remplacé par `"enable"` (chiffrer sans vérifier) plutôt que par `"disable"`,
  correct sur GKE — voir la §3 et le tableau des pièges.
- **Aucun montage GCS FUSE.** Le stockage des médias, avatars et pièces jointes
  utilise le client natif compatible S3 de GoToSocial, pointé vers le point de
  terminaison XML d'interopérabilité S3 de GCS via un compte de service HMAC
  dédié — et non un montage de système de fichiers.
- **Les sondes de santé sont TCP, et non HTTP.** Les points de terminaison
  `/readyz`/`/livez` de GoToSocial rejettent toute requête dépourvue d'en-tête
  `User-Agent` avec une réponse anti-scraping `418` — ni le sondeur HTTP de Cloud
  Run ni un `curl` nu n'en envoient. La sonde de vivacité est entièrement
  désactivée sur Cloud Run (son API rejette purement et simplement une sonde de
  vivacité sur socket TCP) ; seule la sonde de démarrage conditionne le trafic.
- **Aucun compte administrateur n'existe tant que vous n'avez pas déclenché
  manuellement `admin-create`.** GoToSocial ne propose aucun parcours
  d'inscription web pour le premier compte. Voir la §3 et le tableau des pièges.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
du service et des ressources figurent dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service GoToSocial {#a-cloud-run--the-gotosocial-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

GoToSocial stocke toutes les données de l'application (comptes, statuts,
abonnements, métadonnées des médias) dans une instance gérée Cloud SQL for
PostgreSQL 15, créée avec le classement obligatoire `C` par le job `db-init`. Le
service se connecte en TCP chiffré à l'IP privée de l'instance (voir la §3 pour
comprendre pourquoi, contrairement à la plupart des applications Cloud Run de ce
catalogue, il ne s'agit *pas* d'une connexion par socket Unix).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~gotosocial"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe figurent dans les [Sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage — médias, avatars, pièces jointes {#c-cloud-storage--media-avatars-attachments}

Un bucket **Cloud Storage** dédié (suffixe `storage`) et un compte de service
détenteur d'une **clé HMAC** sont provisionnés automatiquement, et le compte de
service de stockage reçoit `roles/storage.objectAdmin` sur le bucket.
Contrairement au stockage S3 facultatif présent ailleurs dans ce catalogue,
GoToSocial écrit dans ce bucket sans condition dès le premier démarrage —
`GTS_STORAGE_BACKEND=s3` n'est pas facultatif.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud storage ls gs://<storage-bucket>/
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse (non utilisé ici) et
les options CMEK.

### D. Secret Manager {#d-secret-manager}

Le conteneur principal de GoToSocial lit `SUPERUSER_PASSWORD` (uniquement via le
job `admin-create`, et non le serveur en cours d'exécution),
`GTS_STORAGE_S3_ACCESS_KEY` et `GTS_STORAGE_S3_SECRET_KEY` sous forme de
variables d'environnement adossées à des secrets. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gotosocial"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation, et la §2 de [GoToSocial_Common](GoToSocial_Common.md) pour comprendre
pourquoi ces secrets transitent par `secret_ids`/`module_secret_env_vars`, et
non par le champ (inactif) `secret_environment_variables` de l'objet de
configuration propre à l'application.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings
= "all"`, requis pour la fédération ActivityPub publique). Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application GoToSocial {#3-gotosocial-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `scripts/db-init.sh` à l'aide de `postgres:15-alpine`. Il
  attend que Cloud SQL accepte les connexions, puis crée de manière idempotente
  le rôle de l'application et la base de données avec
  `LC_COLLATE='C' LC_CTYPE='C'` (GoToSocial refuse de démarrer autrement),
  accorde les privilèges et se termine. Il peut être relancé sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration séparé.** GoToSocial migre son propre schéma
  automatiquement à chaque démarrage du serveur.
- **Le compte administrateur nécessite un déclenchement manuel — c'est le
  piège n° 1 de ce module pour les opérateurs.** GoToSocial ne propose ni
  parcours d'inscription web ni point de terminaison REST pour le tout premier
  compte — il s'agit d'une opération en CLI uniquement
  (`gotosocial admin account create` / `admin account promote`).
  Constaté en conditions réelles : la CLI panique avec `NewSignup: instance application not
  yet created, run the server at least once before creating users` sauf si le
  processus du serveur principal a déjà démarré avec succès au moins une fois.
  Les jobs d'initialisation de Cloud Run s'exécutent toujours *avant* que la
  première révision du service existe, si bien que `admin-create` est créé avec
  `execute_on_apply = false` à dessein — il ne peut pas réussir pendant
  l'`apply` initial. Une fois le service confirmé en bonne santé (voir la
  tâche 2 du lab), déclenchez-le manuellement :
  ```bash
  gcloud run jobs execute <service-name>-admin-create --region "$REGION" --project "$PROJECT" --wait
  ```
  Récupérez le mot de passe généré :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~superuser-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
- **`GTS_DB_TLS_MODE` vaut `"enable"` sur Cloud Run, et non `"disable"` ni
  `"require"` — une véritable asymétrie au niveau du socle.**
  L'implémentation de `db_host_env_var_name` d'`App_CloudRun` pointe toujours
  vers l'**IP privée** brute de Cloud SQL (`local.db_internal_ip`), et non vers
  le chemin de socket Unix auquel `DB_HOST` se résout autrement sur Cloud Run —
  bien que le nom et la description de la variable évoquent un « hôte ».
  (L'équivalent d'`App_GKE` est plus astucieux : il privilégie l'interface de
  bouclage `127.0.0.1` du sidecar cloud-sql-proxy, si bien que GKE conserve à
  juste titre `"disable"`.) Une connexion TCP brute sur l'IP privée de Cloud SQL
  exige le chiffrement ; `"disable"` simple échoue donc (« no encryption »).
  `"require"` n'est *pas* non plus la solution — constaté en conditions
  réelles, il exige une vérification complète du certificat (selon la
  documentation propre à GoToSocial : `"require"` = « un certificat valide doit
  être présenté »), qui échoue face au certificat de Cloud SQL (« x509: cannot
  validate certificate ... doesn't contain any IP SANs »). `"enable"` est la
  bonne valeur — la documentation de GoToSocial confirme qu'elle signifie « TLS
  sera tenté, mais le certificat de la base de données ne sera pas vérifié »
  (la sémantique classique de libpq `sslmode=require`-et-non-`verify-full`).
  `gotosocial.tf` définit ce remplacement via `module_env_vars`.
- **Chemin de santé — TCP uniquement, et pourquoi `curl` a besoin d'un
  `User-Agent`.** GoToSocial sert de véritables points de terminaison non
  authentifiés `/readyz` (`SELECT` sur la base de données, 500 en cas d'échec)
  et `/livez` (200 peu coûteux), mais tous deux rejettent toute requête sans
  en-tête `User-Agent` avec une réponse `418 I'm a teapot` — constaté en
  conditions réelles :
  `{"error": "I'm a teapot: no user-agent sent with request"}`. Ni le sondeur
  HTTP de Cloud Run ni un `curl` nu n'en envoient ; **chaque** commande de
  vérification manuelle sur cette application nécessite donc un indicateur
  explicite `-A`/`--user-agent` :
  ```bash
  curl -A "gotosocial-check/1.0" -s "$SERVICE_URL/readyz"
  ```
  La sonde de démarrage est en TCP sur le port 8080 ; la sonde de vivacité est
  entièrement désactivée (l'API de Cloud Run rejette purement et simplement une
  sonde de vivacité sur socket TCP).
- **Propagation de l'IAM du stockage.** GoToSocial panique au démarrage s'il ne
  peut pas joindre son backend de stockage S3. L'attribution de
  `roles/storage.objectAdmin` au compte de service de stockage est câblée sur la
  sortie `storage_buckets` propre au socle (et non sur un `depends_on`
  portant sur tout le module, qui provoquerait un interblocage) — mais lors d'un
  premier déploiement, le tout premier démarrage du conteneur peut encore entrer
  en concurrence avec le délai de propagation de l'attribution IAM, d'environ
  1–2 minutes. Il s'agit d'une nouvelle tentative ponctuelle attendue et
  occasionnelle, et non d'un bug.
- **Inspecter les jobs d'initialisation et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement (conformément au tag `{{UIMeta group=N}}` de chaque
variable dans `variables.tf`). Seuls les paramètres propres à GoToSocial ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par ex. `cr`) de celle de toute variante GKE déployée en parallèle (par ex. `gke`) — des variantes CR et GKE sur le même tenant entrent en collision sur le nom du service, les secrets et les buckets. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gotosocial` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `GoToSocial` | Nom lisible affiché dans la console. |
| `description` | `GoToSocial — a lightweight, self-hosted ActivityPub/Fediverse server` | Description du service. |
| `application_version` | `latest` | Tag de l'image Docker Hub. |
| `host` | `gotosocial.local` | `GTS_HOST` — le domaine public. Intégré à chaque URI ActivityPub au moment de sa création, **immuable après le premier démarrage**. Définissez votre domaine réel avant la mise en production. |
| `account_domain` | `""` | `GTS_ACCOUNT_DOMAIN` — domaine facultatif pour les identifiants personnalisés, distinct de `host`. Vaut `host` par défaut lorsqu'il est vide. Même risque d'immuabilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle de Docker Hub. `custom` est pris en charge mais inutile — GoToSocial n'a besoin d'aucune enveloppe. |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour utiliser l'image GoToSocial par défaut. |
| `cpu_limit` | `2000m` | 2 vCPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro — sans risque pour GoToSocial (contrainte de concurrence, et non de maintien à chaud). |
| `max_instance_count` | `1` | **Plafond architectural strict** — le cache intégré au processus de GoToSocial ne dispose d'aucune synchronisation entre instances. Ne l'augmentez pas. |
| `container_port` | `8080` | Valeur par défaut native de `GTS_PORT` dans GoToSocial. |
| `cpu_always_allocated` | `false` | Facturation à la requête — le cœur requête/réponse de GoToSocial ne comporte aucun processus worker d'arrière-plan distinct ayant besoin de CPU entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS Fuse/NFS (inutilisés par la configuration par défaut de GoToSocial, mais cohérent avec le catalogue). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `true` | Injecte le montage du socket Cloud SQL Auth Proxy, bien que GoToSocial se connecte de toute façon en TCP à l'IP privée (voir la §3) — le montage est inutilisé par le chemin d'accès à la base de données de cette application, mais il est sans danger de le laisser activé. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Docker Hub dans Artifact Registry (évite les limites de débit de téléchargement de Docker Hub). |

### Groupe 5 — Accès, réseau {#group-5--access-networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Obligatoire — la fédération comme l'accès des clients nécessitent une accessibilité publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque la fédération** — uniquement adapté à une instance entièrement privée. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair fusionnées avec les valeurs par défaut de `GoToSocial_Common`. |
| `secret_environment_variables` | `{}` | Références de secrets destinées à l'opérateur — distinctes du mécanisme `secret_ids` qu'utilise `GoToSocial_Common` lui-même, avec lequel il ne faut pas les confondre (voir la §2 de [GoToSocial_Common](GoToSocial_Common.md)). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Exécution standard de scripts SQL personnalisés d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés — doivent correspondre à `host`. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS — utile pour la diffusion des médias. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définis)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée des buckets GCS — `gotosocial.tf` fournit le véritable bucket `storage` via la sortie de `GoToSocial_Common`, en remplaçant la valeur par défaut générique `data` de cette variable. |
| `enable_nfs` | `true` | Provisionne Filestore. **Non utilisé par GoToSocial** — le stockage des médias passe par le client S3 natif, et non par un montage. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse. Non utilisés par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Validé au moment du plan** — `validation.tf` rejette tout ce qui n'est pas PostgreSQL 13/14/15 ou `NONE`. |
| `db_name` | `gotosocial` | La base de données réellement créée (avec le classement `C`) et injectée sous la forme de `GTS_DB_DATABASE`. Immuable après le premier déploiement. |
| `db_user` | `gotosocial` | Le rôle réellement créé et injecté sous la forme de `GTS_DB_USER` ; mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `GTS_DB_ADDRESS` / `GTS_DB_PORT` / `GTS_DB_USER` / `GTS_DB_DATABASE` / `GTS_DB_PASSWORD` | **Définies par `main.tf`, et non laissées à leurs valeurs par défaut génériques vides** — c'est ce mécanisme qui permet au binaire GoToSocial de lire ses propres noms `GTS_DB_*` tout en recevant les valeurs de la génération standard `DB_*` du socle. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la paire intégrée `db-init` + `admin-create` fournie par `GoToSocial_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme n'est définie pour GoToSocial. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, `/readyz` (chemin purement informatif), `initial_delay_seconds=15`, `failure_threshold=10` | Le seul type de sonde qui fonctionne avec les points de terminaison de santé de GoToSocial conditionnés par le User-Agent. |
| `liveness_probe` | `enabled = false` | Désactivée — l'API de Cloud Run rejette purement et simplement les sondes de vivacité TCP ; seule la sonde de démarrage conditionne le trafic. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, variable | Sondes structurées alternatives ; remplacées par `startup_probe`/`liveness_probe` ci-dessus pour ce module. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut (il faudrait aussi un vérificateur envoyant un `User-Agent` pour réussir sur `/readyz`/`/livez` — un simple test sur `/` est ici la valeur par défaut la plus sûre). |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | GoToSocial ne dépend en rien de Redis — son cache est intégré au processus. Laissez `false`. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (l'IP privée de Cloud SQL sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de médias `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux de notification, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `admin-create`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. `GoToSocial_CloudRun` ajoute lui-même des contrôles dans `validation.tf` pour `min_instance_count > max_instance_count`, Redis activé sans hôte et un `database_type` autre que PostgreSQL — ainsi, contrairement à certains modules de ce catalogue, l'erreur MySQL **est** détectée ici au moment du plan, et pas seulement à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `host` (`GTS_HOST`) | Définissez votre domaine réel avant le premier déploiement | Critique | Intégré à chaque URI d'acteur/objet ActivityPub au moment de sa création ; le modifier une fois que de vrais comptes ou publications existent casse la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `max_instance_count` | `1` (ne pas augmenter) | Critique | Le cache intégré au processus de GoToSocial ne dispose d'aucune synchronisation entre instances ; le projet amont ne prend pas en charge plusieurs instances sur la même base de données ou le même stockage — l'augmenter provoque des incohérences de données et de cache, et pas seulement un surcoût. |
| `GTS_DB_TLS_MODE` | `enable` (défini automatiquement par `gotosocial.tf` ; ne le remplacez pas par `disable`/`require`) | Critique | `disable` échoue purement et simplement sur le chemin TCP vers l'IP privée de Cloud SQL sur Cloud Run (pas de chiffrement) ; `require` échoue à la vérification du certificat de Cloud SQL (pas d'IP SAN) — seul `enable` (chiffrer sans vérifier) fonctionne ici. |
| `database_type` | `POSTGRES_15` | Critique | Validé au moment du plan par le `validation.tf` propre à `GoToSocial_CloudRun` — MySQL/SQL Server sont rejetés avant l'application, contrairement à d'autres modules de ce catalogue. |
| Câblage IAM du stockage (`google_storage_bucket_iam_member`) | Laissez tel que livré (référence `module.app_cloudrun.storage_buckets["storage"]`) | Critique | GoToSocial panique au démarrage sans accès S3. Une alternative `depends_on = [module.app_cloudrun]` provoquerait un interblocage du déploiement avec son propre prérequis IAM. |
| Sondes de santé (`startup_probe`/`liveness_probe`) | Laissez `type = "TCP"` | Élevé | Les points de terminaison `/readyz`/`/livez` de GoToSocial rejettent toute requête sans en-tête `User-Agent` (`418`) ; passer à `type = "HTTP"` fait échouer la sonde indéfiniment quel que soit le chemin, car le sondeur de Cloud Run n'en envoie jamais. |
| Job `admin-create` | À déclencher manuellement après le déploiement | Élevé | GoToSocial ne propose aucun parcours d'inscription web pour le premier compte, et le job ne peut pas s'exécuter au moment de l'application sur Cloud Run (les jobs d'initialisation précèdent toujours la première révision) — sauter cette étape laisse l'instance sans aucun compte administrateur utilisable. |
| `curl` manuel / contrôles de santé | Passez toujours `-A "<agent>"` | Moyen | Un `curl` nu (et la plupart des clients HTTP et outils de surveillance par défaut) reçoit `418 I'm a teapot` de la barrière User-Agent anti-scraping de GoToSocial, même sur des points de terminaison « non authentifiés » — facile à confondre avec une panne. |
| `enable_redis` | `false` (par défaut) | Faible | GoToSocial ne dépend pas de Redis ; le laisser à `true` n'a aucun effet fonctionnel mais ajoute une configuration inutile dépendant de NFS. |
| `db_host_env_var_name` / `db_port_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | Laissez tels que livrés (alias `GTS_DB_*` définis dans `main.tf`) | Critique | Ce sont eux qui permettent au binaire de GoToSocial de lire les informations de connexion à la base de données fournies par le socle — les remplacer casse entièrement la connexion à la base de données. |
| `enable_iap` | `false` pour une instance publique | Moyen | IAP bloque le trafic de fédération ActivityPub non authentifié — uniquement adapté à une instance entièrement privée ou de test. |
| Propagation de l'IAM du stockage au premier déploiement | Attendez-vous à une éventuelle nouvelle tentative ponctuelle | Faible | Lors d'un nouveau déploiement, le tout premier démarrage du conteneur peut entrer en concurrence avec la propagation de l'attribution IAM du compte de service de stockage (~1–2 minutes) ; l'application se rétablit à la révision ou à la tentative suivante sans aucune modification de configuration. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité
du service, scaling et concurrence, ingress et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à GoToSocial, partagée avec la variante GKE (secrets, jobs `db-init`/
`admin-create` et compte de service de stockage), est définie dans
**[GoToSocial_Common](GoToSocial_Common.md)** (source du module :
`modules/GoToSocial_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoToSocial sur Cloud Run](../labs/GoToSocial_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [GoToSocial sur GKE Autopilot](GoToSocial_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoToSocial Common — Configuration applicative partagée](GoToSocial_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md) et [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) dans la solution **Creator & Media Publishing**.
