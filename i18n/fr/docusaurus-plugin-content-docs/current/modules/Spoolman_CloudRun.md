---
title: "Spoolman sur Google Cloud Run"
description: "Référence de configuration pour déployer Spoolman sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Spoolman_CloudRun.md @ 3055034 sha256:c728b6f828e9 -->

# Spoolman sur Google Cloud Run {#spoolman-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Spoolman_CloudRun.png" alt="Spoolman sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Spoolman est un outil gratuit et open source de suivi de l'inventaire et de la
consommation des bobines de filament d'impression 3D — fournisseurs, matériaux,
poids restant, coût par bobine et consommation par impression. Il est livré sous
la forme d'un backend Python/FastAPI à processus unique, accompagné d'un frontend
statique Vue/Quasar intégré. Ce module déploie Spoolman sur **Cloud Run v2** au-dessus
du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Spoolman et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et en ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Spoolman s'exécute dans un unique conteneur Python/FastAPI sur Cloud Run v2 — il n'y
a pas de service frontend distinct ; l'interface Vue/Quasar est intégrée et servie
par le même processus. Le déploiement assemble un ensemble minimal de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Image préconstruite `ghcr.io/donkie/spoolman`, 1 vCPU / 512Mi par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — ce module se standardise sur Postgres (Spoolman en amont prend aussi en charge MySQL/SQLite/CockroachDB) |
| Stockage objet | Aucun | Spoolman conserve tout son état dans Postgres ; aucun bucket GCS n'est provisionné |
| Cache | Aucun | Spoolman n'a aucune intégration Redis/cache |
| Secrets | Secret Manager | Uniquement le mot de passe de base de données généré automatiquement — Spoolman n'a aucun secret d'amorçage administrateur/clé API qui lui soit propre |
| Entrée | URL Cloud Run | URL `run.app` par défaut, publique par défaut (`ingress_settings = "all"`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge par ce module.** `database_type`
  est fixé par `Spoolman_Common` ; Spoolman en amont prend aussi en charge MySQL et
  CockroachDB via des variables d'environnement, mais ce module n'expose pas ce choix.
- **Aucun build personnalisé.** `container_image_source = "prebuilt"` déploie
  directement `ghcr.io/donkie/spoolman` — pas de Dockerfile, pas d'étape Cloud Build,
  et aucun risque d'épinglage de `application_version` lié à la classe de bugs d'une
  image de base à l'étiquette `latest`.
- **Aucun job d'initialisation.** Le socle crée automatiquement le rôle et la base
  de données Postgres ; Spoolman exécute automatiquement ses propres migrations
  Alembic à chaque démarrage du conteneur. Il n'y a rien à attendre au-delà du
  passage du conteneur à l'état sain.
- **Aucun secret applicatif.** Spoolman est livré **sans aucune authentification** —
  quiconque peut atteindre l'URL dispose d'un accès complet en lecture/écriture à
  l'inventaire. Il n'y a aucune page de connexion à amorcer et rien n'est généré dans
  Secret Manager en dehors du mot de passe de base de données. Si cela n'est pas
  acceptable pour votre déploiement, placez le service derrière IAP
  (`enable_iap = true`) ou une liste d'adresses IP autorisées Cloud Armor.
- **La mise à l'échelle jusqu'à zéro est le comportement par défaut**
  (`min_instance_count = 0`, `cpu_always_allocated` hérite de la valeur par défaut
  du socle, fondée sur les requêtes). Spoolman n'effectue aucun travail en arrière-plan
  — ni planificateur, ni file d'attente, ni WebSocket — il n'y a donc aucune raison de
  modifier l'un ou l'autre de ces paramètres.
- **Les connexions utilisent le socket Unix Cloud SQL, et non TCP.** La couche
  SQLAlchemy de Spoolman construit sa connexion via `URL.create()` (un objet
  structuré, et non une concaténation de chaînes), de sorte que le chemin du
  répertoire du socket — qui contient des deux-points dans le nom de connexion de
  l'instance Cloud SQL — passe sans encombre, sans aucun problème d'analyse d'URL.
  Aucune configuration TLS/`sslmode` n'est nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Spoolman {#a-cloud-run--the-spoolman-service}

Spoolman s'exécute sous la forme d'un unique service Cloud Run v2. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre les
révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Spoolman stocke toutes les données d'inventaire (bobines, filaments, fournisseurs,
historique de consommation) dans une instance gérée Cloud SQL for PostgreSQL 15.
Le service se connecte de manière privée via le **Cloud SQL Auth Proxy** sur un
socket Unix ; aucune adresse IP publique n'est exposée. Il n'y a pas de job
d'initialisation — Spoolman applique ses propres migrations de schéma à chaque
démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le mot de passe de base de données généré automatiquement réside dans Secret
Manager — Spoolman n'a ni compte administrateur ni clé API propre à amorcer.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
  gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`
(`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être ajoutés par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Spoolman {#3-spoolman-application-behaviour}

- **Aucun job de configuration de la base de données au premier déploiement.**
  Contrairement à la plupart des modules applicatifs de ce catalogue, Spoolman n'a
  besoin d'aucun job `db-init` — le socle crée le rôle et la base de données Postgres,
  et les migrations Alembic propres à Spoolman s'exécutent automatiquement à chaque
  démarrage du conteneur (y compris le tout premier).
- **Aucune authentification.** Il n'y a ni page de connexion, ni compte
  administrateur, ni contrôle par clé API. Quiconque peut atteindre l'URL du service
  peut consulter et modifier l'intégralité de l'inventaire. Choisissez votre approche
  de contrôle d'accès (IAP, liste d'adresses autorisées Cloud Armor, ou acceptation
  d'un accès public en lecture/écriture) avant de partager l'URL.
- **Chemin de santé.** `/api/health` est public et non authentifié ; il renvoie un
  statut JSON 200/OK une fois le serveur (et sa connexion à la base de données)
  opérationnel. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.
- **Moteur de base de données verrouillé sur Postgres.** La variable d'environnement
  `SPOOLMAN_DB_TYPE` propre à Spoolman sélectionne le moteur ; ce module la fixe
  toujours à `postgres`. Ne la supprimez jamais via `environment_variables` — sans
  elle, Spoolman se rabat silencieusement sur un fichier SQLite jetable, local au
  conteneur, sans la moindre erreur (une classe de défaillance documentée dans ce
  catalogue — consultez le tableau des pièges du guide de configuration).
- **Inspecter la connectivité Cloud SQL :**
  ```bash
  gcloud run revisions describe <revision-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.containers[0].env)' | tr ';' '\n' | grep -i spoolman_db
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Spoolman ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `spoolman` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Spoolman` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Étiquette de l'image récupérée depuis `ghcr.io/donkie/spoolman`. Réellement préconstruite — aucune préoccupation d'épinglage de Dockerfile/build-arg. |
| `application_database_name` / `application_database_user` | `spoolman` / `spoolman` | Immuables après le premier déploiement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Transmis au socle — obligatoire, sinon la valeur par défaut `"custom"` déclenche silencieusement une tentative Kaniko/Cloud Build sans Dockerfile. |
| `container_port` | `8000` | Port d'écoute par défaut de Spoolman. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Largement suffisant pour un outil de suivi de filament mono-locataire ; augmentez-les pour un grand inventaire multi-utilisateurs. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | La mise à l'échelle jusqu'à zéro est sûre — Spoolman n'effectue aucun travail en arrière-plan. |
| `enable_cloudsql_volume` | `true` | Monte le socket Unix du Cloud SQL Auth Proxy. Nécessaire à la construction du DSN décrite au §1. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_host_env_var_name` | `SPOOLMAN_DB_HOST` | Alias de `DB_HOST` du socle (le répertoire du socket Cloud SQL sur Cloud Run). |
| `db_user_env_var_name` | `SPOOLMAN_DB_USERNAME` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `SPOOLMAN_DB_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `SPOOLMAN_DB_NAME` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `SPOOLMAN_DB_PORT` | Alias de `DB_PORT`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Aucun bucket GCS nécessaire — tout l'état réside dans Cloud SQL. |
| `enable_nfs` | `false` | Aucun système de fichiers partagé nécessaire. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 10s | Public, non authentifié. |
| `liveness_probe` | HTTP `/api/health`, période de 30s | Public, non authentifié. |

Toutes les autres entrées (CI/CD, sauvegardes, VPC-SC, Cloud Armor, IAP, Redis) sont
héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard —
Spoolman n'en utilise aucune par défaut.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — Spoolman n'a besoin d'aucun bucket GCS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry (lorsque la duplication est activée). |
| `monitoring_enabled` / `uptime_check_names` | Statut de la surveillance et tests de disponibilité. |
| `initialization_jobs` | Toujours vide — Spoolman n'a besoin d'aucun job d'initialisation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Aucune authentification (intégrée) | Placer derrière IAP ou Cloud Armor si nécessaire | Critical | Quiconque possède l'URL peut lire et modifier l'intégralité de l'inventaire de filament — il n'existe aucune page de connexion à désactiver. |
| `SPOOLMAN_DB_TYPE` (injectée automatiquement à `postgres`) | Ne jamais la supprimer via `environment_variables` | Critical | La supprimer provoque un repli silencieux sur un fichier SQLite jetable, local au conteneur — aucune erreur, et toutes les données sont perdues à chaque redémarrage. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (ne pas remplacer par `custom`) | Critical | Définir `"custom"` déclenche une tentative Kaniko/Cloud Build sur un module dépourvu de Dockerfile — le build échoue purement et simplement. |
| `enable_cloudsql_volume` | `true` | High | Le désactiver supprime le socket Unix dont dépend `SPOOLMAN_DB_HOST` de Spoolman pour le chemin de connexion documenté sans TLS. |
| `SPOOLMAN_DB_QUERY` | Laisser vide, sauf pour un dépannage | Medium | Il s'agit d'une échappatoire pour un repli TCP + `sslmode` — nécessaire uniquement si le chemin de connexion par socket s'avérait un jour peu fiable sur un déploiement en production ; inutile en fonctionnement normal. |
| `ingress_settings` | `all` (valeur par défaut) | Medium | Le restreindre à `internal` rend le service inaccessible depuis un navigateur, sauf s'il est placé derrière un équilibreur de charge. |
| `min_instance_count` | `0` (valeur par défaut) | Low | Spoolman n'effectue aucun travail en arrière-plan, la mise à l'échelle jusqu'à zéro est donc sûre ; augmentez-le uniquement pour éviter la latence de démarrage à froid en usage interactif. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Spoolman,
partagée avec la variante GKE, est décrite dans
**[Spoolman_Common](Spoolman_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Spoolman sur Cloud Run](../labs/Spoolman_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Spoolman sur GKE Autopilot](Spoolman_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Spoolman Common — Configuration applicative partagée](Spoolman_Common.md) — la configuration partagée par les deux cibles de déploiement.
