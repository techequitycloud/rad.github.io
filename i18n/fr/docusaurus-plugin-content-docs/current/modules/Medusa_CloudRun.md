---
title: "Medusa sur Google Cloud Run"
description: "Référence de configuration pour déployer Medusa sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Medusa_CloudRun.md @ 3055034 sha256:133d220683df -->

# Medusa sur Google Cloud Run {#medusa-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Medusa_CloudRun.png" alt="Medusa sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

## 1. Introduction {#1-introduction}

**Le point le plus important à retenir sur ce module : Medusa n'a pas d'image
Docker officielle, donc `Medusa_CloudRun` en construit une à partir des sources
à chaque déploiement.** Tous les autres modules applicatifs de ce catalogue
encapsulent une image amont préconstruite ; celui-ci fait plutôt cloner par
Cloud Build le modèle de monorepo `medusajs/dtc-starter` (seul `apps/backend` —
le serveur Medusa avec son Admin UI intégrée, même processus et même port — est
construit ; le storefront Next.js séparé `apps/storefront` est explicitement
hors périmètre) et exécuter `medusa
build` dans un Dockerfile multi-étapes. Attendez-vous à un véritable `git clone` + `pnpm
install` + `medusa build` à chaque build d'image — prévoyez environ 10 minutes
pour la seule étape de build, en plus du provisionnement de Cloud SQL et du
temps d'exécution des tâches d'initialisation.

Medusa est une plateforme d'e-commerce headless open source — une alternative
API-first à Shopify Plus/Saleor offrant un contrôle programmatique complet des
produits, paniers, commandes, clients et paiements, avec une Admin UI intégrée
servie par le même processus serveur. Ce module déploie Medusa sur **Cloud Run
v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Medusa et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 2. Vue d'ensemble {#2-overview}

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js (construit à partir des sources), 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; `min_instance_count = 1` par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Medusa ne prend pas en charge MySQL ni d'autres moteurs |
| Cache et workflows en arrière-plan | Redis (**obligatoire**) | Session/cache/bus d'événements/moteur de workflows/verrouillage ; aucune solution de repli prise en charge en production |
| Stockage d'objets (facultatif) | Cloud Storage | Désactivé par défaut (`enable_gcs_storage = false`) ; lorsqu'il est activé, un bucket + un compte de service dédié + une clé HMAC générée automatiquement sont provisionnés |
| Secrets | Secret Manager | `JWT_SECRET`, `COOKIE_SECRET` et mot de passe administrateur générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |
| Build | Cloud Build | Clone `medusajs/dtc-starter`, exécute `medusa build` — il n'existe aucune image préconstruite à récupérer à la place |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par
  la couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **Redis est obligatoire, et non facultatif, en production.** `enable_redis = true` par
  défaut. Medusa journalise `"redisUrl not found. A fake redis instance will be
  used."` et démarre quand même si Redis est injoignable — il s'agit d'une solution
  de repli pour le développement et les tests, pas d'un mode de production pris en charge.
- **`container_port = 9000`** — le port par défaut documenté de Medusa, qui sert à la fois
  l'API REST et l'Admin UI.
- **`container_image_source = "custom"` ne peut pas être passé à `"prebuilt"`
  de manière utile** — il n'existe aucune image Medusa préconstruite à déployer à la place.
- **Le temps de build est réel et distinct du temps de déploiement.** L'étape Cloud Build
  dispose de 30 minutes au maximum (`timeout: 1800s` dans le
  `cloudbuild.yaml` de référence), bien qu'un build typique — clone, `pnpm install`, `medusa
  build` — se termine en 10 minutes environ. Cela s'ajoute au provisionnement normal
  de Cloud SQL (20 à 35 minutes lors d'un premier déploiement) et aux quatre exécutions
  de tâches d'initialisation qui suivent.
- **Une chaîne d'initialisation en quatre étapes s'exécute avant que le service ne soit
  considéré comme prêt** : `db-init` → `medusa-migrate` → `medusa-verify` →
  `medusa-admin-create`, chacune dépendant de la précédente.
- **`MEDUSA_WORKER_MODE = "shared"`** — une seule instance Cloud Run traite à la fois
  les requêtes API et les tâches/abonnés/workflows en arrière-plan de Medusa, car
  la topologie serveur/worker séparée officiellement recommandée par Medusa ne se
  transpose pas sur un service Cloud Run unique.
- **`enable_gcs_storage = false` par défaut.** Medusa se rabat sur le stockage local
  et éphémère du système de fichiers du conteneur pour les fichiers téléversés tant que
  vous ne l'activez pas.
- **`application_version` ne fige pas ce qui est construit.** Le Dockerfile ne contient
  aucun `ARG` qui l'utilise — seul `MEDUSA_STARTER_REF` (codé en dur à `main` dans
  `Medusa_Common`) détermine la branche de `dtc-starter` clonée.

---

## 3. Services Google Cloud et comment les explorer {#3-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
service et de ressources figurent dans les [Outputs](#6-outputs) (sorties) du déploiement.

### A. Cloud Run — le service Medusa {#a-cloud-run--the-medusa-service}

Medusa s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable.

```bash
gcloud run services list --project "$PROJECT" --region "$REGION"
gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Build — le build d'image à partir des sources {#b-cloud-build--the-from-source-image-build}

Chaque déploiement (et chaque reconstruction déclenchée par une modification de la
configuration de build du module applicatif) exécute un véritable build : `git clone --depth 1 --branch main
https://github.com/medusajs/dtc-starter.git`, `pnpm install`, `pnpm build`
dans `apps/backend`, puis un second `pnpm install --prod` hors de l'espace de travail
pnpm avant l'assemblage de l'image d'exécution.

```bash
gcloud builds list --project "$PROJECT" --limit 5
gcloud builds log <build-id> --project "$PROJECT"
```

### C. Cloud SQL for PostgreSQL 15 {#c-cloud-sql-for-postgresql-15}

Medusa stocke toutes les données applicatives (produits, commandes, clients, paniers,
stocks) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service
se connecte de façon privée via le **Cloud SQL Auth Proxy** sur un socket Unix par
défaut (`enable_cloudsql_volume = true`) ; aucune adresse IP publique n'est exposée.

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql instances describe <instance-name> --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Outputs](#6-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### D. Redis {#d-redis}

Redis est **activé par défaut**. Lorsque `redis_host` est laissé vide, l'IP de la VM
NFS de la plateforme est utilisée comme hôte Redis de repli (nécessite `enable_nfs = true`
ou un serveur NFS géré par `Services_GCP` découvert) ; sinon, définissez `redis_host`
explicitement.

```bash
redis-cli -h <redis-host> ping
# Confirm the resolved REDIS_URL in the running revision's logs (constructed
# by entrypoint.sh at boot):
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50 | grep -i redis
```

### E. Cloud Storage (facultatif) {#e-cloud-storage-optional}

Provisionné uniquement lorsque `enable_gcs_storage = true`. Contrairement à de nombreuses
applications de ce catalogue, aucune configuration manuelle de clé HMAC n'est requise —
`Medusa_Common` génère automatiquement un compte de service dédié et une paire clé
d'accès/clé secrète.

```bash
gcloud storage buckets list --project "$PROJECT"
gcloud storage ls gs://gcs-<service-name>-storage/
```

### F. Secret Manager {#f-secret-manager}

`JWT_SECRET`, `COOKIE_SECRET` et le mot de passe administrateur initial sont
générés automatiquement. Le mot de passe de la base de données est géré séparément par le
socle.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~medusa"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

Consultez [App_CloudRun](App_CloudRun.md) pour les tests de disponibilité et les règles d'alerte.

---

## 4. Comportement de l'application Medusa {#4-medusa-application-behaviour}

### La chaîne d'initialisation en quatre étapes {#the-four-stage-initialization-chain}

1. **`db-init`** (`postgres:15-alpine`) — attend la base de données, crée le
   rôle applicatif et la base de données, accorde les privilèges sur `public` et
   installe, dans la mesure du possible, les extensions `uuid-ossp`/`postgis`.
2. **`medusa-migrate`** — exécute `npx medusa db:migrate` sur l'image construite (2
   vCPU / 2Gi, jusqu'à 30 minutes, 3 nouvelles tentatives).
3. **`medusa-verify`** — une tâche de garde qui se connecte après `medusa-migrate` et
   **fait échouer l'apply** si le schéma `public` ne contient aucune table. Elle existe
   parce que ce socle ne fait **pas** échouer l'apply du module lorsqu'une tâche
   d'initialisation échoue d'elle-même — sans `medusa-verify`, une migration en
   concurrence ou en échec pourrait livrer silencieusement un service Cloud Run
   apparemment sain pointant vers une base de données **vide**, et chaque requête
   échouerait alors faute de tables, sans signal évident au moment du déploiement.
   Vérifié en conditions réelles : `"public schema has 146 table(s)"` journalisé lors
   d'un déploiement réussi.
4. **`medusa-admin-create`** — exécute `npx medusa user -e <email> -p <password>`
   pour créer le premier compte administrateur, à l'aide de `admin_email` (par défaut
   `admin@techequity.cloud`) et du secret de mot de passe administrateur généré
   automatiquement. Vérifié en conditions réelles : `"User created successfully."` journalisé.

```bash
gcloud run jobs list --project "$PROJECT" --region "$REGION"
gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
```

### Point de terminaison de santé {#health-endpoint}

`/health` ne requiert pas d'authentification et est utilisé à la fois par la sonde de
démarrage (délai initial de 120 secondes, 40 tentatives × 15 secondes — environ 12 minutes
au total) et par la sonde de vivacité (délai initial de 30 secondes, 3 tentatives).
Vérifié en conditions réelles : `curl
/health` renvoie `OK` avec le code HTTP 200.

```bash
curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/health"
```

### `MEDUSA_WORKER_MODE = "shared"` {#medusa_worker_mode--shared}

Une seule instance Cloud Run exécute à la fois le serveur API et les
tâches/abonnés/workflows en arrière-plan de Medusa — la topologie serveur/worker
séparée officiellement recommandée par Medusa ne se transpose pas sur un service
Cloud Run unique, de sorte que ce module fonctionne toujours en mode partagé.
Concrètement : chaque instance en cours d'exécution traite à la fois les requêtes
*et* tout le travail en arrière-plan planifié par le moteur de workflows de Medusa.

### Récupérer les identifiants administrateur du premier démarrage {#retrieving-the-first-run-admin-credentials}

```bash
ADMIN_SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~medusa-admin-password" --format="value(name)")
gcloud secrets versions access latest --secret="$ADMIN_SECRET" --project "$PROJECT"
```

L'e-mail administrateur est la valeur de `admin_email` définie au moment du déploiement
(par défaut `admin@techequity.cloud`).

### Accéder à l'Admin UI intégrée {#accessing-the-built-in-admin-ui}

Medusa sert son Admin UI depuis le même processus et le même port que l'API — ouvrez
`$SERVICE_URL/app` dans un navigateur et connectez-vous avec l'e-mail et le mot de passe
récupérés ci-dessus.

---

## 5. Variables de configuration {#5-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Medusa ou notables pour lui sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `medusa` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `admin_email` | `admin@techequity.cloud` | E-mail du premier utilisateur administrateur créé par `medusa-admin-create`. |
| `application_version` | `latest` | Simple étiquette de suivi du déploiement. **Ne sélectionne pas ce qui est construit** — le Dockerfile ne contient aucun `ARG` qui l'utilise ; seul `MEDUSA_STARTER_REF` (fixé à `main`) détermine le code cloné. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de ressources par instance. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Bornes du nombre d'instances. |
| `container_port` | `9000` | Port par défaut documenté de Medusa. |
| `cpu_always_allocated` | `false` | Facturation à la requête. Envisagez `true` si vous vous appuyez sur les workflows planifiés ou événementiels propres à Medusa — le mode worker partagé les traite dans la même instance, et la facturation à la requête limite le CPU entre les requêtes entrantes. |
| `container_image_source` | `custom` | Construit toujours à partir des sources — il n'existe pas d'image Medusa `"prebuilt"`. |
| `enable_cloudsql_volume` | `true` | Socket Unix du Cloud SQL Auth Proxy. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé par `Medusa_Common` ; MySQL n'est pas pris en charge. |
| `db_name` / `db_user` | `medusa` / `medusa` | Nom de la base de données / utilisateur applicatif. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Provisionne un bucket GCS + une clé HMAC générée automatiquement pour le fournisseur de fichiers compatible S3 de Medusa. Lorsque `false`, les téléversements utilisent le stockage local et éphémère du conteneur. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Obligatoire en production. |
| `redis_host` | `""` | Vide : utilise l'IP de la VM NFS de la plateforme comme repli (nécessite `enable_nfs = true`) ; sinon, à définir explicitement. |
| `redis_port` / `redis_auth` | `"6379"` / `""` | Port Redis / mot de passe d'authentification (sensible). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 120s, seuil de 40 échecs | Fenêtre totale d'environ 12 minutes. |
| `liveness_probe` | HTTP `/health`, délai de 30s, seuil de 3 échecs | |

Pour tous les autres groupes (CI/CD, sauvegarde, IAM, VPC-SC, équilibreur de charge/CDN, etc.),
consultez [App_CloudRun](App_CloudRun.md) — Medusa hérite du comportement standard du socle
sans surcharge propre à l'application.

---

## 6. Sorties {#6-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés — vide sauf si `enable_gcs_storage = true`. |
| `container_image` / `container_registry` | L'image Medusa produite par Cloud Build et son dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des quatre tâches d'initialisation créées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` / `artifact_registry_repository` | État et détails du CI/CD. |
| `vpc_sc_enabled` / `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Indicateurs de posture de sécurité. |

---

## 7. Pièges de configuration et valeurs par défaut raisonnables {#7-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs et
> leurs combinaisons au moment du plan. Une configuration invalide fait échouer
> le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Build à partir des sources (`container_image_source = "custom"`) | Aucune action nécessaire — c'est le seul mode valide | High | Toute modification du Dockerfile, de `entrypoint.sh` ou des arguments de build dans `Medusa_Common` nécessite une véritable reconstruction Cloud Build (~10 minutes pour la seule étape de build) avant de prendre effet — impossible de simplement « redémarrer » sur de nouvelles sources, contrairement aux applications à build personnalisé dont l'image de base existe déjà. Forcez une reconstruction avec `tofu taint 'module.medusa_app.module.app_build.null_resource.build_and_push_application_image[0]'` si le déclencheur basé sur le hachage du contenu manque une modification. |
| `enable_redis` | `true` | Critical | Medusa journalise `"redisUrl not found. A fake redis instance will be used."` et démarre quand même — ce message d'apparence anodine signale une solution de repli pour le développement et les tests, pas un mode de production pris en charge. Le cache, les sessions, le bus d'événements, le moteur de workflows et le verrouillage dépendent tous de Redis ; le désactiver dans un déploiement de production durable n'est pas pris en charge. |
| Tâche d'initialisation `medusa-verify` | La laisser dans la chaîne par défaut | Critical | Cette tâche existe précisément parce qu'un échec de tâche d'initialisation ne fait **pas** échouer l'apply du module dans ce socle. La supprimer (en surchargeant `initialization_jobs`) rouvre exactement le risque de base de données silencieusement vide qu'elle devait éliminer — une `medusa-migrate` en concurrence ou en échec livrerait sinon un service « déployé avec succès » face à un schéma `public` vide, et chaque requête échouerait sans signal évident au moment du déploiement. |
| Isolation de l'espace de travail pnpm (leçon pour réutiliser ce modèle de Dockerfile) | N/A — à titre informatif | High | Si vous reprenez ce modèle de build à partir des sources pour une autre application basée sur un espace de travail pnpm/npm, n'oubliez pas que la sortie de build produite *à l'intérieur* d'un monorepo cloné reste imbriquée sous le `pnpm-workspace.yaml` de ce monorepo. Exécuter `pnpm install --prod` directement sur cette sortie la réinstalle silencieusement comme partie de l'espace de travail englobant et peut n'écrire **aucun** `node_modules` — confirmé ici par `sh: medusa: not found` à l'exécution. Copiez toujours la sortie de build autonome dans un répertoire sans `pnpm-workspace.yaml` ancêtre avant d'installer ses dépendances de production. |
| `admin_email` / mot de passe administrateur initial | Le récupérer dans Secret Manager après le déploiement | High | Aucun identifiant administrateur préalimenté n'est visible ailleurs que dans Secret Manager (sortie `admin_password_secret_id`) — le perdre de vue oblige à récupérer l'accès en exécutant manuellement `npx medusa user` contre la base de données en service. |
| `MEDUSA_WORKER_MODE = "shared"` + `cpu_always_allocated = false` (défaut) | Définir `cpu_always_allocated = true` si vous vous appuyez sur des workflows planifiés ou événementiels | Medium | Le mode worker partagé traite les workflows et abonnés en arrière-plan dans la *même* instance que celle qui sert les requêtes HTTP. La facturation à la requête (par défaut) réduit le CPU quasiment à zéro entre les requêtes entrantes, ce qui peut bloquer le travail en arrière-plan dans le processus — la même catégorie de problème documentée à l'échelle de la flotte pour les applications de type n8n/OpenClaw de ce catalogue. |
| `application_version` | Comprendre qu'il ne s'agit que de métadonnées | Low | Le modifier ne fige ni ne change le code construit ; seul `MEDUSA_STARTER_REF` (fixé à `main`) détermine la branche `dtc-starter` clonée. Un build entièrement reproductible et figé nécessite de surcharger `container_build_config.build_args`. |
| `enable_gcs_storage = false` (défaut) | L'activer pour tout cas d'usage de téléversement persistant | Medium | Le stockage local est le système de fichiers éphémère du conteneur — les images et fichiers produits téléversés ne survivent pas à un redémarrage, à un redéploiement ni à un démarrage à froid après mise à l'échelle à zéro. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Medusa
partagée avec la variante GKE est décrite dans **[Medusa_Common](Medusa_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Medusa sur Cloud Run](../labs/Medusa_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Medusa sur GKE Autopilot](Medusa_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Medusa Common — Configuration applicative partagée](Medusa_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Payload CMS sur Google Cloud Run](Payload_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **E-commerce Storefront**.
