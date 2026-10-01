---
title: "Documenso sur Google Cloud Run"
description: "Référence de configuration pour déployer Documenso sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Documenso_CloudRun.md @ 3055034 sha256:07c6ec3aaa3b -->

# Documenso sur Google Cloud Run {#documenso-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Documenso_CloudRun.png" alt="Documenso sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Documenso est une alternative open source à DocuSign — une application Next.js pour
envoyer, signer et gérer des documents à signature électronique sur une infrastructure
que vous contrôlez. Ce module déploie Documenso sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise Documenso et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
ingress et équilibrage de charge, mise à l'échelle et simultanéité, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Documenso s'exécute comme un unique conteneur Next.js sur Cloud Run v2, construit à
partir d'une image personnalisée légère reposant sur l'image officielle
`documenso/documenso`. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Next.js sur le port 3000, 1 vCPU / 2 GiB par défaut ; autoscaling serverless, mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut, monté à `/mnt/nfs`, mais non utilisé pour le stockage des documents (voir ci-dessous) |
| Stockage d'objets | Cloud Storage | Un bucket `uploads` + un compte de service HMAC, provisionnés pour un transport de téléversement facultatif compatible S3 |
| Secrets | Secret Manager | `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, clés HMAC et (facultativement) mot de passe SMTP générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs via Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est la valeur par
  défaut. La pile Next.js + Prisma de Documenso ne prend pas en charge MySQL, mais —
  contrairement à certains autres modules — cela **n'est pas imposé par une précondition
  au moment du plan**, ni au niveau de `Documenso_CloudRun` ni à celui d'`App_CloudRun` ;
  remplacer `database_type` par un autre moteur que Postgres casse silencieusement
  l'application à l'exécution au lieu de faire échouer le plan.
- **Build personnalisé, pas d'image préconstruite.** `container_image_source = "custom"`
  construit une image légère `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` qui
  ajoute `bash`, `curl`, `postgresql-client` et `openssl`, ainsi qu'un point d'entrée
  personnalisé. Le `sh start.sh` propre à l'image officielle exécute les migrations Prisma
  et démarre le serveur Next.js — il n'y a pas de tâche de migration distincte.
- **Cloud SQL est joint via un socket Unix, pas via un proxy TCP.** `enable_cloudsql_volume
  = true` monte le Cloud SQL Auth Proxy sous forme de socket de domaine Unix à
  `/cloudsql` ; le point d'entrée assemble `NEXT_PRIVATE_DATABASE_URL` à partir des valeurs
  `DB_*` injectées, en bifurquant entre chemin de socket, proxy `127.0.0.1` (GKE
  uniquement) ou IP directe + SSL selon ce qui est injecté.
- **Redis n'est pas nécessaire, et la variable `enable_redis` propre au module est en
  pratique décorative.** Documenso utilise un fournisseur de tâches local reposant sur
  PostgreSQL ; il ne lit donc jamais `REDIS_HOST`/`REDIS_PORT`. Plus important encore,
  les variables `enable_redis`/`redis_host`/`redis_port`/`redis_auth` de
  `Documenso_CloudRun` ne sont transmises qu'à `Documenso_Common` (qui ne les utilise pas
  non plus) et ne sont **jamais** passées à l'appel du socle `App_CloudRun` dans
  `main.tf`. La propre variable `enable_redis` du socle **vaut `true` par défaut**, si bien
  que `REDIS_HOST`/`REDIS_PORT` (pointant vers l'IP du serveur NFS, puisque `enable_nfs`
  est lui aussi activé par défaut) sont injectés dans chaque déploiement Documenso quel
  que soit le paramètre `enable_redis` de ce module — sans conséquence puisque Documenso
  les ignore, mais bon à savoir si vous auditez les variables d'environnement.
- **NFS est activé par défaut, mais Documenso ne l'utilise pas pour les documents.**
  Les documents sont stockés par défaut dans PostgreSQL
  (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`). L'instance Filestore ainsi provisionnée
  est facturée, qu'elle reçoive des écritures ou non.
- **Un certificat de signature est nécessaire pour réellement signer des documents.**
  `NEXT_PRIVATE_SIGNING_TRANSPORT = "local"` attend un certificat `.p12`. Si aucun n'est
  fourni, le point d'entrée génère lui-même un certificat autosigné jetable afin que
  l'application démarre quand même — mais signer avec celui-ci n'est pas adapté à la production.
- **`webapp_url` est vide par défaut.** Tant qu'elle n'est pas définie, `NEXTAUTH_URL` et
  `NEXT_PUBLIC_WEBAPP_URL` valent par défaut `http://localhost:3000` ; le point d'entrée
  les remplace automatiquement au démarrage par `CLOUDRUN_SERVICE_URL` injectée par la
  plateforme, mais il est recommandé de définir explicitement `webapp_url` dès qu'une URL
  ou un domaine stable est connu.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0`,
  `max_instance_count = 1`. Les démarrages à froid ajoutent de la latence à la première
  requête après une période d'inactivité.
- **La sonde de démarrage est TCP, la sonde de vivacité est désactivée.** Documenso
  n'expose aucun point de terminaison de santé dédié ; la sonde de démarrage se fonde donc
  sur l'ouverture du port plutôt que sur un chemin HTTP, et la sonde de vivacité est
  désactivée pour éviter de redémarrer en boucle un conteneur sain.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Documenso {#a-cloud-run--the-documenso-service}

Documenso s'exécute comme un service Cloud Run v2 qui se met automatiquement à l'échelle
selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la simultanéité,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Documenso stocke toutes les données de l'application (utilisateurs, documents,
destinataires, événements d'audit) dans une instance gérée Cloud SQL for PostgreSQL 15.
Le service s'y connecte de façon privée via le **Cloud SQL Auth Proxy** sur un socket
Unix ; aucune IP publique n'est exposée. Lors du premier déploiement, la tâche `db-init`
crée le rôle et la base de données de l'application ; l'image officielle de Documenso
exécute ensuite ses propres migrations Prisma au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~documenso"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation du mot de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `uploads`, CORS activé pour un accès direct
depuis le navigateur) et un compte de service détenant une **clé HMAC** sont provisionnés
automatiquement, le compte de service de stockage recevant `roles/storage.objectAdmin`
sur le bucket. Il s'agit d'une infrastructure à activer explicitement : Documenso n'y
écrit que si vous définissez `NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` et câblez les variables
d'environnement secrètes `S3_ACCESS_KEY` / `S3_SECRET_KEY` — par défaut, les documents
sont stockés dans PostgreSQL. Par ailleurs, un volume **NFS (Cloud Filestore)** est monté
à `/mnt/nfs`, mais l'application n'y écrit pas dans sa configuration par défaut.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Documenso a besoin de trois secrets au démarrage — `NEXTAUTH_SECRET`,
`NEXT_PRIVATE_ENCRYPTION_KEY` et `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` — tous validés
par Zod dans l'application Next.js, qui ne démarre pas sans eux. Sont en outre générés
`S3_ACCESS_KEY` / `S3_SECRET_KEY` (identifiants HMAC, utilisés uniquement si le transport
de téléversement S3 est activé) et, lorsque `smtp_host` est défini,
`NEXT_PRIVATE_SMTP_PASSWORD`. Le mot de passe de la base de données est géré séparément
par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~documenso"
  gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`, qui autorise l'accès public.
Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté ; les paramètres d'ingress et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Documenso {#3-documenso-application-behaviour}

- **Configuration de la base de données au premier déploiement.** La tâche `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Elle attend que Cloud SQL accepte les
  connexions, puis crée de façon idempotente le rôle et la base de données de
  l'application (privilège `CREATEDB`, propriété définie sur la base cible), accorde les
  privilèges sur le schéma et signale enfin au sidecar Cloud SQL Auth Proxy (`POST
  /quitquitquit`) de s'arrêter afin que la tâche puisse se terminer. La tâche peut être
  relancée sans risque (`execute_on_apply = true`, `max_retries = 3`).
- **Les migrations s'exécutent automatiquement, sans tâche distincte.** Le `start.sh`
  propre à l'image officielle de Documenso exécute les migrations Prisma sur
  `NEXT_PRIVATE_DATABASE_URL` à chaque démarrage du conteneur, puis lance le serveur
  Next.js autonome.
- **`NEXT_PRIVATE_DATABASE_URL` est assemblée au démarrage.** Le point d'entrée
  personnalisé la construit à partir de `DB_USER`/`DB_PASSWORD`/`DB_HOST`/
  `DB_NAME`/`DB_PORT` injectés par la plateforme, en bifurquant selon que `DB_HOST` est un
  chemin de socket Unix (le cas normal sur Cloud Run, `enable_cloudsql_volume = true`), une
  boucle locale Auth Proxy `127.0.0.1` (GKE uniquement) ou une IP directe (auquel cas
  `sslmode=require` est imposé). `NEXT_PRIVATE_DIRECT_DATABASE_URL` en est le reflet.
- **Trois secrets sont immuables en pratique.** `NEXTAUTH_SECRET` et les deux clés de
  chiffrement sont validés par Zod au démarrage et générés une seule fois dans Secret
  Manager. `NEXTAUTH_SECRET` peut être renouvelé (ce qui invalide les sessions) ;
  `NEXT_PRIVATE_ENCRYPTION_KEY` ne doit jamais être régénérée sur place — ne la faites
  tourner que via l'emplacement de la clé secondaire.
- **Aucun compte administrateur d'amorçage.** Ce module ne crée pas d'utilisateur
  administrateur/propriétaire Documenso. La première personne qui termine l'inscription via
  l'interface web de l'application devient le propriétaire du compte — comportement
  standard de Documenso en amont, et non quelque chose que provisionne ce module.
- **Le certificat de signature est une étape post-déploiement obligatoire pour une
  signature réelle.** En l'absence de certificat, le point d'entrée génère lui-même un
  `.p12` autosigné jetable à `/opt/documenso/cert.p12` afin que l'application démarre et
  que les fonctionnalités hors signature fonctionnent, en journalisant un avertissement
  bien visible. Pour une signature en production, fournissez un véritable certificat via
  `secret_environment_variables` en associant `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`
  (`.p12` encodé en base64) et `NEXT_PRIVATE_SIGNING_PASSPHRASE`.
- **Résolution de l'URL de l'application web.** `NEXTAUTH_URL` / `NEXT_PUBLIC_WEBAPP_URL`
  valent par défaut `http://localhost:3000`. Si elles ont toujours cette valeur au démarrage
  du conteneur, le point d'entrée les remplace toutes deux par `CLOUDRUN_SERVICE_URL`
  injectée par la plateforme. Définissez explicitement `webapp_url` dès que l'URL Cloud Run
  ou un domaine personnalisé est connu, afin que les liens OAuth/e-mail restent stables d'un
  redéploiement à l'autre.
- **Chemin de santé.** La sonde de démarrage est une sonde **TCP** sur le port 3000 (délai
  initial de 30s, période de 20s, 10 échecs autorisés) — elle réussit dès que le conteneur
  ouvre son port, car l'alternative HTTP exigerait que l'application et la base de données
  soient entièrement prêtes et risquerait de ne jamais réussir. La sonde de vivacité est
  **désactivée** par défaut ; Documenso n'a pas de point de terminaison de santé dédié.
- **Inspectez le job d'initialisation et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement (conformément au tag `{{UIMeta group=N}}` de chaque variable dans
`variables.tf`). Seuls les paramètres propres à Documenso ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec
leur comportement standard.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` / `module_documentation` / `module_dependency` / `module_services` | _(défini)_ | Texte de la fiche du catalogue et ordre des dépendances. Lus par la plateforme, non appliqués par Terraform. |
| `requires_services` | `{ create_postgres = true, create_network_filesystem = true, ... }` | Indique à la plateforme quels interrupteurs `create_*` de `Services_GCP` activer lorsqu'elle le provisionne automatiquement pour ce module. |
| `credit_cost` / `require_credit_purchases` | `75` / `false` | Métadonnées de facturation de la plateforme. |
| `enable_purge` | `true` | Autorise la suppression complète des ressources lors de la destruction. |
| `public_access` | `true` | Fait figurer le module dans le catalogue public. |
| `require_services_gcp_module` | `true` | Une fonctionnalité d'`App_CloudRun` — fait échouer le plan si aucun VPC `Services_GCP` n'existe — mais cette variable n'est **pas transmise** à `App_CloudRun` ici ; elle n'a donc aucun effet au niveau de ce module. |
| `shared_users` | `[]` | **Effectivement appliquée par la plateforme** (contrairement à la plupart des variables du groupe 0) : les utilisateurs listés ici obtiennent l'accès quelle que soit la valeur de `public_access`. |
| `technical_support_users` | `[]` | Achemine les demandes de support pour ce module vers ces utilisateurs. |
| `resource_creator_identity` | `rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com` | Compte de service qu'utilise Terraform pour créer les ressources ; transmis à `App_CloudRun`. |
| `impersonation_service_account` / `job_execution_wait_timeout` / `module_writable_secret_ids` | `""` / `900` / `{}` | Déclarées par souci de cohérence avec les conventions ; **non transmises** nulle part dans `main.tf` — les définir n'a aucun effet. |

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `documenso` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Documenso` | Nom lisible affiché dans la console. |
| `description` | `Documenso - The Open Source DocuSign Alternative` | Description du service. |
| `application_version` | `latest` | Définit l'argument de build `DOCUMENSO_VERSION` pour l'image de base du build personnalisé `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}`. |
| `webapp_url` | `""` | URL publique de l'instance. À définir après le premier déploiement (ou dès qu'un domaine personnalisé est enregistré) afin que les callbacks NextAuth et les liens des e-mails soient stables. Tant qu'elle n'est pas définie, le point d'entrée remplace `localhost:3000` par la `CLOUDRUN_SERVICE_URL` active à chaque démarrage. |
| `application_display_name` / `application_description` | (valeurs par défaut du socle) | Équivalents, selon la convention du socle, de `display_name`/`description`. **Déclarées mais non transmises** — utilisez plutôt `display_name`/`description`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image d'encapsulation légère via Cloud Build. `prebuilt` déploie directement l'image officielle (sans point d'entrée, si bien que `NEXT_PRIVATE_DATABASE_URL` et le certificat de signature de repli ne seraient pas assemblés). |
| `container_image` | `""` | URI d'image de remplacement ; laissez vide pour utiliser l'image Documenso intégrée. |
| `container_build_config` | `{ enabled = true }` | Configuration Cloud Build ; `Documenso_Common` fournit `dockerfile_path`/`context_path`/`build_args` (`DOCUMENSO_VERSION`). |
| `cpu_limit` | `1000m` | 1 vCPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; le plancher de Cloud Run gen2 est de 512Mi quel que soit le mode de facturation. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Plafond de coût ; Documenso n'a pas de mise en garde documentée concernant plusieurs instances, contrairement à Listmonk/Activepieces, mais augmentez-le avec prudence. |
| `container_port` | `3000` | Port du serveur Next.js de Documenso. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Doit être défini à `true`** pour le chemin de connexion à la base de données par socket Unix utilisé par défaut par le point d'entrée ; le module est livré avec cette valeur par défaut à `false`, contrairement à la plupart des modules adossés à une base de données (voir [Pièges](#6-configuration-pitfalls--sensible-defaults)). |
| `enable_image_mirroring` | `true` | Met en miroir l'image Documenso dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements par étapes. |
| `container_protocol` | `http1` | `http1` ou `h2c`. Documenso n'a pas besoin de HTTP/2 en clair. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin, dans le conteneur, du socket Unix du Cloud SQL Auth Proxy ; pertinent uniquement lorsque `enable_cloudsql_volume = true`. |
| `service_annotations` / `service_labels` | `{}` | Annotations/libellés avancés du service Cloud Run. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Équivalent, selon la convention du socle, de `cpu_limit`/`memory_limit`. **Déclarée mais non transmise** — utilisez plutôt ces dernières. |
| `additional_containers` / `additional_services` | `[]` | Conteneurs sidecar / services Cloud Run supplémentaires. **Déclarées mais non transmises à `App_CloudRun`** — ce module ne déploie aucun sidecar ni service supplémentaire, quels que soient ces paramètres. |
| `max_revisions_to_retain` | `7` | Déclarée par souci de cohérence avec les conventions ; non référencée par le déploiement de ce module. |

### Groupe 5 — Accès, réseau et e-mail {#group-5--access-networking--email}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all`, `internal` ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `prereq_subnet_cidr_override` | `""` | Remplacement du CIDR du sous-réseau principal du VPC intégré (inline), pertinent uniquement lorsqu'aucun réseau `Services_GCP` n'existe. Laissez vide pour dériver automatiquement un `/24` unique. |
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP. Laissez vide pour désactiver l'e-mail (invitations, notifications de signature). |
| `smtp_port` / `smtp_secure_enabled` | `587` / `false` | Utilisez `465` + `true` pour le TLS implicite ; sinon STARTTLS sur `587`. |
| `smtp_user` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | `""` | Génère automatiquement une valeur Secret Manager lorsqu'il est laissé vide et que `smtp_host` est défini. |
| `mail_from` | `""` | Adresse de l'expéditeur ; se rabat sur `noreply@documenso.local` lorsque `smtp_host` est défini mais que ce champ est vide. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Clés SMTP de substitution (`EMAIL_SMTP_*`) | Jeu de valeurs par défaut hérité du modèle partagé du module ; Documenso lit lui-même les noms `NEXT_PRIVATE_SMTP_*` assemblés à partir des variables `smtp_*` du groupe 5, et non ces clés `EMAIL_SMTP_*` — les définir directement n'a aucun effet sur l'envoi d'e-mails de Documenso. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. **C'est ici que vous câblez un véritable certificat de signature** : `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (`.p12` en base64) et `NEXT_PRIVATE_SIGNING_PASSPHRASE`. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Planification cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Durée de conservation ; augmentez-la pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Équivalent, selon la convention du socle, du nom du fichier de sauvegarde. **Déclarée mais non transmise** — utilisez plutôt `backup_uri`. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `binauthz_evaluation_mode` | `ALWAYS_ALLOW` | Mode d'application lorsque `enable_binary_authorization` vaut true et que `Services_GCP` n'a pas préconfiguré de règle. Non référencée — n'a aucun effet sur le déploiement de ce module. |

### Groupe 9 — Scripts SQL personnalisés et ciblage de l'instance NFS {#group-9--custom-sql-scripts--nfs-instance-targeting}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécute du SQL depuis un bucket GCS après le provisionnement. Consultez [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` | `""` | Cible directement une VM GCE NFS existante au lieu d'en découvrir une automatiquement. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base d'une VM NFS intégrée lorsqu'aucune n'est trouvée. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes/Cloud Run pour le montage NFS. À remplacer uniquement pour un second partage NFS avec un nom de volume distinct. |

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | un bucket `data` | Remplacée en pratique : `documenso.tf` fournit le véritable bucket `uploads` (CORS activé) via la sortie `storage_buckets` de `Documenso_Common`, et non via la valeur par défaut de cette variable. |
| `enable_nfs` | `true` | Provisionne Filestore par défaut. Non utilisé pour le stockage des documents — voir la [vue d'ensemble](#1-overview). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (inutilisé par la configuration par défaut de l'application). |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (requiert gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Validée au moment du plan à aucun niveau** — remplacer Postgres par un autre moteur casse le schéma Prisma de Documenso à l'exécution au lieu de faire échouer `tofu plan`. |
| `db_name` | `documenso` | La base de données réellement créée et injectée en tant que `DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `documenso` | Le rôle réellement créé et injecté en tant que `DB_USER` ; mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Cible une instance Cloud SQL existante ou nomme une instance intégrée. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Déclarées par souci de cohérence avec les conventions mais **non transmises** nulle part dans `main.tf` ni `documenso.tf` — les définir n'a aucun effet. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Équivalents, selon la convention du socle, de `db_name`/`db_user`. **Déclarées mais non transmises** — utilisez plutôt `db_name`/`db_user`. |
| `db_password_env_var_name` | `""` | Nom de variable d'environnement supplémentaire pour exposer le mot de passe de la base de données en plus de `DB_PASSWORD`. **Déclarée mais non transmise** — sans effet. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Installe des plugins MySQL après le provisionnement. Documenso fonctionne uniquement avec PostgreSQL et aucune de ces variables n'est transmise — sans effet. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installe des extensions PostgreSQL après le provisionnement. **Déclarées mais non transmises** — sans effet pour ce module. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée fournie par `Documenso_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme n'est définie pour Documenso. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 3000, `initial_delay_seconds=30`, `failure_threshold=10` | Sonde propre à Documenso, transmise via la sortie `config` de `Documenso_Common`. TCP plutôt que HTTP, car aucun point de terminaison HTTP ne signale de façon fiable que l'application est entièrement prête sans risquer une sonde en échec permanent. |
| `liveness_probe` | `enabled = false` | Désactivée — une sonde HTTP sur `/` redémarrerait en boucle un conteneur sain avant que l'application soit prête. |
| `startup_probe_config` | désactivée | Sonde structurée alternative (désactivée par défaut ; c'est `startup_probe` qui s'applique). |
| `health_check_config` | HTTP `/` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 21 — Redis / file d'attente de tâches {#group-21--redis--job-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Non transmise à `App_CloudRun`.** Uniquement passée à `Documenso_Common`, qui ne la référence pas non plus — cette variable n'a aucun effet sur le service déployé. Documenso utilise un fournisseur de tâches local reposant sur PostgreSQL et ne lit jamais `REDIS_HOST`. La propre variable `enable_redis` du socle (par défaut `true`, non exposée ici) injecte malgré tout `REDIS_HOST`/`REDIS_PORT` — voir la [vue d'ensemble](#1-overview). |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Même réserve — inertes au niveau de ce module. |
| `cubejs_api_url` | `http://localhost:4000` | Reliquat inerte du modèle de variables partagé à partir duquel ce module a été cloné (URL de l'API Cube.js — un concept étranger à Documenso) ; lue par aucun Dockerfile, point d'entrée ni mappage d'environnement de ce module. |
| `hub_api_url` | `http://localhost:8080` | Idem — reliquat inerte, lu nulle part dans ce module. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (requiert `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via le socket de l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — `min_instance_count > max_instance_count`, IAP activé sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource. `Documenso_CloudRun` n'ajoute lui-même aucun `validation.tf` au-delà des contrôles par variable de `variables.tf` — si bien qu'un `database_type` autre que Postgres n'est détecté à **aucun** niveau, seulement à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Non validé au moment du plan, ni par ce module ni par le socle — passer à MySQL/SQL Server casse Prisma et toutes les requêtes à l'exécution. |
| Certificat de signature (`NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`) | Fournir un véritable `.p12` après le déploiement | Critique | Sans lui, le point d'entrée autosigne un certificat jetable — les documents sont « signés », mais la signature n'est pas reconnue comme fiable par les lecteurs PDF ; inadapté à la production. |
| `NEXT_PRIVATE_ENCRYPTION_KEY` / `_SECONDARY_KEY` (générées automatiquement) | Ne jamais les modifier directement | Critique | Elles chiffrent les données de Documenso ; ne les faites tourner que via l'emplacement de la clé secondaire, jamais en régénérant la clé principale sur place. |
| `enable_cloudsql_volume` | `true` | Critique | Vaut `false` par défaut dans ce module, mais la branche de connexion à la base de données utilisée par défaut par le point d'entrée attend le socket Unix du Cloud SQL Auth Proxy à `/cloudsql`. Laisser `false` tout en s'appuyant sur le chemin de connexion par défaut peut empêcher l'application de joindre la base de données via un socket. |
| `db_name` / `db_user` | À définir une seule fois | Élevé | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `webapp_url` | À définir dès que l'URL/le domaine est connu | Élevé | Si elle n'est pas définie, `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` suivent la valeur à laquelle se résout `CLOUDRUN_SERVICE_URL` à chaque démarrage ; une valeur explicite garde les callbacks d'authentification et les liens des e-mails stables d'un redéploiement à l'autre. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | Laisser non définies | Faible | Déclarées mais jamais transmises à aucun module — les définir n'a strictement aucun effet. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | Laisser tel quel | Faible | Non transmises à `App_CloudRun` ; la propre variable `enable_redis` du socle (par défaut `true`, non exposée par ce module) injecte malgré tout `REDIS_HOST`/`REDIS_PORT` — Documenso les ignore dans tous les cas ; il s'agit donc d'un piège de documentation, pas d'un risque fonctionnel. |
| `cubejs_api_url` / `hub_api_url` | Laisser la valeur par défaut | Faible | Reliquats inertes du modèle de variables partagé ; Documenso ne les lit jamais. |
| Valeur par défaut d'`environment_variables` (clés `EMAIL_SMTP_*`) | Utiliser plutôt `smtp_host`/`smtp_user`/etc. | Moyen | Les clés `EMAIL_SMTP_*` de la correspondance par défaut ne sont pas lues par Documenso — configurez l'e-mail via les variables `smtp_*` du groupe 5, que `Documenso_Common` traduit en `NEXT_PRIVATE_SMTP_*`. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| `enable_nfs` | `true` (par défaut) ou `false` s'il n'est pas nécessaire | Moyen | Filestore est facturé que l'application y écrive ou non ; Documenso n'utilise pas le montage NFS dans sa configuration par défaut. |
| `smtp_host` | À définir pour la production | Moyen | S'il est laissé vide, aucune variable `NEXT_PRIVATE_SMTP_*` n'est injectée — aucun e-mail d'invitation ni de notification de signature n'est envoyé. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |
| `container_image_source` | `custom` (par défaut) | Élevé | Passer à `prebuilt` déploie directement l'image officielle, en contournant le point d'entrée personnalisé qui assemble `NEXT_PRIVATE_DATABASE_URL`, résout l'URL de l'application web et génère lui-même un certificat de signature de repli. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et simultanéité, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Documenso,
partagée avec la variante GKE (secrets, tâche `db-init` et point d'entrée personnalisé),
est définie dans `Documenso_Common` (source du module : `modules/Documenso_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Documenso sur Cloud Run](../labs/Documenso_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Documenso sur GKE Autopilot](Documenso_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Documenso Common — Configuration applicative partagée](Documenso_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[OpenProject sur Google Cloud Run](OpenProject_CloudRun.md), de [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), de [Kimai sur Google Cloud Run](Kimai_CloudRun.md) et d'[Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
