---
title: "Planka sur Google Cloud Run"
description: "Référence de configuration pour déployer Planka sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Planka_CloudRun.md @ 3055034 sha256:1a70617c79bd -->

# Planka sur Google Cloud Run {#planka-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Planka_CloudRun.png" alt="Planka sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Planka est une application open source et auto-hébergée de tableaux kanban de
type Trello, dotée d'un backend Node.js (Sails.js) et d'un frontend React,
utilisée pour la gestion de projets d'équipe et personnels — tableaux, listes,
cartes, échéances, étiquettes et pièces jointes. Ce module déploie Planka sur
**Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Planka et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Planka s'exécute sous forme d'un unique conteneur Node.js sur Cloud Run v2, qui
sert à la fois son API et son frontend React depuis un seul port. Le déploiement
assemble un ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut, mise à l'échelle à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Le générateur de requêtes Knex de Planka ne prend en charge aucun autre moteur |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est créé pour les pièces jointes, mais n'est pas monté automatiquement |
| Cache et file d'attente | aucun | Planka ne dépend ni de Redis ni d'une file d'attente — les mises à jour en temps réel passent par Socket.io dans le processus |
| Secrets | Secret Manager | `SECRET_KEY` et `DEFAULT_ADMIN_PASSWORD` — deux secrets réels et fonctionnels — ainsi que le mot de passe de la base de données |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge.** `Planka_Common` impose
  `database_type = "POSTGRES_15"` — Knex n'a pas d'autre backend pour Planka.
- **Un build personnalisé léger, et non l'image préconstruite.** Planka a besoin
  d'un point d'entrée cloud pour composer `DATABASE_URL` à partir des valeurs
  `DB_*` injectées par le socle au moment de l'exécution (le mot de passe est une
  valeur Secret Manager, indisponible au moment du plan) et pour dériver
  `BASE_URL` de l'URL du service ; `container_image_source = "custom"` construit
  donc `FROM
  ghcr.io/plankanban/planka:<version>` via Cloud Build.
- **`DATABASE_URL` est une chaîne de connexion de type autorité d'URL, mais le
  SSL est défini par des variables d'environnement distinctes — et non par un
  paramètre de requête `?sslmode=`.** Contrairement à certaines applications
  Node/Postgres de ce catalogue (par ex. Logto), le propre `.env.sample` de
  Planka indique que Knex n'analyse aucun paramètre de requête de la chaîne de
  connexion. Le mode TLS est contrôlé à la place par les variables
  d'environnement simples `PGSSLMODE` et
  `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`, que node-postgres lit nativement —
  consultez le [guide Common](Planka_Common.md) pour la logique complète de
  branchement socket/loopback/IP privée.
- **Deux secrets applicatifs réels et fonctionnels.** `SECRET_KEY` (signature
  des sessions/jetons, requis au démarrage) et `DEFAULT_ADMIN_PASSWORD` (crée le
  compte administrateur initial au premier démarrage sur une base vide) sont
  tous deux réellement utilisés par Planka — vérifié dans son propre code source
  (`server/.env.sample`, `server/db/seeds/default.js`). Planka n'impose **aucune
  réinitialisation du mot de passe**, changez donc le mot de passe initial
  immédiatement après le premier déploiement.
- **Les pièces jointes ne sont pas persistées par défaut.** Un bucket GCS est
  créé mais n'est pas monté automatiquement sur le chemin `/app/data` de Planka
  — ajoutez une entrée `gcs_volumes` si les pièces jointes, avatars et
  arrière-plans téléversés doivent survivre au redémarrage d'une révision. Les
  *données* des tableaux, cartes et listes ne sont pas concernées — elles sont
  stockées dans PostgreSQL.
- **Facturation à la requête par défaut.** `cpu_always_allocated = false`,
  `min_instance_count = 0` — les mises à jour en temps réel de Planka passent par
  Socket.io dans le processus qui sert les requêtes ; aucun CPU en arrière-plan
  n'est donc nécessaire.
- **Pas de Redis.** Planka ne dépend ni d'un cache ni d'une file d'attente ;
  `enable_redis` vaut `false` par défaut.
- **Pas de NFS.** `enable_nfs` vaut `false` par défaut — Planka n'a pas besoin
  de partage de système de fichiers POSIX ; le bucket GCS facultatif via
  `gcs_volumes` couvre le stockage de fichiers.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Planka {#a-cloud-run--the-planka-service}

- **Console :** Cloud Run → sélectionnez le service pour consulter les
  révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected DB_HOST / DB_IP / BASE_URL on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Planka stocke l'ensemble des tableaux, listes, cartes et données utilisateur
dans une instance gérée Cloud SQL for PostgreSQL 15. Au premier déploiement, un
Job d'initialisation crée la base de données et le rôle de l'application ;
Planka exécute ensuite ses propres migrations Knex et son seed à chaque
démarrage via le `start.sh` de l'image officielle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un bucket `storage` est provisionné automatiquement pour les pièces jointes, les
avatars et les arrière-plans, mais il n'est **pas** monté dans le conteneur par
défaut — consultez le tableau des pièges.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets applicatifs — `SECRET_KEY` et `DEFAULT_ADMIN_PASSWORD` — ainsi que
le mot de passe de la base de données sont stockés ici.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Planka construit toutes les URL absolues (liens des pièces jointes,
notifications par e-mail et URI de redirection OIDC facultative si le SSO est
configuré) à partir de `BASE_URL`, que le point d'entrée cloud dérive de l'URL
du service.

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Planka {#3-planka-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine` et crée de
  manière idempotente le rôle et la base de données de l'application (aucun
  `CREATEROLE`/`CREATEDB` requis — les rôles propres à Planka sont des lignes
  RBAC applicatives, et non des rôles Postgres).
- **Migrations de schéma et seed à chaque démarrage.** Le `start.sh` de l'image
  officielle exécute `node db/init.js` (migrations + seed) avant de démarrer le
  serveur — de manière idempotente ; aucun job de migration distinct ne
  s'exécute donc au niveau de la plateforme.
- **Véritable identifiant d'amorçage administrateur — sans réinitialisation
  imposée.** Planka crée `admin@example.com` avec le `DEFAULT_ADMIN_PASSWORD`
  généré au premier démarrage (sur une base vide). Contrairement aux
  applications qui imposent une réinitialisation du mot de passe à la première
  connexion, Planka ne le fait pas — connectez-vous et changez le mot de passe
  depuis l'interface de Planka rapidement après le déploiement.
- **`DATABASE_URL` composée par le point d'entrée cloud.** Comme le mot de passe
  de la base de données n'est disponible que sous forme de valeur Secret Manager
  à l'exécution, le point d'entrée cloud construit `DATABASE_URL` au démarrage du
  conteneur plutôt qu'au moment du plan, en se branchant sur le `DB_HOST` résolu
  (répertoire de socket → IP privée ; loopback → TCP simple ; IP privée →
  chiffré, sans vérification de certificat). Consultez
  [Planka_Common](Planka_Common.md) pour le détail complet.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont configurées
  via les variables `startup_probe`/`liveness_probe`. Le propre
  `server/healthcheck.js` de Planka cible le **chemin racine `/`** sans
  authentification, et les variables `startup_probe`/`liveness_probe` de ce
  module utilisent désormais correctement `path = "/"` par défaut pour
  correspondre.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Planka ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `planka` | Nom de base des ressources. |
| `application_version` | `latest` | Utilisé comme ARG de build `PLANKA_VERSION` pour l'image personnalisée légère. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka a besoin de l'enveloppe du point d'entrée cloud — conservez `custom`. |
| `container_port` | `1337` | Port natif par défaut de Planka — un seul port sert l'API et le frontend. |
| `cpu_always_allocated` | `false` | Facturation à la requête. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Mise à l'échelle à zéro par défaut. |
| `memory_limit` | `4Gi` | Planka nécessite au moins 2Gi pour un fonctionnement fiable. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Créé mais non monté automatiquement — ajoutez `gcs_volumes` pour persister les pièces jointes. |
| `gcs_volumes` | `[]` | Ajoutez une entrée montée sur `/app/data` pour un stockage persistant des pièces jointes. |
| `enable_nfs` | `false` | Inutile — Planka n'exige pas de système de fichiers POSIX. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Knex ne prend en charge aucun autre moteur. |
| `db_name` / `db_user` | `planka` / `planka` | Nom de la base de données PostgreSQL et nom d'utilisateur de l'application. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, délai de 60s | Alignées sur la cible de santé réelle et non authentifiée de Planka (selon `server/healthcheck.js`), qui effectue un simple GET sur `/` sans chemin et vérifie un HTTP 200. |
| `startup_probe_config` / `health_check_config` | HTTP `/`, délai de 60s | Valeurs par défaut au niveau du socle ; remplacées par `startup_probe`/`liveness_probe` ci-dessus dès que `application_config` en fournit une (ce qui est toujours le cas ici) — sans effet en pratique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Planka ne dépend ni d'un cache ni d'une file d'attente. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` | Nom du service Cloud Run et URL `run.app` par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `storage` des pièces jointes. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `db_name` / `db_user` | À définir une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `custom` (par défaut) | High | `"prebuilt"` déploie directement l'image officielle en ignorant le point d'entrée cloud — Planka démarre sans `DATABASE_URL` et ne peut pas joindre la base de données. |
| `DEFAULT_ADMIN_PASSWORD` (secret généré) | Connectez-vous et changez-le immédiatement après le premier déploiement | **Critical** | Contrairement aux applications qui imposent une réinitialisation du mot de passe, Planka n'en impose pas — quiconque obtient le mot de passe initial (par ex. via un accès à Secret Manager) peut se connecter en tant qu'administrateur indéfiniment tant qu'il n'est pas changé. |
| `DATABASE_URL` / configuration SSL | Ne jamais modifier à la main — contrôlée par le point d'entrée cloud via les variables d'environnement `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`, et NON par un paramètre de requête `?sslmode=` | **Critical** | Planka dispose de deux chemins de connexion à la base indépendants, avec des mécanismes SSL différents, confirmés en suivant la chaîne de dépendances réelle (et pas seulement le `.env.sample` de Planka) : (1) la CLI de migration (`server/db/knexfile.js`) lit `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` ; (2) l'ORM Sails du serveur en cours d'exécution (`sails-postgresql` → `machinepack-postgresql`) analyse `DATABASE_URL` avec l'ancien `url.parse()` de Node, qui **supprime silencieusement tous les paramètres de requête**, y compris `?sslmode=` — un sslmode intégré à l'URL n'a donc aucun effet sur le chemin d'exécution. Sans configuration `ssl` explicite, `pg` brut se rabat sur la *variable d'environnement* `PGSSLMODE`, où `require` signifie « chiffrer ET vérifier » (et non « chiffrer seulement » comme dans libpq classique) — seul `PGSSLMODE=no-verify` désactive la vérification du certificat. Le certificat auto-signé de Cloud SQL ne figure pas dans le bundle d'autorités de Node ; toute valeur autre que `no-verify` échoue donc au démarrage avec `UNABLE_TO_VERIFY_LEAF_SIGNATURE` et le hook `orm` de Sails ne se charge jamais (confirmé en conditions réelles : deux tentatives antérieures, avec `?sslmode=no-verify` dans l'URL puis `PGSSLMODE=require`, ont échoué ainsi avant que la bonne variable d'environnement `PGSSLMODE=no-verify` soit identifiée). |
| `gcs_volumes` pour les pièces jointes | À ajouter explicitement si nécessaire | Medium | Sans cela, les pièces jointes, avatars et arrière-plans téléversés résident sur le système de fichiers éphémère de Cloud Run et ne survivent pas au redémarrage d'une révision — les données textuelles des tableaux, cartes et listes ne sont pas concernées. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La
configuration applicative propre à Planka partagée avec la variante GKE est
décrite dans **[Planka_Common](Planka_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Planka sur Cloud Run](../labs/Planka_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Planka sur GKE Autopilot](Planka_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Planka Common — Configuration applicative partagée](Planka_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Plane sur Google Cloud Run](Plane_CloudRun.md), [Vikunja sur Google Cloud Run](Vikunja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md) dans la solution **Project & Task Delivery**.
