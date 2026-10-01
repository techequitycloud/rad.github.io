---
title: "Passbolt sur Google Cloud Run"
description: "Référence de configuration pour déployer Passbolt sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Passbolt_CloudRun.md @ 3055034 sha256:7a05b286b7c2 -->

# Passbolt sur Google Cloud Run {#passbolt-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Passbolt_CloudRun.png" alt="Passbolt sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Passbolt (Community Edition) est un gestionnaire de mots de passe gratuit, open
source et orienté équipe, avec un chiffrement fondé sur GPG et un partage
d'identifiants par utilisateur et par groupe — sous licence AGPL-3.0, environ
6 000 étoiles sur GitHub. Il occupe une niche différente du module `Vaultwarden`
de ce catalogue : Vaultwarden est un coffre personnel compatible Bitwarden,
tandis que Passbolt est conçu autour du partage d'identifiants chiffrés par GPG
entre utilisateurs et groupes à l'échelle de l'organisation. Ce module déploie
l'image officielle `passbolt/passbolt` sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Passbolt et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Passbolt s'exécute comme un unique conteneur Apache/PHP sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Apache/PHP, port `80`, 1 vCPU / 2Gi par défaut, `min_instance_count = 0` (mise à l'échelle à zéro) |
| Base de données | Cloud SQL for MySQL (`MYSQL_8_0`) | Obligatoire — Passbolt est une application CakePHP exclusivement MySQL ; variables d'environnement distinctes `DATASOURCES_DEFAULT_*`, et non un DSN unique |
| État cryptographique | Deux buckets GCS dédiés (`storage`, `jwt`) | Contiennent la paire de clés GPG du serveur et la paire de clés JWT générées par l'application elle-même — **pas** des secrets générés par Terraform |
| Secrets | Secret Manager | Seul le mot de passe de la base de données est généré par le socle — Passbolt lui-même n'apporte aucun secret (la sortie `secret_ids` de `Passbolt_Common` est toujours vide) |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **MySQL est obligatoire.** `database_type = "MYSQL_8_0"` est imposé par
  `Passbolt_Common` ; Passbolt repose sur CakePHP avec un schéma exclusivement
  MySQL.
- **Aucun secret applicatif côté serveur.** Contrairement à WordPress (plusieurs
  sels) ou aux applications de la famille Laravel (`APP_KEY`), Passbolt n'a
  aucune clé de chiffrement générée par Terraform. Son modèle de sécurité est
  entièrement côté client : l'extension de navigateur génère localement une
  paire de clés GPG et un mot de passe maître lors de la configuration. La paire
  de clés GPG propre au serveur (pour chiffrer des données *à destination de*
  Passbolt) et sa paire de clés JWT (jetons d'authentification de l'API) sont
  toutes deux générées par l'entrypoint de l'éditeur au premier démarrage et
  conservées sur des volumes GCS dédiés — elles ne sont ni créées ni renouvelées
  par Terraform.
- **Deux volumes GCS spécialisés, et non un seul, et pas tout le répertoire
  `/etc/passbolt`.** `storage` est monté de façon ciblée sur `/etc/passbolt/gpg` ;
  `jwt` est monté de façon ciblée sur `/etc/passbolt/jwt`. Monter un volume
  unique sur l'ensemble de `/etc/passbolt` masquerait les fichiers de
  configuration/PHP intégrés (`app.php`, `bootstrap.php`, `routes.php`) qui se
  trouvent directement dans ce répertoire de l'image — la même catégorie de bug
  que ce catalogue a déjà rencontrée avec Cloudreve.
- **`HTTPS = "on"` est toujours injecté.** Le `bootstrap.php` de Passbolt a
  `$trustProxy = false` codé en dur ; il ne tient donc pas compte de
  `X-Forwarded-Proto` par défaut — mais il vérifie directement la valeur
  littérale de `env('HTTPS')`. Comme Cloud Run termine le TLS en périphérie et
  transmet du HTTP simple au conteneur, cette surcharge statique permet à
  Passbolt de générer correctement des URL `https://` dans les e-mails et les
  liens absolus.
- **`enable_cloudsql_volume` vaut `false` par défaut au niveau des variables de
  ce module** — de façon asymétrique avec `Passbolt_GKE`, où il vaut `true` par
  défaut (les deux correspondent à la valeur par défaut `true` de
  `Passbolt_Common`). Définissez-le explicitement à `true` pour des connexions
  MySQL par socket sur Cloud Run.
- **Pas d'assistant de configuration web à la première visite.** Le seul moyen
  de créer un compte administrateur est le job d'initialisation
  `admin-bootstrap`, qui affiche dans Cloud Logging une URL de configuration à
  usage unique que l'opérateur ouvre dans une extension de navigateur compatible
  Passbolt.
- **Pas de Redis.** `enable_redis = false` par défaut — Passbolt n'a aucune
  intégration Redis utilisée par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
du service et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Passbolt {#a-cloud-run--the-passbolt-service}

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL {#b-cloud-sql-for-mysql}

Passbolt stocke toutes les données applicatives — utilisateurs, groupes,
dossiers, ressources de mots de passe chiffrées, autorisations de partage — dans
une instance gérée Cloud SQL MySQL 8.0. La connexion à la base de données
utilise les noms de variables d'environnement distincts propres à Passbolt
(`DATASOURCES_DEFAULT_HOST`/`_USERNAME`/`_PASSWORD`/`_DATABASE`, vérifiés dans le
fichier `/passbolt/env.sh` de l'éditeur), alimentés par le module applicatif à
partir des valeurs standard `DB_*` du socle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les
sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — les volumes des paires de clés GPG et JWT {#c-cloud-storage--the-gpg-and-jwt-keypair-volumes}

Deux buckets GCS sont provisionnés par `Passbolt_Common` et montés via GCS Fuse :
`storage` sur `/etc/passbolt/gpg`, `jwt` sur `/etc/passbolt/jwt`. Il ne s'agit
pas de buckets génériques de téléversement ou de médias — ils contiennent la
paire de clés GPG du serveur et la paire de clés JWT générées par l'application,
toutes deux créées une seule fois au premier démarrage puis réutilisées à chaque
démarrage suivant. La perte de l'un ou l'autre bucket invalide tous les
identifiants que Passbolt a chiffrés côté serveur et toutes les sessions JWT
émises.

- **Console :** Cloud Storage → repérez les deux buckets (leurs noms comportent
  les suffixes `storage` et `jwt`).
- **CLI :**
  ```bash
  gsutil ls -p "$PROJECT" | grep passbolt
  gsutil ls gs://<storage-bucket-name>/    # expect serverkey.asc, serverkey_private.asc
  ```

### D. Secret Manager {#d-secret-manager}

Passbolt lui-même n'apporte aucun secret — la seule entrée Secret Manager liée à
ce déploiement est le mot de passe de la base de données, géré par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~passbolt"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de
charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut
être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging — y compris l'URL de
configuration à usage unique affichée par le job d'initialisation
`admin-bootstrap`. Les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Passbolt {#3-passbolt-application-behaviour}

- **La chaîne de jobs d'initialisation en deux étapes, et pourquoi le second job
  n'a rien de trivial.** `Passbolt_Common` définit deux Cloud Run Jobs ordonnés,
  tous deux avec `execute_on_apply = true` :
  1. **`db-init`** (`mysql:8.0-debian`) — crée le rôle et la base de données
     MySQL (le script `db-init.sh` partagé par tout le catalogue, compatible
     `caching_sha2_password`).
  2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`,
     `depends_on_jobs = ["db-init"]`) — enregistre le compte administrateur
     initial.

     Les Cloud Run Jobs invoquent **directement** la `command`/les `args` d'un
     conteneur, en contournant entièrement la chaîne `/docker-entrypoint.sh` de
     l'éditeur — si bien qu'un simple `cake passbolt register_user` sur un
     conteneur fraîchement provisionné échoue avec une erreur interne 500, car
     la paire de clés GPG du serveur (normalement générée pendant la séquence de
     démarrage de l'entrypoint de l'éditeur) n'existe pas encore, et le schéma
     n'a pas non plus été installé. Le job charge donc les fonctions de
     l'entrypoint de l'éditeur (`/passbolt/entrypoint.sh`, `/passbolt/env.sh`,
     `/passbolt/deprecated_paths.sh`), génère ou importe la paire de clés GPG du
     serveur si elle manque, génère un certificat SSL autosigné s'il manque,
     exécute la fonction `install()` de l'éditeur (qui gère aussi la génération
     de la paire de clés JWT et l'installation/la migration du schéma de la base
     de données), et seulement ensuite exécute
     `cake passbolt register_user -u <admin_email> -f <admin_first_name>
     -l <admin_last_name> -r admin` — **sans** l'option `-q`/silencieuse, afin
     que l'URL de configuration à usage unique soit affichée et arrive dans Cloud
     Logging. Vérifié dans le code source réel `/passbolt/entrypoint.sh` de
     l'éditeur. Idempotent : `gpg_gen_key`/`install()` ne font rien une fois que
     les clés et le schéma existent déjà depuis une exécution précédente.

- **Pas d'assistant de configuration à la première visite, et un modèle
  d'amorçage réellement différent de la plupart des applications de ce
  catalogue.** Passbolt exige que le client (une extension de navigateur) génère
  sa propre paire de clés GPG et son mot de passe maître — il n'y a aucun mot de
  passe côté serveur à initialiser ni rien à récupérer dans Secret Manager.
  Récupérez plutôt l'URL de configuration à usage unique :
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_job" AND resource.labels.job_name~admin-bootstrap' \
    --project "$PROJECT" --limit 20 --format='value(textPayload)' | grep '/setup/start/'
  ```

- **Point de contrôle de santé.** `GET /healthcheck/status.json` renvoie un `200`
  sans authentification avec `{"header":{"status":"success",...},"body":"OK"}`
  une fois l'application prête — vérifié par des tests de conteneur en local et
  un déploiement réel. Les sondes de démarrage et de vivacité ciblent toutes deux
  ce chemin par défaut.

- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement.
Seuls les paramètres propres à Passbolt ou notables pour lui sont listés ; toutes
les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par ex. `cr`) de celle d'un `Passbolt_GKE` déployé en parallèle (`gke`) pour éviter une collision de noms. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `passbolt` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Passbolt` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `passbolt/passbolt`. |
| `admin_email` | `admin@example.com` | Adresse e-mail du compte administrateur enregistré par `admin-bootstrap`. |
| `admin_first_name` / `admin_last_name` | `Admin` / `User` | Prénom et nom du compte administrateur initial. |
| `enable_gcs_storage_volume` | `true` | Monte les volumes GCS `storage` (GPG) et `jwt`. À laisser activé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir à `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle ; Passbolt ne prend en charge que l'image préconstruite. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `2Gi` | Limite de mémoire — PHP 8.x + Apache. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | `1` | Instance unique par défaut. |
| `container_port` | `80` | Port d'écoute de Passbolt (Apache). |
| `execution_environment` | `gen2` | Environnement d'exécution requis. |
| `enable_cloudsql_volume` | `true` | **Asymétrique avec la valeur par défaut `true` de `Passbolt_GKE`.** Définir à `true` pour des connexions MySQL par socket — le `DATASOURCES_DEFAULT_HOST` de Passbolt accepte directement le répertoire du socket. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du conteneur pour le socket de l'Auth Proxy. |
| `container_protocol` | `http1` | `"http1"` ou `"h2c"`. |
| `enable_image_mirroring` | `true` | Copie l'image Passbolt dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle du trafic entrant. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Contrôle de la sortie VPC. |
| `enable_iap` | `false` | Identity-Aware Proxy. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `HTTPS = "on"` et (lorsqu'elle est connue) `APP_FULL_BASE_URL` sont définis automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. Passbolt lui-même n'en apporte aucun. |

### Groupe 11 — Cloud Storage {#group-11--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires à monter, en plus des deux que Passbolt provisionne automatiquement (`storage`, `jwt`). |
| `enable_nfs` | `true` | Provisionne un volume Filestore. **Non utilisé par le modèle de persistance de Passbolt** — les paires de clés GPG/JWT résident sur des volumes GCS dédiés et tout le reste dans MySQL. Valeur par défaut générique sans conséquence. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur Cloud SQL. Passbolt nécessite MySQL. |
| `db_name` | `passbolt` | Nom de la base de données MySQL. |
| `db_user` | `passbolt` | Utilisateur applicatif MySQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | `DATASOURCES_DEFAULT_HOST` / `_USERNAME` / `_DATABASE` / `_PASSWORD` | Définies par `passbolt.tf`, non exposées à l'utilisateur — Passbolt lit des noms de variables d'environnement CakePHP/PDO distincts, et non les noms standard `DB_*` du socle. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne de 2 jobs par défaut de `Passbolt_Common` (`db-init` → `admin-bootstrap`). Une liste non vide la remplace entièrement. |
| `cron_jobs` | `[]` | Passbolt n'a par défaut aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthcheck/status.json`, délai de 20 s, 20 tentatives | Point de contrôle d'état de Passbolt, sans authentification. |
| `liveness_probe` | HTTP `/healthcheck/status.json`, délai de 60 s | Même point de terminaison. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Passbolt. Présent pour la compatibilité avec la plateforme. |

### Groupe 22 — VPC Service Controls et journaux d'audit {#group-22--vpc-service-controls--audit-logging}

Intégration VPC-SC standard d'`App_CloudRun` — voir [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Les buckets GCS `storage` (GPG) et `jwt`. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `admin-bootstrap`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` | État de la CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs et
> leurs combinaisons au moment du plan. Une configuration invalide fait échouer
> le **plan** avec une erreur claire et nommée avant la création de toute
> ressource.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critical | Le schéma CakePHP de Passbolt est exclusivement MySQL — tout autre moteur empêche complètement le démarrage. |
| `enable_gcs_storage_volume` | `true` | Critical | Le désactiver supprime les volumes persistants de la paire de clés GPG du serveur et de la paire de clés JWT générées par l'application — tous les identifiants que Passbolt a chiffrés côté serveur, et toutes les sessions JWT émises, deviennent irrécupérables au prochain redémarrage du conteneur. |
| Ordre de `initialization_jobs` (`db-init` → `admin-bootstrap`) | Laissez `[]` sauf si vous maîtrisez parfaitement la dépendance | Critical | La reproduction, par le job `admin-bootstrap`, de la séquence de génération des clés GPG et d'installation du schéma de l'éditeur est indispensable — un job de remplacement naïf qui exécute directement `cake passbolt register_user` échoue avec une erreur interne, car la paire de clés GPG du serveur et le schéma n'existent pas encore. |
| `enable_cloudsql_volume` | `true` (attention : vaut `false` par défaut sur cette variante) | Medium | Le `DATASOURCES_DEFAULT_HOST` de Passbolt fonctionne directement sur le socket Unix du Cloud SQL Auth Proxy ; laisser la valeur par défaut `false` côté Cloud Run utilise à la place une connexion TCP directe, qui fonctionne toujours mais renonce à la terminaison TLS du socket et ne correspond ni à la valeur par défaut de `Passbolt_Common` ni à la variante GKE. |
| `admin_email` / `admin_first_name` / `admin_last_name` | À définir délibérément avant le premier déploiement | Medium | Ces valeurs initialisent l'unique compte administrateur créé par le job `admin-bootstrap` ; il n'existe ensuite aucun moyen de les modifier dans l'application, sauf via l'interface d'administration de Passbolt une fois connecté. |
| Aucun mot de passe administrateur à perdre | — | — | Contrairement à la plupart des applications de ce catalogue, il n'existe aucun identifiant administrateur conservé dans Secret Manager à récupérer. Si l'URL de configuration à usage unique est manquée et expire, la solution consiste à supprimer puis relancer le job `admin-bootstrap` (il est idempotent pour les étapes GPG/JWT/schéma, mais `register_user` lui-même peut nécessiter une nouvelle invocation pour obtenir une nouvelle URL — consultez la documentation de la CLI de Passbolt pour réémettre un lien de configuration). |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir des images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Passbolt, partagée avec la variante GKE, est décrite dans
**[Passbolt_Common](Passbolt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Passbolt sur Cloud Run](../labs/Passbolt_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Passbolt sur GKE Autopilot](Passbolt_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Passbolt Common — configuration applicative partagée](Passbolt_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Odoo sur Cloud Run](Odoo_CloudRun.md), de [Metabase sur Google Cloud Run](Metabase_CloudRun.md), de [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) et d'[OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md) dans la solution **Integrated ERP Platform**.
