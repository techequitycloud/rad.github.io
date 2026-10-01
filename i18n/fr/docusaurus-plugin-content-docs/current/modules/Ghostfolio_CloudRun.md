---
title: "Ghostfolio sur Google Cloud Run"
description: "Référence de configuration pour déployer Ghostfolio sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ghostfolio_CloudRun.md @ 3055034 sha256:8c324157f16b -->

# Ghostfolio sur Google Cloud Run {#ghostfolio-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ghostfolio_CloudRun.png" alt="Ghostfolio sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ghostfolio est une application open source de gestion de patrimoine sous licence
AGPL, qui permet de suivre la valeur nette, les portefeuilles d'investissement et
l'allocation d'actifs sur plusieurs comptes de courtage et plateformes — une
alternative respectueuse de la vie privée aux outils commerciaux de suivi de
portefeuille. Ce module déploie Ghostfolio sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Ghostfolio et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Ghostfolio s'exécute sous la forme d'un conteneur NestJS (ORM Prisma) sur Cloud
Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | API NestJS et frontend Angular servis depuis un seul conteneur, 1 vCPU / 1 GiB par défaut, facturation à la requête, mise à l'échelle jusqu'à zéro |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — l'ORM Prisma de Ghostfolio ne prend pas en charge MySQL |
| Cache et file d'attente | Redis (**obligatoire**, pas facultatif) | Mise en cache des données de marché, sessions et gestion des files/jobs Bull |
| Secrets | Secret Manager | `ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; l'ORM Prisma de Ghostfolio ne prend pas en charge
  d'autres moteurs.
- **Redis est obligatoire, pas facultatif.** Contrairement à de nombreuses
  applications de ce catalogue où Redis est une fonctionnalité de performance à
  activer, le point de terminaison de santé de Ghostfolio vérifie lui-même la
  connectivité Redis, et l'application ne sert pas de trafic réel sans lui.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. Tous deux sont bloquants au démarrage — Ghostfolio
  n'a de valeur par défaut raisonnable pour aucun des deux. Faire tourner
  `ACCESS_TOKEN_SALT` après le premier démarrage invalide tous les Security Tokens
  émis précédemment (voir §3).
- **Aucun compte administrateur pré-créé.** Ghostfolio n'a ni formulaire de
  connexion par e-mail/mot de passe ni assistant de configuration initiale à
  remplir — le premier visiteur de l'URL déployée clique sur « Get Started » et
  l'application génère un Security Token anonyme aléatoire qui fait de lui le
  propriétaire du compte.
- **La mise à l'échelle jusqu'à zéro est activée par défaut**
  (`min_instance_count = 0`, `cpu_always_allocated = false`). L'API de Ghostfolio
  fonctionne purement en requête/réponse, sans planificateur d'arrière-plan
  intégré au processus, si bien que la facturation à la requête s'applique sans
  difficulté.
- **Aucun stockage de fichiers/médias en masse n'est provisionné.** Ghostfolio n'a
  pas d'équivalent aux pièces jointes téléversées par les utilisateurs ;
  `storage_buckets` est toujours vide.
- **`DATABASE_URL` est composée à l'exécution, jamais via un socket Unix.** La
  chaîne de connexion Prisma de Ghostfolio est un DSN de type URL
  (`postgresql://user:pass@host:port/db`), et les deux-points d'un chemin de socket
  Cloud SQL cassent ce format — le point d'entrée cloud du conteneur se connecte
  toujours en TCP via l'IP privée de Cloud SQL, avec `sslmode=require`.
- **`application_version = "latest"` est réellement valide.** Contrairement à
  plusieurs autres modules de ce catalogue reposant sur une image prête à l'emploi,
  `ghostfolio/ghostfolio` sur Docker Hub publie un vrai tag `latest` ; aucun
  contournement par épinglage de version n'est donc nécessaire (l'épinglage reste
  recommandé pour des builds reproductibles).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Ghostfolio {#a-cloud-run--the-ghostfolio-service}

Ghostfolio s'exécute en tant que service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Ghostfolio stocke toutes les données de l'application (comptes, positions,
activités, cache des données de marché, enregistrements utilisateurs) dans une
instance gérée Cloud SQL for PostgreSQL 15. Au premier déploiement, un Job
d'initialisation crée la base de données et le rôle de l'application ; le point
d'entrée du conteneur de Ghostfolio exécute ensuite les migrations Prisma à chaque
démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis (obligatoire) {#c-redis-required}

Redis sert de support à la mise en cache des données de marché, aux sessions et à
la gestion des files/jobs Bull — Ghostfolio ne démarre pas correctement sans une
instance Redis joignable. Lorsque `redis_host` est laissé vide, l'IP de la VM NFS
de la plateforme est utilisée comme point de terminaison Redis (nécessite
`enable_nfs = true` ou un serveur NFS `Services_GCP` découvert).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the running revision's Redis env vars:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `ACCESS_TOKEN_SALT` (hache l'identifiant de connexion anonyme Security
Token) et `JWT_SECRET_KEY` (signe les JWT d'authentification). Le mot de passe de la
base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être
ajouté ; les paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de
disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ghostfolio {#3-ghostfolio-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte à
  Cloud SQL et crée de manière idempotente le rôle de l'application, la base de
  données et les autorisations. Le job peut être relancé sans risque.
- **Les migrations et l'amorçage s'exécutent à CHAQUE démarrage du conteneur**,
  dans le même processus que le serveur — et non dans un job d'initialisation
  distinct. Le script amont `docker/entrypoint.sh` exécute `prisma migrate deploy`,
  puis `prisma db seed`, puis démarre le serveur NestJS. Une migration en échec fait
  planter le conteneur de manière visible (le script amont utilise `set -ex`)
  plutôt que de livrer un service sain face à une base de données vide.
- **`ACCESS_TOKEN_SALT` et `JWT_SECRET_KEY` sont immuables après le premier
  démarrage.** Ils sont générés une seule fois et écrits dans Secret Manager.
  `ACCESS_TOKEN_SALT` hache le Security Token anonyme — le faire tourner invalide
  tous les jetons émis précédemment (les utilisateurs doivent se réinscrire).
  `JWT_SECRET_KEY` signe les JWT de session — le faire tourner déconnecte tout le
  monde.
- **Aucun formulaire de premier lancement à remplir.** Le premier visiteur de l'URL
  déployée voit un bouton « Get Started » ; un clic génère un Security Token
  aléatoire qui devient l'identifiant de connexion du propriétaire du compte. Il n'y
  a ni e-mail/mot de passe à définir ni compte administrateur à initialiser.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `GET /api/v1/health`, qui vérifie À LA FOIS la connexion à la base de données ET
  celle à Redis, et renvoie `503` tant que les deux ne sont pas saines — ce qui en
  fait une véritable barrière de disponibilité, et pas seulement un simple ping de
  vivacité.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Ghostfolio ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ghostfolio` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Ghostfolio` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de suivi du déploiement. `ghostfolio/ghostfolio` sur Docker Hub publie un vrai tag `latest`, utilisable tel quel — épinglez une version précise (par ex. `2.153.0`) pour des builds reproductibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU suffit pour un usage typique. |
| `memory_limit` | `1Gi` | 1 GiB suffit pour un usage typique. |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro — l'API de Ghostfolio fonctionne purement en requête/réponse. |
| `container_port` | `3333` | `DEFAULT_PORT` de Ghostfolio (`libs/common/src/lib/config.ts`). |
| `cpu_always_allocated` | `false` | Facturation à la requête — aucun planificateur d'arrière-plan intégré au processus à brider. |
| `enable_cloudsql_volume` | `true` | Monte un sidecar Cloud SQL Auth Proxy, mais le point d'entrée cloud de Ghostfolio ne se connecte jamais directement via le chemin du socket — voir §1. |
| `container_image_source` | `custom` | Cloud Build encapsule l'image prête à l'emploi `ghostfolio/ghostfolio` dans un mince point d'entrée cloud. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DATABASE_URL`, `PORT` et `REDIS_PASSWORD` (alias de `REDIS_AUTH`) sont composés par le point d'entrée cloud — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager (par ex. la clé d'API d'un fournisseur de données de marché personnalisé). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `ghostfolio` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `ghostfolio` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Il n'existe pas de job de migration distinct — les migrations s'exécutent dans le conteneur de l'application à chaque démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/health`, délai de 30s, seuil de 12 échecs | Vérifie À LA FOIS la connectivité à la base de données ET à Redis. |
| `liveness_probe` | HTTP `/api/v1/health`, délai de 30s, seuil de 3 échecs | Même point de terminaison que la sonde de démarrage. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | OBLIGATOIRE — toujours transmis sans condition, jamais conditionné à `redis_host != ""`. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `"6379"` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis (sensible). Associé à l'exécution à la variable d'environnement `REDIS_PASSWORD` propre à Ghostfolio. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — Ghostfolio n'a besoin d'aucun stockage de fichiers/médias en masse. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée, avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ACCESS_TOKEN_SALT` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Le faire tourner invalide tous les Security Tokens émis précédemment — chaque utilisateur doit se réinscrire. |
| `JWT_SECRET_KEY` (généré automatiquement) | Ne le faire tourner que pendant une fenêtre de maintenance | Critique | Le faire tourner invalide toutes les sessions actives et impose une reconnexion immédiate. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_redis` | `true`, toujours transmis sans condition | Critique | Le point de terminaison de santé de Ghostfolio vérifie Redis directement — sans lui, l'application n'est jamais déclarée saine, quelle que soit la valeur de `redis_host`. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais qu'aucun hôte n'est résolu (NFS désactivé, pas d'hôte explicite), `REDIS_HOST` est vide et l'application échoue à son propre contrôle de santé. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `application_version` | À épingler en production | Moyen | `latest` est réellement valide ici (contrairement à la plupart des modules), mais suit quand même ce que Docker Hub étiquette actuellement comme latest — épinglez une version pour des déploiements reproductibles. |
| `min_instance_count` | `0` convient à la plupart des déploiements | Faible | La mise à l'échelle jusqu'à zéro ajoute un bref délai de démarrage à froid à la première requête après une période d'inactivité ; définissez `1` uniquement si cette latence compte. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Ghostfolio, partagée avec la variante GKE, est décrite dans
**[Ghostfolio_Common](Ghostfolio_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ghostfolio sur Cloud Run](../labs/Ghostfolio_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Ghostfolio sur GKE Autopilot](Ghostfolio_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ghostfolio Common — Configuration applicative partagée](Ghostfolio_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Firefly III sur Google Cloud Run](FireflyIII_CloudRun.md), [Wallos sur Google Cloud Run](Wallos_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Finance & Wealth Tracking**.
