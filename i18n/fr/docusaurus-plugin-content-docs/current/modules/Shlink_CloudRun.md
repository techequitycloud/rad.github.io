---
title: "Shlink sur Google Cloud Run"
description: "Référence de configuration pour déployer Shlink sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Shlink_CloudRun.md @ 3055034 sha256:55f961e814d7 -->

# Shlink sur Google Cloud Run {#shlink-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Shlink_CloudRun.png" alt="Shlink sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Shlink est un raccourcisseur d'URL open source auto-hébergé, doté d'analyses détaillées des visites, de la génération de codes QR et d'une API REST complète. Ce module déploie Shlink sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide porte sur les services cloud qu'utilise Shlink et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toute application Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — consultez le [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les retrouver répétés ici.

---

## 1. Vue d'ensemble {#1-overview}

Shlink s'exécute sous forme de conteneur PHP (RoadRunner) sur Cloud Run v2. Le déploiement assemble un ensemble volontairement restreint de services Google Cloud — Shlink conserve **tout** son état dans PostgreSQL, il n'y a donc ni partage NFS ni bucket de stockage d'objets à gérer :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | 1 vCPU / 512 MiB par défaut, mise à l'échelle à zéro (`min_instance_count = 0`) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — contient les URL courtes, les visites, les tags et les clés d'API |
| Connectivité à la base | Cloud SQL Auth Proxy (socket Unix) | `enable_cloudsql_volume = true` ; socket compatible libpq, sans IP publique |
| Secrets | Secret Manager | Mot de passe de la base de données + `INITIAL_API_KEY` généré automatiquement |
| Cache / verrous | Redis (facultatif) | Désactivé par défaut ; utile uniquement pour le cache/verrouillage multi-instances |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur pris en charge** (`database_type = "POSTGRES_15"`, `DB_DRIVER = "postgres"`). Shlink se connecte via le socket Unix du Cloud SQL Auth Proxy — libpq accepte le répertoire du socket comme hôte, aucune configuration TCP/SSL n'est donc nécessaire.
- **`DB_USER` / `DB_NAME` sont injectés par le socle** avec des noms propres au tenant et ne sont volontairement *pas* définis par le module — la tâche `db-init` crée ce même utilisateur et cette même base de données, si bien que tout concorde automatiquement.
- **`INITIAL_API_KEY` est généré automatiquement** (32 caractères), stocké dans Secret Manager et injecté comme variable d'environnement secrète. Shlink le lit au premier démarrage pour amorcer sa première clé d'API REST — vous ne créez jamais de clé à la main.
- **Les migrations s'exécutent automatiquement au démarrage du conteneur.** L'image officielle gère l'installation et les mises à niveau du schéma ; il n'existe pas d'étape de migration distincte.
- **Mise à l'échelle à zéro par défaut.** Shlink est une application requête/réponse sans état (redirections + API REST) ; elle ne coûte rien lorsqu'elle est inactive. La contrepartie est un démarrage à froid d'environ 5–15 s sur la première requête après une période d'inactivité.
- **Les sondes de santé ciblent `/rest/health`** — un point de terminaison public et non authentifié qui renvoie HTTP 200 avec `{"status":"pass"}`. Shlink n'a **pas de page d'accueil web** ; `/` renvoie 404 par conception.
- **`DEFAULT_DOMAIN` est laissé vide** car l'URL `run.app` n'est connue qu'après le déploiement — définissez-le après le déploiement pour que les URL courtes générées utilisent le bon hôte. `IS_HTTPS_ENABLED=true` est prédéfini.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager, puis injecté sous le nom `DB_PASSWORD`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Shlink {#a-cloud-run--the-shlink-service}

Shlink s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre le nombre minimal (0) et maximal (3) d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Shlink stocke tout — URL courtes, enregistrements de visites, tags, domaines et clés d'API — dans une instance gérée Cloud SQL for PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth Proxy** sur un socket Unix (sans IP publique). Lors du premier déploiement, une tâche `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont gérés automatiquement : le **mot de passe de la base de données** (créé par le socle, injecté sous le nom `DB_PASSWORD`) et la **clé d'API initiale** (créée par `Shlink_Common`, injectée sous le nom `INITIAL_API_KEY`). Le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~shlink"
  gcloud secrets versions access latest \
    --secret="$(gcloud secrets list --project "$PROJECT" \
      --filter='name~shlink AND name~initial-api-key' --format='value(name)' --limit=1)" \
    --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### D. Redis (facultatif) {#d-redis-optional}

Shlink peut utiliser Redis pour le cache et les verrous distribués — ce qui n'a d'intérêt que si plusieurs instances s'exécutent simultanément. Il est **désactivé par défaut** (`enable_redis = false`) ; un déploiement avec un `max_instance_count` à un chiffre fonctionne très bien sans lui.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec un domaine personnalisé (le choix naturel pour un domaine court à votre marque tel que `s.example.com`), Cloud CDN et Cloud Armor peuvent s'y ajouter ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de Cloud Run et de Cloud SQL sont envoyées à Cloud Monitoring. Un test de disponibilité sur `/rest/health` est provisionné par défaut, avec une alerte d'échec reliée à `support_users`.

- **Console :** Logging → Logs Explorer ; Monitoring → Uptime checks / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Shlink {#3-shlink-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche `db-init` (image `postgres:15-alpine`) se connecte à Cloud SQL via le socket de l'Auth Proxy et crée de manière idempotente l'utilisateur et la base de données de l'application, accorde les privilèges (y compris `GRANT <user> TO postgres` afin que la propriété puisse être définie), puis signale au sidecar du proxy de s'arrêter pour que la tâche se termine. La tâche s'exécute à chaque apply et peut être relancée sans risque.
- **Migrations au démarrage.** L'image officielle de Shlink exécute automatiquement ses migrations de base de données à chaque démarrage du conteneur — le premier démarrage installe le schéma, les mises à niveau appliquent les changements de schéma sans étape manuelle. La sonde de démarrage accorde jusqu'à ~300 s (`failure_threshold = 30` × 10 s) aux migrations du premier démarrage.
- **API d'abord — pas de page d'accueil.** Shlink est un serveur headless : `/` renvoie **404 par conception**. Tout se pilote via l'API REST (`/rest/v3/...`) avec l'en-tête `X-Api-Key`, ou via une interface [shlink-web-client](https://app.shlink.io/) hébergée séparément et pointée vers ce serveur.
- **Accès au premier lancement.** Récupérez la clé d'API d'amorçage dans Secret Manager (voir §2C) et utilisez-la immédiatement :
  ```bash
  API_KEY=$(gcloud secrets versions access latest --secret=<initial-api-key-secret> --project "$PROJECT")
  curl -s -X POST "<service-url>/rest/v3/short-urls" \
    -H "X-Api-Key: $API_KEY" -H "Content-Type: application/json" \
    -d '{"longUrl": "https://cloud.google.com/run"}'
  ```
- **`DEFAULT_DOMAIN` après le déploiement.** Shlink intègre son hôte public dans chaque URL courte générée. L'URL du service est inconnue au moment du plan, `DEFAULT_DOMAIN` est donc livré vide — définissez-le (via l'entrée `environment_variables` lors d'une mise à jour) sur le nom d'hôte `run.app` ou sur votre domaine court personnalisé une fois connu.
- **La géolocalisation est facultative.** La géolocalisation des visites nécessite une licence MaxMind GeoLite2 : définissez `GEOLITE_LICENSE_KEY` dans `environment_variables`. Sans elle, les visites sont tout de même enregistrées — simplement sans géolocalisation.
- **Contraintes de mise à l'échelle.** Les instances sont sans état (tout l'état réside dans PostgreSQL), la montée en charge horizontale est donc sûre. Si vous augmentez `max_instance_count` bien au-delà de la valeur par défaut de 3 et comptez sur les compteurs/verrous en cache de Shlink, activez Redis (`enable_redis = true`).
- **Vérification de l'état de santé :**
  ```bash
  curl -s "<service-url>/rest/health"
  # {"status":"pass","version":"...","links":{...}}
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Shlink ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `shlink` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Shlink` | Nom convivial affiché dans la console. |
| `application_version` | `stable` | Tag de version de l'image Shlink (p. ex. `4.4.0`) ; incrémentez-le pour déclencher un nouveau build. |
| `admin_username` | `shlink` | **Non utilisé par Shlink** (il s'authentifie avec des clés d'API, pas avec des comptes administrateur). Conservé pour la parité d'interface. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance — 1 vCPU suffit largement pour servir les redirections et les appels d'API. |
| `memory_limit` | `512Mi` | Mémoire par instance (minimum gen2). |
| `min_instance_count` | `0` | **Mise à l'échelle à zéro.** Ne coûte rien à l'arrêt ; la première requête après une inactivité subit un démarrage à froid d'environ 5–15 s. Définissez `1` pour les liens sensibles à la latence. |
| `max_instance_count` | `3` | Nombre maximal d'instances. Activez Redis avant de l'augmenter sensiblement. |
| `container_port` | `8080` | Port HTTP natif de Shlink. |
| `enable_cloudsql_volume` | `true` | Socket Unix du Cloud SQL Auth Proxy — la connexion compatible libpq qu'attend Shlink. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry pour éviter les limites de débit de Docker Hub. |
| `execution_environment` | `gen2` | Cloud Run gen2 (recommandé). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair. Options Shlink notables : `DEFAULT_DOMAIN` (hôte public des URL courtes — à définir après le déploiement), `GEOLITE_LICENSE_KEY` (clé MaxMind pour la géolocalisation des visites). `DB_DRIVER=postgres`, `DB_PORT=5432`, `IS_HTTPS_ENABLED=true` sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires. `DB_PASSWORD` et `INITIAL_API_KEY` sont reliés automatiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Contrôle d'accès et d'entrée {#group-6--access--ingress-control}

Entrées standard IAP / entrée / sortie VPC (`enable_iap`, `ingress_settings`, `vpc_egress_setting`). Notez que les points de terminaison de redirection d'un raccourcisseur doivent rester accessibles publiquement — placer IAP devant Shlink soumet également chaque lien court à une authentification. Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupes 7–10 — Sauvegarde, CI/CD, SQL personnalisé, domaine et CDN {#groups-710--backup-cicd-custom-sql-domain--cdn}

Comportement standard d'App_CloudRun (`backup_schedule`, `enable_cicd_trigger`, `enable_binary_authorization`, `enable_custom_sql_scripts`, `application_domains`, `enable_cdn`, `enable_cloud_armor`, entrées de rétention des images). C'est dans `application_domains` qu'un domaine court à votre marque est rattaché. Toutes les entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Shlink stocke toutes ses données dans PostgreSQL — aucun système de fichiers partagé n'est nécessaire. |
| `create_cloud_storage` / `gcs_volumes` | désactivé / `[]` | Aucun bucket n'est provisionné ; Shlink n'en a pas besoin. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Le moteur Cloud SQL pris en charge par Shlink ici — ne le modifiez pas. |
| `db_name` | `shlink` | Nom de base de la base de données (préfixé par le tenant par le socle). Immuable après le premier déploiement. |
| `db_user` | `shlink` | Utilisateur de base de l'application (préfixé par le tenant). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `db_password_env_var_name` | `DB_PASSWORD` | Prédéfini — Shlink lit directement `DB_PASSWORD`. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Tâches récurrentes déclenchées par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/rest/health`, délai initial de 30 s, `failure_threshold = 30` | Accorde jusqu'à ~300 s aux migrations du premier démarrage. |
| `liveness_probe` | HTTP `/rest/health`, délai de 30 s, période de 30 s | `/rest/health` n'est pas authentifié, la sonde de vivacité reste donc activée. |
| `uptime_check_config` | désactivé, chemin `/rest/health` | Test de disponibilité Cloud Monitoring + alerte d'échec. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Cache/verrouillage facultatif pour les configurations multi-instances ; inutile à l'échelle par défaut. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Détails du point de terminaison Redis lorsqu'il est activé. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

Comportement standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging`).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service. |
| `health_check_url` | `<api_url>/rest/health` — interrogez-la avec curl pour confirmer que le déploiement est actif (Shlink n'a pas de page d'accueil ; `/` renvoie 404). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application (propres au tenant). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Shlink n'en a pas besoin). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Shlink est configuré ici pour PostgreSQL (`DB_DRIVER=postgres`) ; un autre moteur empêche le démarrage. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les URL courtes et les données de visites. |
| `environment_variables` `DB_USER` / `DB_NAME` | Jamais définis manuellement | Critical | Remplace les noms propres au tenant du socle → `password authentication failed for user "shlink"`. Laissez-les non définis. |
| `container_port` | `8080` | Critical | Port natif de Shlink ; une valeur différente fait échouer toutes les sondes de santé. |
| `enable_cloudsql_volume` | `true` | Critical | Shlink attend le socket Unix de l'Auth Proxy ; le désactiver casse le chemin de connexion à la base de données. |
| `path` de sonde / test de disponibilité | `/rest/health` | High | `/` renvoie **404 par conception** — le sonder tue des révisions saines. |
| `startup_probe` failure_threshold | `30` | High | Le réduire peut tuer le conteneur avant la fin des migrations du premier démarrage. |
| `DEFAULT_DOMAIN` | Défini après le déploiement | High | S'il reste vide, les URL courtes générées peuvent porter le mauvais hôte ; définissez-le sur le domaine `run.app` ou personnalisé. |
| `enable_iap` | `false` pour des liens publics | High | IAP placé devant Shlink soumet chaque redirection de lien court à une connexion Google. |
| `max_instance_count` sans Redis | `3` | Medium | De nombreuses instances sans Redis perdent le cache et le verrouillage partagés ; activez `enable_redis` avant une large montée en charge. |
| `min_instance_count` | `0` (par défaut) ou `1` | Medium | `0` est quasi gratuit mais ajoute un démarrage à froid d'environ 5–15 s à la première redirection après une inactivité. |
| `GEOLITE_LICENSE_KEY` | À définir si les analyses comptent | Low | Sans elle, les visites sont enregistrées mais pas géolocalisées. |
| `enable_nfs` / `create_cloud_storage` | `false` / désactivé | Low | Coût inutile — Shlink conserve tout son état dans PostgreSQL. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Shlink partagée avec la variante GKE est décrite dans **[Shlink_Common](Shlink_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Shlink sur Cloud Run](../labs/Shlink_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Shlink sur GKE Autopilot](Shlink_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Shlink Common — Configuration applicative partagée](Shlink_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
