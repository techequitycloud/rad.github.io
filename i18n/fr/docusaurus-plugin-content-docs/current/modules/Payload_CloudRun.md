---
title: "Payload CMS sur Google Cloud Run"
description: "Référence de configuration pour déployer Payload CMS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Payload_CloudRun.md @ 3055034 sha256:983fabdfc101 -->

# Payload CMS sur Google Cloud Run {#payload-cms-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Payload_CloudRun.png" alt="Payload CMS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Payload CMS est un CMS headless et un framework applicatif natif TypeScript, fondé sur le code
et construit directement sur Next.js — non pas un produit SaaS hébergé, mais une bibliothèque
installée dans votre propre application Next.js. Le contenu est modélisé au moyen de
« Collections » typées définies dans `payload.config.ts`, et Payload génère une interface
d'administration ainsi que des API REST, GraphQL et Local à partir de cette même configuration.
Ce module déploie une véritable application Payload sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud utilisés par ce déploiement et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, entrée et
équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Payload s'exécute comme un conteneur Node.js (Next.js) sur Cloud Run v2. Il n'existe **aucune
image Docker officielle de Payload** — ce module construit à partir des sources, via Cloud Build,
une véritable application de démarrage vérifiée localement (un modèle `create-payload-app` vierge
utilisant l'adaptateur PostgreSQL). Le déploiement assemble un ensemble ciblé de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js (Next.js standalone), mise à l'échelle automatique serverless ; mise à l'échelle à zéro prise en charge par défaut |
| Build | Cloud Build | Construit l'application de démarrage Payload fournie à partir de `Payload_Common/scripts/Dockerfile` — il n'existe aucune image préconstruite à récupérer |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — l'adaptateur Postgres de Payload est utilisé ; MySQL/MongoDB ne sont pas raccordés |
| Stockage d'objets | Aucun | Aucun bucket n'est provisionné ; les médias téléversés sont écrits sur le disque local et éphémère du conteneur |
| Secrets | Secret Manager | `PAYLOAD_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et le schéma n'est pas créé au démarrage.** Démarrer le serveur
  construit sur une base de données vierge ne crée aucune table — le job d'initialisation
  `payload-migrate` applique le schéma via la CLI `payload migrate`, à l'aide d'un fichier de
  migration pré-généré intégré à l'image.
- **`container_image_source` est fixé à `"custom"`.** Il n'y a rien à déployer sans une exécution
  Cloud Build — le module construit toujours `Payload_Common/scripts/` à partir des sources.
- **Les sondes de santé ciblent `/admin`, et non `/` ou une route d'API.** `/admin` sert le
  formulaire de connexion/création du premier utilisateur de Payload et renvoie un `200` sans
  authentification ; les routes REST/GraphQL de Payload exigent une authentification et ne
  conviennent pas comme cibles de sonde.
- **Aucun bucket de stockage n'est provisionné.** Les médias téléversés sont écrits sur le disque
  local du conteneur et ne survivent ni à un redémarrage de pod ni à un redéploiement.
- **`enable_redis` et les variables associées du groupe 21 sont déclarées mais sans effet.** Elles
  ne sont pas transmises à `Payload_Common`, qui n'a aucun raccordement Redis.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les démarrages
  à froid ajoutent de la latence à la première requête après une période d'inactivité, aggravée
  par le coût de démarrage à froid propre à Next.js.
- **Le premier utilisateur administrateur est créé manuellement.** Payload ne dispose d'aucune CLI
  non interactive pour cela — visiter `/admin` avec une collection `users` vide affiche un
  formulaire d'inscription.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des
ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Payload {#a-cloud-run--the-payload-service}

Payload s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge des
requêtes entre les nombres minimal et maximal d'instances. Chaque déploiement crée une révision
immuable.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud Build — construction de l'image Payload {#b-cloud-build--building-the-payload-image}

Comme il n'existe aucune image officielle de Payload, chaque déploiement (et chaque redéploiement
après une modification du Dockerfile ou des sources) déclenche une exécution Cloud Build sur
`Payload_Common/scripts/`.

- **Console :** Cloud Build → History.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit=10
  gcloud builds log <build-id> --project "$PROJECT"
  ```

### C. Cloud SQL for PostgreSQL 15 {#c-cloud-sql-for-postgresql-15}

Payload stocke toutes les données applicatives (Collections, utilisateurs, métadonnées des
documents téléversés) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte
de façon privée via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est
exposée. Au premier déploiement, `db-init` crée la base de données et le rôle, puis
`payload-migrate` applique le schéma.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans
les [sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les
sauvegardes et la rotation des mots de passe.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`PAYLOAD_SECRET` (qui sert à signer les jetons de session/d'authentification de Payload). Le mot
de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge HTTPS externe
avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont
envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Payload {#3-payload-application-behaviour}

- **Préparation de la base de données au premier déploiement.** `db-init` (avec
  `postgres:15-alpine`) se connecte via le Cloud SQL Auth Proxy et crée de façon idempotente le
  rôle applicatif et la base de données.
- **La migration du schéma est un job distinct et dépendant.** `payload-migrate` (`depends_on_jobs =
  ["db-init"]`) exécute `./node_modules/.bin/payload migrate` depuis une copie complète `/app/cli` de
  `node_modules` + des sources TypeScript intégrée à l'image — le runtime Next.js standalone allégé
  qui sert le trafic n'inclut ni la CLI Payload ni ses dépendances. C'est un comportement réel
  vérifié localement : démarrer l'application sur une base de données sans schéma ne sert aucune
  table, et toutes les requêtes sur les collections échouent tant que les migrations n'ont pas été
  exécutées.
- **`PAYLOAD_SECRET` doit être considéré comme immuable après le premier démarrage.** Il signe les
  jetons de session/d'authentification de Payload ; le renouveler invalide toutes les sessions
  actives.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/admin` — la route de
  l'interface d'administration de Payload, qui renvoie un `200` sans authentification dès que le
  serveur Node.js et la connexion à la base de données sont prêts. Prévoyez plusieurs minutes au
  premier démarrage pour que le job `payload-migrate` se termine avant que le service ne soit censé
  servir du contenu réel.
- **Premier compte administrateur.** Payload ne dispose d'aucune commande CLI pour créer le premier
  utilisateur administrateur de façon non interactive. Visitez `$SERVICE_URL/admin` — avec une
  collection `users` vide, Payload affiche un formulaire d'inscription pour créer le premier
  administrateur. Il s'agit d'une étape manuelle et ponctuelle de l'opérateur.
- **Les médias téléversés ne persistent pas.** Aucun bucket de stockage n'est provisionné ; les
  fichiers téléversés sont écrits sur le disque local du conteneur et sont perdus au prochain
  redémarrage de pod, redéploiement ou démarrage à froid après une mise à l'échelle à zéro qui
  remplace le conteneur.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls les
paramètres propres à Payload ou notables pour lui sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `payload` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Payload CMS` | Nom lisible affiché dans la console. Texte résiduel issu du module source cloné — remplacez-le par `Payload CMS` (ou tout autre libellé de votre choix) au moment du déploiement ; il est purement cosmétique. |
| `application_version` | `latest` | Tag de suivi des déploiements intégré à l'image via l'argument de build Cloud Build `application_version`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir à `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Payload (Next.js) a besoin de marge pour le serveur standalone ainsi que pour l'empreinte TypeScript/CLI du job de migration. |
| `cpu_always_allocated` | `false` | Facturation à la requête — Payload s'exécute uniquement en mode serveur (aucun processus worker, cron désactivé) ; il s'agit donc de pur requête/réponse, sans rien à brider. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | `0` active la mise à l'échelle à zéro. |
| `container_port` | `3000` | Valeur par défaut de Next.js. |
| `container_image_source` | `custom` | Fixe — il n'existe aucune image Payload préconstruite à déployer. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Copie l'image construite dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut. |
| `enable_iap` | `false` | Exige une connexion Google — s'il est activé avant la création du premier administrateur, empêche les visiteurs anonymes d'accéder au formulaire d'inscription du premier utilisateur sur `/admin`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `PAYLOAD_SECRET` ni `DATABASE_URL` ici — tous deux sont calculés automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Déclarée dans `variables.tf` avec une description laissant entendre un adaptateur de stockage GCS compatible S3, mais **non transmise** à `Payload_Common` — sans effet. La sortie `storage_buckets` de `Payload_Common` vaut toujours `[]`. |
| `gcs_volumes` | `[]` | Réellement transmise — montages de volumes GCS Fuse, si vous souhaitez raccorder vous-même un stockage persistant. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; Payload nécessite PostgreSQL. |
| `db_name` / `db_user` | `payload` / `payload` | Nom de la base de données PostgreSQL et utilisateur applicatif. Immuables après le premier déploiement. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `payload-migrate`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/admin`, délai de 120 s, période de 15 s, 40 tentatives | Fenêtre totale d'environ 12 minutes pour que les migrations du premier démarrage se terminent. |
| `liveness_probe` | HTTP `/admin`, délai de 30 s | Sonde de vivacité. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | `true` / `""` / `6379` / `""` | **Sans effet.** Déclarées dans `variables.tf` (avec une description affirmant que Payload v0.4+ nécessite Redis) mais jamais transmises à `Payload_Common`, qui n'a aucun raccordement Redis. Les définir n'a aucun effet. |

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — aucun bucket n'est provisionné. |
| `container_image` / `container_registry` | Image construite et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs `db-init` et `payload-migrate`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux de notification, tests de disponibilité. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) — **Medium**
> (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `PAYLOAD_SECRET` (généré automatiquement) | Ne jamais le renouveler après le premier démarrage | Critical | Le renouveler invalide toutes les sessions actives et oblige tous les utilisateurs à se reconnecter. |
| `db_name` / `db_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| Délais de `startup_probe` / `payload-migrate` | Laissez la fenêtre complète d'environ 12 minutes | High | Si la fenêtre de la sonde est raccourcie en dessous du temps nécessaire à `payload-migrate`, la révision peut être déclarée non saine avant la fin de la migration du schéma, car les deux s'exécutent en parallèle au lieu que la sonde attende le job. |
| Persistance des médias/téléversements | Ajoutez un véritable adaptateur de stockage avant toute utilisation en production | High | Sans bucket de stockage raccordé, tous les médias téléversés résident sur le disque local du conteneur et sont perdus à chaque redémarrage de pod, redéploiement ou démarrage à froid. |
| `enable_gcs_storage` | Ne comptez pas sur cette option | Medium | Déclarée mais non transmise à `Payload_Common` — l'activer ne provisionne ni ne raccorde aucun stockage. |
| `enable_redis` / `redis_*` | Ne comptez pas sur ces options | Medium | Déclarées mais non transmises à `Payload_Common`, qui n'a aucun raccordement Redis — les définir n'a aucun effet. |
| Création du premier administrateur | À effectuer rapidement après le déploiement | Medium | Tant que le premier administrateur n'a pas été créé via le formulaire d'inscription de `/admin`, l'instance n'a aucun utilisateur authentifié. |
| `container_image_source` | Laissez `custom` | Low | Il n'existe aucune image Payload préconstruite ; définir `prebuilt` sans `container_image` valide fait échouer le déploiement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à
l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Payload, partagée avec
la variante GKE, est décrite dans
**[Payload_Common](Payload_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Payload CMS sur Cloud Run](../labs/Payload_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Payload CMS sur GKE Autopilot](Payload_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Payload Common — configuration applicative partagée](Payload_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Medusa sur Google Cloud Run](Medusa_CloudRun.md), de [Matomo sur Google Cloud Run](Matomo_CloudRun.md) et de [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **E-commerce Storefront**.
