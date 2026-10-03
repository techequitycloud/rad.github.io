---
title: "WriteFreely sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de WriteFreely sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/WriteFreely_CloudRun.md @ 15fd4c7 sha256:b1a0bc515409 -->

# WriteFreely sur Google Cloud Run {#writefreely-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_CloudRun.png" alt="WriteFreely sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely est une plateforme de blog open source, minimaliste et fédérée, écrite en Go
— une alternative légère à Medium pour publier des écrits clairs et sans distraction.
Ce module déploie WriteFreely sur **Cloud Run v2** sur la base de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par WriteFreely et sur la manière de les explorer et de les
exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WriteFreely s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; mise à l'échelle à zéro activée |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le module fixe `MYSQL_8_0` ; accessible via **TCP IP privée** |
| Stockage d'objets | Cloud Storage | Un bucket de données `writefreely-uploads` dédié provisionné automatiquement |
| Secrets | Secret Manager | Trois secrets de clé AES-256 auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** `database_type = MYSQL_8_0` est défini par la couche
  d'application partagée. WriteFreely prend également en charge SQLite/PostgreSQL, mais ce
  module standardise sur Cloud SQL pour MySQL.
- **Cloud SQL est accessible via TCP IP privée, et non via un socket.** Sur Cloud Run
  `enable_cloudsql_volume = false` — `DB_HOST` est l'IP privée de Cloud SQL et
  la configuration `go-sql-driver` de WriteFreely se connecte via TCP simple (Cloud SQL MySQL
  accepte le TCP IP privée non chiffré). Cela diffère de la variante GKE, qui utilise
  le sidecar Auth Proxy sur `127.0.0.1`.
- **Les trois clés AES-256 sont générées automatiquement** et stockées dans Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). Elles ne doivent **jamais** être renouvelées après
  le premier démarrage — les renouveler déconnecte tous les utilisateurs et rend les données
  d'e-mail précédemment chiffrées indéchiffrables.
- **Une image personnalisée est construite, et non tirée pré-construite.** `container_image_source = custom` :
  le wrapper fin de génération de configuration (qui rend `config.ini`, initialise les clés, exécute
  `writefreely db init`) est construit par Cloud Build et poussé vers Artifact Registry.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent quelques secondes à la première requête après
  l'inactivité ; définissez `min_instance_count = 1` pour maintenir le blog toujours actif.
- **Aucun compte administrateur n'est créé automatiquement.** L'inscription est fermée
  (`open_registration = false`) ; créez le premier compte comme étape post-déploiement
  (voir §3).
- **WriteFreely est en Go — les paramètres Redis et PHP sont inertes.** Les variables `enable_redis` et
  `php_*` proviennent de l'échafaudage du module et ne sont pas consommées par WriteFreely.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service WriteFreely {#a-cloud-run--the-writefreely-service}

WriteFreely s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge des requêtes entre les
nombres minimum et maximum d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WriteFreely stocke toutes les données d'application (blogs, articles, utilisateurs, sessions) dans une instance
Cloud SQL pour MySQL 8.0 gérée. Sur Cloud Run, le service se connecte via **TCP IP privée**
(`enable_cloudsql_volume = false`) — aucune IP publique n'est exposée. Lors du premier déploiement, un
job d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application ; le
point d'entrée du conteneur exécute ensuite `writefreely db init` pour construire les tables.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié (`writefreely-uploads`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès. Des buckets supplémentaires
peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager —
les clés AES-256 que WriteFreely utilise pour signer les cookies de session (`cookies-auth`), chiffrer
les charges utiles des cookies (`cookies-enc`) et chiffrer les adresses e-mail stockées (`email-key`).
Elles sont injectées comme `WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC` et `WF_KEY_EMAIL`
et écrites dans le répertoire `keys/` du conteneur au démarrage. Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[WriteFreely_Common](WriteFreely_Common.md) pour savoir pourquoi ces clés doivent rester stables.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec un contrôle de disponibilité et des politiques d'alerte optionnels. Le point d'entrée enregistre sa
progression (`WriteFreely: rendered config.ini …`, `… seeded stable encryption keys …`,
`… starting server …`), ce qui est utile pour diagnostiquer le premier démarrage.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application WriteFreely {#3-writefreely-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il crée la base de données et l'utilisateur de l'application, accorde `ALL
  PRIVILEGES` sur la base de données, vérifie que l'utilisateur de l'application peut se connecter et arrête le
  sidecar Cloud SQL Proxy. Le job est idempotent (`CREATE ... IF NOT EXISTS`,
  `max_retries = 3`) et peut être réexécuté en toute sécurité.
- **Schéma créé au démarrage.** Le point d'entrée du conteneur rend `config.ini` puis
  exécute `writefreely db init` à chaque démarrage pour créer les tables (tolérant si elles
  existent déjà), de sorte que le schéma est amorcé sans étape de migration distincte.
- **Les trois clés AES-256 sont immuables après le premier démarrage.** Elles sont générées une fois
  et écrites dans Secret Manager. La modification de l'une d'entre elles déconnecte tous les utilisateurs (les signatures de cookies
  ne sont plus valides) et rend les adresses e-mail précédemment chiffrées indéchiffrables. Ne les renouvelez
  que pendant une fenêtre de maintenance planifiée, en comprenant que toutes les sessions seront interrompues.
- **Créez le premier compte après le déploiement.** L'inscription est fermée par défaut
  (`open_registration = false`) et aucun administrateur n'est initialisé. Pour créer le premier compte,
  définissez temporairement `WF_OPEN_REGISTRATION = "true"` via `environment_variables`,
  inscrivez-vous via l'interface utilisateur, puis rétablissez `"false"` ; ou exécutez
  `--create-admin` de WriteFreely sur le conteneur en cours d'exécution.
- **Correction de l'URL publique.** `WF_PUBLIC_URL` est défini sur l'URL de service prévue au
  moment de la planification et le point d'entrée utilise par défaut `CLOUDRUN_SERVICE_URL` au moment de l'exécution, de sorte que
  les liens générés utilisent le véritable hôte `run.app`. Vérifiez l'URL de la révision déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** (prête dès que le port 8080 est lié)
  et la sonde de vivacité est **HTTP `GET /`** — WriteFreely sert sa page d'accueil avec un
  `200` lorsqu'elle est saine ; il n'y a pas de point de terminaison `/health` dédié.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour WriteFreely sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `writefreely` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `WriteFreely` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag d'image `writeas/writefreely` ; `latest` résout l'image de base vers l'ARG de build `0.12.0` épinglé. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure (secrets, stockage, IAM) sans le conteneur. |
| `container_image_source` | `custom` | Laissez comme `custom` — le wrapper de génération de configuration doit être construit. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU est suffisant pour un blog typique. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Instance unique par défaut. |
| `container_port` | `8080` | Le serveur web de WriteFreely se lie au port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `false` | **Désactivé** — Cloud Run atteint MySQL via TCP IP privée, et non via un socket. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Autoriser le trafic internet public vers le blog. |
| `enable_iap` | `false` | Exiger la connexion Google devant WriteFreely. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires. Utilisez pour `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_OPEN_REGISTRATION`. Ne définissez pas `WF_KEY_*` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur MySQL fixe. |
| `db_name` | `writefreely` | Nom de la base de données → injecté comme `DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `writefreely` | Utilisateur de l'application → injecté comme `DB_USER`. Mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s | Prêt dès que le port 8080 est lié. |
| `liveness_probe` | HTTP `/`, délai de 30s | Redémarre le conteneur si la page d'accueil ne répond plus. La sonde de démarrage TCP couvre déjà les démarrages lents. |

### Groupe 21 — Redis (inerte pour WriteFreely) {#group-21--redis-inert-for-writefreely}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Non consommé** — WriteFreely stocke tout l'état dans MySQL. Reste de l'échafaudage. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, contrôles de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons*
> au moment de la planification — IAP sans identités autorisées, un runtime `gen1`
> avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, une
> `backup_retention_days` hors de portée. Une configuration invalide échoue à la **planification** avec une
> erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Clés AES-256 (`WF_KEY_*`, auto-générées) | Ne jamais renouveler après le premier démarrage | Critique | Le renouvellement déconnecte tous les utilisateurs et rend les données d'e-mail chiffrées indéchiffrables. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critique | La modification du moteur après le premier déploiement orpheline les données existantes. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide échoue au job d'importation. |
| `container_image_source` | `custom` | Élevé | La définition de `prebuilt` sans une image qui intègre le point d'entrée de génération de configuration produit un conteneur qui ne peut pas rendre `config.ini` et ne démarre pas. |
| `enable_cloudsql_volume` | `false` | Élevé | Sur Cloud Run, forcer le socket sans logique de point d'entrée correspondante interrompt la connectivité MySQL ; l'IP privée TCP est le chemin testé. |
| `application_version` | Épingler une version | Moyen | `latest` peut déplacer l'image de base lors des redéploiements ; l'épinglage maintient les builds reproductibles. |
| `ingress_settings` | `all` | Moyen | `internal` rend le blog inaccessible depuis l'internet public. |
| `enable_iap` | Désactivé pour un blog public | Moyen | IAP bloque tous les lecteurs non authentifiés. |
| `min_instance_count` | `1` pour toujours actif | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid lors de la première requête après l'inactivité. |
| `WF_OPEN_REGISTRATION` | `false` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à WriteFreely
partagée avec la variante GKE est décrite dans
**[WriteFreely_Common](WriteFreely_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WriteFreely sur Cloud Run](../labs/WriteFreely_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WriteFreely sur GKE Autopilot](WriteFreely_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [WriteFreely Common — Configuration d'application partagée](WriteFreely_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Créateur et publication de médias**.
