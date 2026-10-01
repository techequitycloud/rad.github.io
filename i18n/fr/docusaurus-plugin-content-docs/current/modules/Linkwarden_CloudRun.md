---
title: "Linkwarden sur Google Cloud Run"
description: "Référence de configuration pour déployer Linkwarden sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Linkwarden_CloudRun.md @ 3055034 sha256:a64bf8551572 -->

# Linkwarden sur Google Cloud Run {#linkwarden-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_CloudRun.png" alt="Linkwarden sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden est un gestionnaire de favoris open source auto-hébergé qui va au-delà
du simple enregistrement de liens : chaque favori peut être archivé
automatiquement sous forme de capture d'écran pleine page, de PDF et d'instantané
« monolith » en un seul fichier grâce à un Chrome headless intégré, afin que vos
liens continuent de fonctionner même après la modification ou la disparition de la
page source. Ce module déploie Linkwarden sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Linkwarden et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Linkwarden s'exécute sous forme d'un conteneur Node.js/Next.js unique sur Cloud Run
v2. Le serveur web et un worker d'archivage en arrière-plan s'exécutent côte à côte
dans le MÊME conteneur (via `concurrently`) — il n'existe pas de service worker
distinct. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Next.js + Chrome headless, 2 vCPU / 2 GiB par défaut, `min_instance_count = 1` (le worker en arrière-plan doit rester actif) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le schéma Prisma de Linkwarden est exclusivement PostgreSQL |
| Stockage d'objets | Cloud Storage (volume GCS Fuse) | Monté par défaut sur `/data/data` pour les captures d'écran, PDF et monoliths archivés |
| Cache et file d'attente | Aucun | Le worker d'archivage interroge directement PostgreSQL ; aucune dépendance à Redis/BullMQ |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le schéma Prisma de Linkwarden code en dur le
  fournisseur `postgresql` ; sélectionner un autre moteur fait échouer la migration
  du premier démarrage.
- **`DATABASE_URL` se connecte via l'IP privée, et non via le socket.** Le chemin
  du répertoire du socket Unix Cloud SQL contient des deux-points qui cassent
  l'analyse de la partie « authority » de l'URL DSN par Prisma ; le point d'entrée
  cloud utilise donc toujours la variable `DB_IP` injectée (l'IP privée réelle de
  Cloud SQL sur Cloud Run) avec `sslmode=require`.
- **`NEXTAUTH_URL` est dérivé automatiquement**, en ajoutant le suffixe requis
  `/api/v1/auth` à l'URL calculée du service Cloud Run — ne le définissez jamais
  manuellement avec un modèle littéral `$(VAR)` (Cloud Run le transmet sans
  l'interpréter).
- **`min_instance_count = 1` et `cpu_always_allocated = true` par défaut.** Le
  worker d'archivage en arrière-plan intégré au conteneur doit continuer à traiter
  la file d'attente entre les requêtes ; la mise à l'échelle à zéro arrêterait
  l'archivage.
- **Chrome headless s'exécute dans le même processus que le serveur web.**
  Contrairement à Crawl4AI (un service supervisord distinct), l'archivage des
  captures d'écran, PDF et monoliths de Linkwarden partage le même conteneur et le
  même processus que le serveur Next.js — dimensionnez `memory_limit`/`cpu_limit`
  pour le pic de l'ensemble du conteneur, et pas seulement pour le serveur web. Par
  défaut : 2 vCPU / 2Gi ; augmentez la mémoire à 4Gi pour des charges d'archivage
  importantes.
- **Un volume GCS est monté automatiquement sur `/data/data`.** Il s'agit du chemin
  absolu vers lequel le code de stockage de Linkwarden résout `STORAGE_FOLDER`
  (vérifié sur l'image construite) ; le contenu archivé est donc conservé entre les
  redémarrages sans nécessiter NFS (`enable_nfs = false` par défaut).
- **Aucun super-utilisateur pré-créé.** Le premier utilisateur qui s'inscrit via le
  flux d'inscription NextAuth standard devient le propriétaire de l'instance.
- **`DISABLE_BROWSER` est une solution de repli documentée**, et non une valeur par
  défaut. Si le bac à sable gVisor de Cloud Run a du mal à lancer le Chrome headless
  intégré (une catégorie de risque similaire à l'incompatibilité s6-overlay/gVisor
  documentée pour Prowlarr ailleurs dans ce catalogue), définissez
  `disable_browser = true` pour ignorer toutes les tâches d'archivage dépendant du
  navigateur tout en conservant les fonctionnalités de métadonnées de liens, de tags
  et de collections. Vérifiez en conditions réelles avant de supposer que c'est
  nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Linkwarden {#a-cloud-run--the-linkwarden-service}

Linkwarden s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge des requêtes, entre le nombre minimal et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Linkwarden stocke toutes les données applicatives (favoris, collections, tags,
utilisateurs, métadonnées d'archive) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le point d'entrée cloud se connecte directement à l'IP privée de
Cloud SQL (`DB_IP`), et non au socket Unix de l'Auth Proxy — une exigence propre à
Prisma, car un chemin de répertoire de socket casse l'analyse de la partie
« authority » de l'URL DSN. Lors du premier déploiement, un job
d'initialisation crée la base de données applicative et l'utilisateur ;
Linkwarden exécute ensuite son propre `prisma migrate deploy` à chaque démarrage du
conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (contenu archivé) {#c-cloud-storage-archived-content}

Un bucket **Cloud Storage** dédié est provisionné automatiquement et monté par
défaut via GCS Fuse sur `/data/data` — le chemin absolu vers lequel le code de
stockage de Linkwarden résout `STORAGE_FOLDER` à l'exécution. Les processus web et
worker se résolvent tous deux vers ce même chemin, bien qu'ils s'exécutent depuis
des répertoires de travail différents dans le conteneur.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session NextAuth). Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être
ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques de Cloud Run
et de Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et
des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Linkwarden {#3-linkwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte
  via l'IP privée de Cloud SQL et crée de manière idempotente la base de données
  applicative et l'utilisateur, puis accorde les privilèges. Le job peut être
  réexécuté sans risque.
- **Les migrations du schéma s'exécutent à chaque démarrage.** Le `CMD` de l'image
  de base de Linkwarden exécute `prisma migrate deploy` avant de démarrer les
  processus web et worker ; la mise à niveau de la version de l'application applique
  donc automatiquement les modifications du schéma — il n'existe pas de job de
  migration distinct.
- **`NEXTAUTH_SECRET` est immuable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager. Sa rotation invalide toutes les sessions
  actives et oblige tous les utilisateurs à se reconnecter.
- **Aucun compte administrateur pré-créé.** Le premier utilisateur qui s'inscrit via
  le flux d'inscription NextAuth standard devient le propriétaire de l'instance — il
  n'y a aucun identifiant par défaut à récupérer.
- **Worker d'archivage en arrière-plan.** Un processus distinct (`worker.ts`, lancé
  via `concurrently` aux côtés du serveur web dans le même conteneur) interroge
  directement PostgreSQL et traite les liens en file d'attente par lots
  (`ARCHIVE_TAKE_COUNT`, `5` par défaut). Chaque lot lance des instances de Chrome
  headless pour les captures d'écran, PDF et monoliths — le CPU et la mémoire
  connaissent un pic bref à chaque lot.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut
  — Linkwarden ne dispose d'aucun point de terminaison de santé dédié confirmé. La
  sonde de démarrage accorde une fenêtre généreuse (délai initial de 60 s, seuil de
  30 échecs) pour absorber le démarrage à froid de Next.js ainsi que
  l'initialisation de Chrome headless/Playwright.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Linkwarden ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 / 2 — Projet et identité {#group-1--2--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `linkwarden` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Linkwarden` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Linkwarden publie un véritable tag `latest` en amont — celui-ci fige ou suit la version upstream réelle, contrairement à certains autres modules à build personnalisé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | 2 vCPU — l'archivage par Chrome headless s'exécute dans le même processus que le serveur web. |
| `memory_limit` | `2Gi` | Minimum pour le Chromium headless intégré ; augmentez à `4Gi` pour des charges importantes de PDF et de captures d'écran. |
| `cpu_always_allocated` | `true` | Permet au worker d'archivage en arrière-plan de continuer à traiter entre les requêtes. |
| `min_instance_count` | `1` | Maintient le worker d'archivage actif ; la mise à l'échelle à zéro arrêterait l'archivage en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `3000` | Linkwarden (Next.js) écoute sur le port 3000. |
| `execution_environment` | `gen2` | Requis pour les montages GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Conservé par souci de parité ; le point d'entrée se connecte directement via `DB_IP`, et non via le socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Linkwarden dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

`ingress_settings`, `vpc_egress_setting` et `enable_iap` standard — consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. `DATABASE_URL`, `NEXTAUTH_URL`, `PORT` et `HOSTNAME` sont définis automatiquement — ne les définissez pas ici. |
| `disable_browser` | `false` | Définit `DISABLE_BROWSER` — ignore toutes les tâches d'archivage par Chrome headless. Solution de repli si le bac à sable de Cloud Run pose problème avec Chrome. |
| `archive_take_count` | `5` | Nombre de liens traités par lot du worker en arrière-plan (`ARCHIVE_TAKE_COUNT`). |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — Linkwarden utilise plutôt un volume GCS par souci de simplicité. |
| `gcs_volumes` | `[]` (repli sur une valeur par défaut intégrée) | Un volume « storage » par défaut monté sur `/data/data` est configuré automatiquement, sauf si vous fournissez votre propre liste, qui le remplace entièrement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé — le schéma Prisma de Linkwarden est exclusivement PostgreSQL. |
| `db_name` | `linkwarden` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `linkwarden` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. Linkwarden exécute ses propres migrations Prisma au démarrage — aucun job de migration distinct n'est nécessaire. |
| `cron_jobs` | `[]` | Non utilisé par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Linkwarden ne dispose d'aucun point de terminaison de santé dédié confirmé ; fenêtre temporelle généreuse pour le démarrage à froid + l'initialisation de Chrome. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Linkwarden — son worker d'archivage interroge directement PostgreSQL. Conservé par souci de parité avec les variables du socle. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. La plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives et oblige tous les utilisateurs à se reconnecter. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données et l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` (imposé) | Critique | Tout autre moteur fait entièrement échouer la migration Prisma du premier démarrage. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro arrête le worker d'archivage en arrière-plan entre les requêtes — les liens en file d'attente ne sont jamais archivés. |
| `memory_limit` | `2Gi` minimum | Élevé | L'archivage par Chrome headless subit un OOM en dessous de ce seuil ; le serveur web peut continuer à répondre alors que l'archivage échoue silencieusement. |
| `enable_nfs` + `gcs_volumes` | Laisser `enable_nfs=false`, utiliser le volume GCS par défaut | Moyen | Activer NFS sans désactiver également la configuration du volume GCS par défaut peut répartir le contenu archivé entre deux backends de stockage. |
| `disable_browser` | `false` sauf si Chrome échoue dans le bac à sable de Cloud Run | Moyen | Le laisser à `true` sans nécessité désactive tout l'archivage des captures d'écran, PDF et monoliths — Linkwarden devient une simple liste de liens. |
| `archive_take_count` | `5` (valeur par défaut) | Faible | Des valeurs élevées provoquent de forts pics de CPU et de mémoire à chaque lot (instances simultanées de Chrome headless). |
| `ingress_settings` | `all` pour un usage normal | Moyen | Le restreindre à `internal` bloque le flux public de connexion et d'inscription nécessaire au compte propriétaire du premier lancement. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Linkwarden partagée avec la variante GKE est décrite dans
**[Linkwarden_Common](Linkwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Linkwarden sur Cloud Run](../labs/Linkwarden_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Linkwarden sur GKE Autopilot](Linkwarden_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Linkwarden Common — Configuration applicative partagée](Linkwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md), [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Personal Knowledge & Reading**.
