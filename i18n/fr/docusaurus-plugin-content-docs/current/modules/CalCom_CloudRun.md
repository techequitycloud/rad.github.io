---
title: "Cal.com sur Google Cloud Run"
description: "Référence de configuration pour déployer Cal.com sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CalCom_CloudRun.md @ 3055034 sha256:2550fcd23867 -->

# Cal.com sur Google Cloud Run {#calcom-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CalCom_CloudRun.png" alt="Cal.com sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Cal.com est une plateforme de planification open source sous licence AGPL — l'alternative
auto-hébergée à Calendly — construite avec **Next.js** et **Prisma** sur PostgreSQL. Ce
module déploie Cal.com sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Cal.com et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Cal.com s'exécute sous la forme d'un conteneur Next.js sur Cloud Run v2. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Cal.com (Prisma/`pg`) cible uniquement PostgreSQL |
| Stockage d'objets | Cloud Storage (aucun par défaut) | Cal.com stocke tout son état dans PostgreSQL ; aucun bucket de téléversement n'est créé |
| Cache | Redis (facultatif) | Désactivé par défaut ; utilisé pour la mise en cache / la limitation de débit |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; le schéma Prisma de Cal.com cible uniquement PostgreSQL.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont générés automatiquement** et
  stockés dans Secret Manager. N'effectuez jamais leur rotation après le premier démarrage sans fenêtre de
  maintenance — la rotation de `CALENDSO_ENCRYPTION_KEY` rend indéchiffrables tous les identifiants
  de calendrier/OAuth stockés, et celle de `NEXTAUTH_SECRET` invalide toutes les sessions.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  prennent par défaut l'URL `run.app` déterministe de ce service ; les laisser à la valeur par défaut de l'image,
  `localhost:3000`, empêche le serveur de démarrer. Définissez `webapp_url` sur un
  domaine personnalisé avant de partager des liens de réservation.
- **Le schéma est créé au démarrage, pas par un job de migration.** Le job `db-init` se contente
  de provisionner la base de données et le rôle vides ; Cal.com exécute `prisma migrate deploy` à
  chaque démarrage. Prévoyez plusieurs minutes pour le premier démarrage.
- **Le plancher de mémoire est de 2 GiB.** Cal.com (Next.js 16) plante en OOM au démarrage en dessous de 2 GiB.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max = 1`,
  facturation à la requête). Les démarrages à froid ajoutent de la latence à la première requête après une période d'inactivité ; définissez
  `min_instance_count = 1` pour les éviter.
- **Le socket du Cloud SQL Auth Proxy est utilisé par défaut** (`enable_cloudsql_volume = true`).
  Une connexion TCP directe sur IP privée échoue à la vérification du certificat serveur par Prisma
  face à l'autorité de certification non approuvée de Cloud SQL — le socket évite ce problème (le proxy assure le mTLS).
- **Redis est désactivé par défaut.** Ne l'activez que pour servir de cache / de support à la limitation de débit.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Cal.com {#a-cloud-run--the-calcom-service}

Cal.com s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre le
nombre minimal et le nombre maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution
et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Cal.com stocke toutes les données applicatives (utilisateurs, types d'événements, réservations, identifiants des calendriers
connectés) dans une instance gérée Cloud SQL for PostgreSQL 15. Le service se connecte
de façon privée via le **Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est
exposée. Lors du premier déploiement, un Job d'initialisation crée la base de données et le
rôle de l'application, et Cal.com applique son schéma via Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Cal.com conserve tout son état dans PostgreSQL ; **aucun bucket de données n'est donc créé par défaut**
(`storage_buckets` est vide). Des buckets supplémentaires peuvent toujours être déclarés via
`storage_buckets` si des intégrations personnalisées le nécessitent.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, Cal.com l'utilise
comme backend de cache / de limitation de débit. Lorsque `redis_host` est laissé vide et que `enable_nfs`
vaut true, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  # Confirm env injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager :
`NEXTAUTH_SECRET` (signe les jetons de session NextAuth.js) et `CALENDSO_ENCRYPTION_KEY`
(chiffre les identifiants de calendrier/OAuth stockés). Le mot de passe de la base de données est géré
séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être
ajouté ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité. Comme Cal.com intègre
son URL publique dans les liens de réservation et OAuth qu'il génère, définissez `webapp_url` sur le
domaine définitif avant la mise en production.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL vers Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Cal.com {#3-calcom-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` à l'aide de
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  le rôle et la base de données de l'application, puis accorde les privilèges sur le schéma
  `public`. Il ne crée **pas** le schéma applicatif — c'est le rôle de Cal.com.
- **Migrations de schéma au démarrage.** Le script de démarrage de l'image exécute `prisma migrate deploy`
  à chaque démarrage, créant le schéma au premier démarrage et appliquant les nouvelles migrations lors des
  mises à niveau de version — aucune étape de migration distincte. Prévoyez plusieurs minutes pour le premier
  démarrage avant que le service ne passe à l'état Ready.
- **`NEXTAUTH_SECRET` et `CALENDSO_ENCRYPTION_KEY` sont immuables après le premier démarrage.**
  Modifier `CALENDSO_ENCRYPTION_KEY` rend indéchiffrables tous les identifiants de calendrier/OAuth stockés
  (chaque intégration doit être réautorisée) ; modifier `NEXTAUTH_SECRET`
  déconnecte tous les utilisateurs. N'effectuez de rotation que lors d'une fenêtre de maintenance planifiée.
- **L'URL publique est validée au démarrage.** `NEXT_PUBLIC_WEBAPP_URL` / `NEXTAUTH_URL`
  prennent par défaut l'URL `run.app` déterministe et sont corrigées à l'exécution à partir de
  `CLOUDRUN_SERVICE_URL`. Vérifiez la valeur déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Configuration au premier lancement.** Ouvrez l'URL du service et terminez l'intégration Cal.com pour
  créer le compte administrateur/propriétaire initial, puis configurez au moins un
  calendrier connecté. Cal.com auto-hébergé autorise par défaut l'inscription en libre-service —
  restreignez-la (ou placez IAP devant le service) si l'instance ne doit pas être publique.
- **La sonde de démarrage est en TCP, et non en HTTP.** Le point de terminaison `/` ne renvoie un code 2xx qu'une fois que Cal.com
  signale une disponibilité COMPLÈTE (base de données + Redis + dépendances), ce qui ne réussissait jamais une sonde de démarrage HTTP
  alors même que Next.js écoutait déjà sur le port — la sonde par défaut est donc un
  contrôle TCP avec un délai de 30 s (période de 20 s, 30 tentatives en échec ≈ 10 minutes) qui réussit dès
  que l'application se lie au port. **La sonde de vivacité est désactivée par défaut** pour la
  même raison : la vivacité Cloud Run ne peut pas utiliser de socket TCP, et le point de terminaison HTTP `/`
  ferait redémarrer en boucle un conteneur par ailleurs sain pendant qu'il atteint sa disponibilité
  complète.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls les paramètres
propres à Cal.com ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `calcom` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Cal.com` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Cal.com (définit `CALCOM_VERSION`) ; fixez une version précise en production. |
| `webapp_url` | `""` | URL publique pour `NEXT_PUBLIC_WEBAPP_URL`/`NEXTAUTH_URL`. Vide → l'URL `run.app` déterministe ; définissez un domaine personnalisé dès qu'il est connu. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_port` | `3000` | Port d'écoute de Cal.com. |
| `cpu_limit` | `1000m` | CPU par instance ; Cal.com nécessite ≥ 1 vCPU. |
| `memory_limit` | `2Gi` | **Minimum 2 GiB** — Next.js 16 plante en OOM en dessous. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût ; augmentez-le pour une concurrence plus élevée. |
| `cpu_always_allocated` | `false` | Facturation à la requête. Définissez `true` uniquement si vous exécutez des workers d'arrière-plan de rappels/notifications. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS/GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Socket de l'Auth Proxy. **Laissez à `true`** — le TCP sur IP directe échoue à la vérification du certificat par Prisma. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Cal.com dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public. Définissez `internal`/`internal-and-cloud-load-balancing` pour le restreindre. |
| `enable_iap` | `false` | Exige une connexion Google devant Cal.com. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas `NEXTAUTH_SECRET`, `CALENDSO_ENCRYPTION_KEY` ni `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager (p. ex. identifiants SMTP ou d'application OAuth). |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets` (aucun par défaut). |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires. |
| `enable_nfs` | `true` | Volume partagé facultatif ; héberge aussi le Redis colocalisé lorsqu'il est activé. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `calcom` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `calcom` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 ; les autres moteurs ne sont pas pris en charge. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP** sur le port du conteneur, délai de 30s, période de 20s, 30 tentatives (~10 min) | TCP, et non HTTP — le point de terminaison `/` ne renvoie un code 2xx qu'une fois Cal.com entièrement prêt (base de données + Redis + dépendances), ce qui ne réussissait jamais en tant que contrôle HTTP alors même que l'application écoutait déjà. |
| `liveness_probe` | HTTP `/`, **désactivée par défaut** | Désactivée — le point de terminaison HTTP `/` ferait redémarrer en boucle un conteneur sain qui atteint encore sa disponibilité complète, et la vivacité Cloud Run ne peut pas utiliser le TCP. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active Redis comme backend de cache / de limitation de débit. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans aucune identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `CALENDSO_ENCRYPTION_KEY` (généré automatiquement) | Aucune rotation après le premier démarrage | Critique | Sa rotation rend indéchiffrables tous les identifiants de calendrier/OAuth stockés — chaque intégration doit être réautorisée. |
| `NEXTAUTH_SECRET` (généré automatiquement) | Rotation uniquement lors d'une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions utilisateur actives et impose une reconnexion immédiate. |
| `db_name` / `db_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Le schéma Prisma de Cal.com cible uniquement PostgreSQL ; tout autre moteur empêche le démarrage. |
| `webapp_url` | URL publique définitive | Critique | Une URL erronée ou non définie est intégrée à chaque lien de réservation/OAuth, et la valeur par défaut de l'image (`localhost:3000`) empêche le serveur de démarrer. |
| `enable_cloudsql_volume` | `true` | Élevé | Le TCP direct sur IP privée échoue à la vérification du certificat par Prisma face à l'autorité de certification de Cloud SQL — chaque requête renvoie 500. Conservez le socket de l'Auth Proxy. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 2 GiB, Next.js 16 plante en OOM au démarrage et la révision ne passe jamais à l'état Ready. |
| `enable_iap` | uniquement pour les instances privées | Élevé | IAP bloque toutes les requêtes non authentifiées — y compris les intégrations et les pages de réservation publiques. |
| Inscription ouverte | à désactiver pour les instances privées | Élevé | Cal.com auto-hébergé autorise l'inscription en libre-service ; la laisser ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `min_instance_count` | `1` pour un usage sensible à la latence | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| Type de `startup_probe` | conserver `TCP` | Moyen | Passer en HTTP sur `/` échoue tant que Cal.com ne signale pas une disponibilité complète (base de données + Redis + dépendances), bloquant le déploiement alors que l'application écoute déjà. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Cal.com, partagée
avec la variante GKE, est décrite dans **[CalCom_Common](CalCom_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Cal.com sur Cloud Run](../labs/CalCom_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Cal.com sur GKE Autopilot](CalCom_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [CalCom Common — Configuration applicative partagée](CalCom_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[OpenProject sur Google Cloud Run](OpenProject_CloudRun.md), de [Kimai sur Google Cloud Run](Kimai_CloudRun.md), de [Documenso sur Google Cloud Run](Documenso_CloudRun.md) et d'[Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
