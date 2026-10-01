---
title: "WriteFreely sur Google Cloud Run"
description: "Référence de configuration pour déployer WriteFreely sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/WriteFreely_CloudRun.md @ 3055034 sha256:b28b06260ab3 -->

# WriteFreely sur Google Cloud Run {#writefreely-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_CloudRun.png" alt="WriteFreely sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely est une plateforme de blog fédérée, minimaliste et open source, écrite en Go
— une alternative légère à Medium pour publier des textes épurés, sans distraction.
Ce module déploie WriteFreely sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise WriteFreely et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toute application Cloud Run — identité du service, entrée
et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WriteFreely s'exécute comme un unique conteneur Go sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à zéro activée |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le module fixe `MYSQL_8_0` ; accessible en **TCP sur IP privée** |
| Stockage objet | Cloud Storage | Un bucket de données `writefreely-uploads` dédié, provisionné automatiquement |
| Secrets | Secret Manager | Trois secrets de clés AES-256 générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** `database_type = MYSQL_8_0` est défini par la couche
  applicative partagée. WriteFreely prend aussi en charge SQLite/PostgreSQL en amont, mais
  ce module standardise sur Cloud SQL for MySQL.
- **Cloud SQL est joint en TCP sur IP privée, pas par un socket.** Sur Cloud Run,
  `enable_cloudsql_volume = false` — `DB_HOST` est l'adresse IP privée de Cloud SQL et la
  configuration `go-sql-driver` de WriteFreely se connecte en TCP simple (Cloud SQL MySQL
  accepte le TCP non chiffré sur IP privée). Cela diffère de la variante GKE, qui utilise
  le sidecar Auth Proxy sur `127.0.0.1`.
- **Les trois clés AES-256 sont générées automatiquement** et stockées dans Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). Elles ne doivent **jamais** faire l'objet
  d'une rotation après le premier démarrage — une rotation déconnecte tous les utilisateurs
  et rend indéchiffrables les données d'e-mail chiffrées auparavant.
- **Une image personnalisée est construite, pas une image précompilée récupérée.**
  `container_image_source = custom` : le wrapper léger de génération de configuration
  (qui produit `config.ini`, initialise les clés et exécute `writefreely db init`) est
  construit par Cloud Build et poussé vers Artifact Registry.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`,
  `max_instance_count = 1`). Les démarrages à froid ajoutent quelques secondes à la
  première requête après une période d'inactivité ; définissez `min_instance_count = 1`
  pour garder le blog toujours prêt.
- **Aucun compte administrateur n'est créé automatiquement.** L'inscription est fermée
  (`open_registration = false`) ; créez le premier compte comme étape post-déploiement
  (voir §3).
- **WriteFreely est écrit en Go — les paramètres Redis et PHP sont sans effet.** Les
  variables `enable_redis` et `php_*` proviennent de la structure de base du module et ne
  sont pas utilisées par WriteFreely.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service WriteFreely {#a-cloud-run--the-writefreely-service}

WriteFreely s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WriteFreely stocke toutes les données de l'application (blogs, articles, utilisateurs,
sessions) dans une instance gérée Cloud SQL for MySQL 8.0. Sur Cloud Run, le service se
connecte en **TCP sur IP privée** (`enable_cloudsql_volume = false`) — aucune adresse IP
publique n'est exposée. Au premier déploiement, un job d'initialisation (`db-init`) crée
la base de données et l'utilisateur de l'application ; le point d'entrée du conteneur
exécute ensuite `writefreely db init` pour créer les tables.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié (`writefreely-uploads`) est provisionné
automatiquement et l'accès est accordé au compte de service de la charge de travail. Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager — les clés AES-256 qu'utilise WriteFreely pour signer les cookies de session
(`cookies-auth`), chiffrer le contenu des cookies (`cookies-enc`) et chiffrer les adresses
e-mail stockées (`email-key`). Elles sont injectées sous les noms `WF_KEY_COOKIES_AUTH`,
`WF_KEY_COOKIES_ENC` et `WF_KEY_EMAIL` et écrites dans le répertoire `keys/` du conteneur
au démarrage. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[WriteFreely_Common](WriteFreely_Common.md) pour comprendre pourquoi ces clés doivent
rester stables.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut via son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut y être ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la
connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run et
de Cloud SQL sont envoyées à Cloud Monitoring, avec un test de disponibilité et des
règles d'alerte facultatifs. Le point d'entrée journalise sa progression
(`WriteFreely: rendered config.ini …`, `… seeded stable encryption keys …`,
`… starting server …`), ce qui est utile pour diagnostiquer le premier démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application WriteFreely {#3-writefreely-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation
  exécute `db-init.sh` avec `mysql:8.0-debian`. Il crée la base de données et l'utilisateur
  de l'application, accorde `ALL
  PRIVILEGES` sur la base de données, vérifie que l'utilisateur de l'application peut se
  connecter et arrête le sidecar Cloud SQL Proxy. Le job est idempotent
  (`CREATE ... IF NOT EXISTS`, `max_retries = 3`) et peut être relancé sans risque.
- **Schéma créé au démarrage.** Le point d'entrée du conteneur produit `config.ini` puis
  exécute `writefreely db init` à chaque démarrage pour créer les tables (sans erreur si
  elles existent déjà), de sorte que le schéma est initialisé sans étape de migration
  distincte.
- **Les trois clés AES-256 sont immuables après le premier démarrage.** Elles sont
  générées une seule fois et écrites dans Secret Manager. Modifier l'une d'elles déconnecte
  tous les utilisateurs (les signatures des cookies ne sont plus valides) et rend
  indéchiffrables les adresses e-mail chiffrées auparavant. N'effectuez de rotation que
  pendant une fenêtre de maintenance planifiée, en sachant que toutes les sessions seront
  rompues.
- **Créez le premier compte après le déploiement.** L'inscription est fermée par défaut
  (`open_registration = false`) et aucun administrateur n'est préconfiguré. Pour créer le
  premier compte, définissez temporairement `WF_OPEN_REGISTRATION = "true"` via
  `environment_variables`, inscrivez-vous via l'interface, puis remettez la valeur à
  `"false"` ; ou exécutez la commande `--create-admin` de WriteFreely sur le conteneur en
  cours d'exécution.
- **Exactitude de l'URL publique.** `WF_PUBLIC_URL` est défini à l'URL prévue du service au
  moment du plan, et le point d'entrée se rabat sur la valeur d'exécution
  `CLOUDRUN_SERVICE_URL`, de sorte que les liens générés utilisent le véritable hôte
  `run.app`. Vérifiez l'URL de la révision déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** (prête dès que le port 8080 est
  lié) et la sonde de vivacité est **HTTP `GET /`** — WriteFreely sert sa page d'accueil
  avec un `200` lorsqu'il est en bonne santé ; il n'existe pas de point de terminaison
  `/health` dédié.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à WriteFreely ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `writefreely` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `WriteFreely` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `writeas/writefreely` ; `latest` résout l'image de base vers l'ARG de build figé `0.12.0`. Figez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure (secrets, stockage, IAM) sans le conteneur. |
| `container_image_source` | `custom` | Laissez `custom` — le wrapper de génération de configuration doit être construit. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU suffit pour un blog courant. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Une seule instance par défaut. |
| `container_port` | `8080` | Le serveur web de WriteFreely écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `false` | **Désactivé** — Cloud Run joint MySQL en TCP sur IP privée, pas par un socket. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Autorise le trafic Internet public vers le blog. |
| `enable_iap` | `false` | Exige une connexion Google devant WriteFreely. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires. À utiliser pour `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_OPEN_REGISTRATION`. Ne définissez pas `WF_KEY_*` ni `DB_*` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur MySQL fixe. |
| `db_name` | `writefreely` | Nom de la base de données → injecté en tant que `DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `writefreely` | Utilisateur de l'application → injecté en tant que `DB_USER`. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai 30s | Prête dès que le port 8080 est lié. |
| `liveness_probe` | HTTP `/`, délai 300s | Redémarre le conteneur si la page d'accueil cesse de répondre. |

### Groupe 21 — Redis (sans effet pour WriteFreely) {#group-21--redis-inert-for-writefreely}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Non utilisé** — WriteFreely stocke tout son état dans MySQL. Vestige de la structure de base. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur
> du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec
> des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée,
> un `backup_retention_days` hors limites. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte
> que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Clés AES-256 (`WF_KEY_*`, générées automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Une rotation déconnecte tous les utilisateurs et rend indéchiffrables les données d'e-mail chiffrées. |
| `db_name` / `db_user` | Défini une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critical | Changer de moteur après le premier déploiement rend orphelines les données existantes. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `container_image_source` | `custom` | High | Définir `prebuilt` sans image intégrant le point d'entrée de génération de configuration produit un conteneur incapable de produire `config.ini`, qui ne démarre pas. |
| `enable_cloudsql_volume` | `false` | High | Sur Cloud Run, imposer le socket sans logique de point d'entrée adaptée rompt la connectivité MySQL ; le TCP sur IP privée est le chemin testé. |
| `application_version` | Figer une version | Medium | `latest` peut changer l'image de base d'un redéploiement à l'autre ; figer la version garantit des builds reproductibles. |
| `ingress_settings` | `all` | Medium | `internal` rend le blog injoignable depuis l'Internet public. |
| `enable_iap` | Désactivé pour un blog public | Medium | IAP bloque tous les lecteurs non authentifiés. |
| `min_instance_count` | `1` pour un service toujours prêt | Medium | La mise à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| `WF_OPEN_REGISTRATION` | `false` après le premier administrateur | Medium | Laisser l'inscription ouverte permet à quiconque possède l'URL de créer un compte. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour les exigences de conservation liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à WriteFreely,
partagée avec la variante GKE, est décrite dans
**[WriteFreely_Common](WriteFreely_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WriteFreely sur Cloud Run](../labs/WriteFreely_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WriteFreely sur GKE Autopilot](WriteFreely_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [WriteFreely Common — Configuration applicative partagée](WriteFreely_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [PeerTube sur Google Cloud Run](PeerTube_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Creator & Media Publishing**.
