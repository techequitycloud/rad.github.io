---
title: "FreshRSS sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de FreshRSS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FreshRSS_CloudRun.md @ 15fd4c7 sha256:5aec892346a2 -->

# FreshRSS sur Google Cloud Run {#freshrss-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreshRSS_CloudRun.png" alt="FreshRSS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreshRSS est un agrégateur de flux RSS et Atom gratuit, auto-hébergé et sous
licence GPL-3.0 — un "lecteur de nouvelles" léger et multi-utilisateur écrit en
PHP qui s'exécute derrière Apache et expose les API Google Reader et Fever pour
les clients mobiles. Ce module déploie FreshRSS sur **Cloud Run v2** sur la
base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par FreshRSS et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité de service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

FreshRSS s'exécute en tant que conteneur PHP/Apache sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut, une instance maintenue active (`min_instance_count = 1`) |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le point d'entrée s'installe avec `--db-type pgsql` |
| Stockage persistant | NFS (Filestore / autogéré) | Monté à `/var/www/FreshRSS/data` ; contient la configuration, l'état par utilisateur, le cache des flux. Pas de bucket GCS |
| Cache | Redis (facultatif) | Désactivé par défaut ; FreshRSS ne le requiert pas |
| Secrets | Secret Manager | `FRESHRSS_ADMIN_PASSWORD` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur pris en charge.** Le point d'entrée du
  conteneur code en dur `--db-type pgsql` et le job `db-init` est uniquement
  Postgres ; le schéma est créé par l'installateur de FreshRSS au premier
  démarrage.
- **NFS est activé par défaut** (`enable_nfs = true`) et monté à
  `/var/www/FreshRSS/data`. FreshRSS y écrit sa configuration générée
  (`data/config.php`), l'état par utilisateur, les articles mis en cache et les
  favicons — sans volume persistant, cet état est perdu à chaque démarrage à
  froid ou redéploiement.
- **`FRESHRSS_ADMIN_PASSWORD` est généré automatiquement** et stocké dans Secret
  Manager. Il initialise le compte `admin` par défaut (et son mot de
  passe API pour les clients mobiles) lors de la première installation.
- **Une instance est maintenue active par défaut** (`min_instance_count = 1`,
  `max_instance_count = 1`). Elle doit rester à au moins 1 : l'actualisation des flux
  s'exécute en tant que cron intégré au conteneur (`CRON_MIN = */15`) qui
  n'existe que tant qu'une instance existe — voir le tableau des pièges.
- **`max_instance_count = 1`.** Une seule instance possède le cron d'actualisation
  intégré au conteneur et l'état de session/cache basé sur les fichiers ; en
  exécuter plus d'une sans précaution duplique les actualisations de flux.
- **Le conteneur écoute sur le port 80** (Apache), pas 8080.
- **`BASE_URL` est défini à partir de l'URL de service prédite au
  moment de la planification et corrigé à l'exécution** à partir de
  `CLOUDRUN_SERVICE_URL`, de sorte que les liens auto-référencés de FreshRSS et la
  redirection `/` → setup se résolvent sur l'hôte Cloud Run réel.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service FreshRSS {#a-cloud-run--the-freshrss-service}

FreshRSS s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes entre le nombre minimum et
maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~freshrss"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

FreshRSS stocke toutes les données de l'application (flux, abonnements,
articles, catégories, utilisateurs) dans une instance gérée Cloud SQL pour
PostgreSQL 15. Le service se connecte en privé via le **Cloud SQL Auth Proxy**
sur un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, le Job `db-init` crée la base de données et l'utilisateur de
l'application, et l'installateur de FreshRSS crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Stockage persistant (NFS) {#c-persistent-storage-nfs}

Le répertoire de données de FreshRSS (`/var/www/FreshRSS/data`) est sauvegardé par un
**volume NFS** (`enable_nfs = true`), qui contient la configuration générée,
l'état par utilisateur, les articles mis en cache et les favicons. Ce module
ne déclare **aucun bucket GCS** — le contenu des flux est conservé dans
PostgreSQL et le répertoire de données NFS.

- **Console :** Filestore → Instances (NFS géré), ou Compute Engine → Instances
  de VM (serveur NFS autogéré).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount inside the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de serveur NFS et les
options GCS Fuse.

### D. Redis (cache facultatif) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`) et FreshRSS ne le
requiert pas. Il est exposé comme une option transférée pour la parité avec les
modules PHP frères ; laissez-le désactivé sauf si vous avez une raison
spécifique de l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

Un secret d'application est généré automatiquement : `FRESHRSS_ADMIN_PASSWORD`, qui
initialise le compte `admin` par défaut et son mot de passe API lors de
la première installation. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freshrss"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (ingress
public). Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et
le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application FreshRSS {#3-freshrss-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Le Job
  `db-init` s'exécute en utilisant `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente la base de données et
  l'utilisateur de l'application et accorde les privilèges. Le job peut être
  réexécuté en toute sécurité.
- **Installation au premier démarrage.** Le `platform-entrypoint.sh` du conteneur
  résout l'hôte de la base de données, puis exécute le `cli/do-install.php` de
  FreshRSS (crée `data/config.php` et le schéma) et `cli/create-user.php` (crée le
  compte `admin` à partir de `FRESHRSS_ADMIN_PASSWORD`), puis enchaîne le
  point d'entrée amont. L'installation est idempotente — elle est ignorée une
  fois que `data/config.php` existe sur le volume NFS.
- **Cron d'actualisation des flux.** L'image amont démarre un cron intégré au
  conteneur (`CRON_MIN = */15`) qui actualise les flux abonnés toutes les 15
  minutes. Cela ne s'exécute que tant qu'une instance est active — c'est
  pourquoi `min_instance_count` est par défaut à `1`. À
  `0`, Cloud Run récupère l'instance inactive et les
  actualisations s'arrêtent jusqu'à ce que la prochaine requête réveille le
  service.
- **Identifiants administrateur.** La connexion par défaut est
  `admin` avec le `FRESHRSS_ADMIN_PASSWORD` généré ; la même valeur est
  définie comme mot de passe API utilisé par les clients mobiles Google Reader
  / Fever API. Changez-le dans l'interface utilisateur de FreshRSS après la
  première connexion — la rotation de la valeur Secret Manager seule ne
  réinitialisera pas un compte déjà installé.
- **Chemin de santé.** La sonde de démarrage est une vérification TCP sur le
  port 80 ; la sonde de vivacité est un HTTP GET sur `/i/`, qui
  renvoie un `200` littéral et rend à partir de la base de données
  (`/` répond avec une redirection 302, qu'une vérification de
  santé de l'équilibreur de charge rejette). FreshRSS sert également un point
  de terminaison JSON `/status` non authentifié adapté aux vérifications
  de disponibilité. Accordez une fenêtre généreuse au premier démarrage
  pendant que l'installateur crée le schéma.
- **URL de base.** `BASE_URL` est défini sur l'URL Cloud Run prédite
  au moment de la planification et corrigé à l'exécution à partir de
  `CLOUDRUN_SERVICE_URL`. Vérifiez la révision en cours :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
FreshRSS sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freshrss` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `FreshRSS` | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image FreshRSS ; `latest` est épinglé à un tag connu et fonctionnel (`1.26.3`) au moment de la build. Épinglez explicitement en production. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | FreshRSS livre une build personnalisée légère ; utilisez `prebuilt` uniquement avec un `container_image` externe. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par instance ; maintenir ≥ 512Mi. |
| `min_instance_count` | `1` | Maintenir `1` pour que le cron d'actualisation des flux continue de s'exécuter ; `0` active la mise à l'échelle à zéro et arrête les actualisations en veille. |
| `max_instance_count` | `1` | Maintenir à 1 — une seule instance possède le cron d'actualisation et l'état basé sur les fichiers. |
| `container_port` | `80` | FreshRSS/Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `enable_cloudsql_volume` | `true` | Socket Cloud SQL Auth Proxy pour les connexions Postgres. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise l'accès public. |
| `enable_iap` | `false` | Exiger la connexion Google devant FreshRSS. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte un volume NFS persistant pour le répertoire de données FreshRSS. **Maintenir activé** — requis pour persister la configuration et l'état par utilisateur. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Où le volume NFS est monté à l'intérieur du conteneur. |
| `create_cloud_storage` / `storage_buckets` | `true` / `[]` | FreshRSS ne déclare aucun bucket propre ; ajoutez ici si nécessaire. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse facultatifs (nécessite gen2). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Version du moteur PostgreSQL. FreshRSS s'installe avec `--db-type pgsql`. |
| `db_name` | `freshrss` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `freshrss` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s de délai, seuil 20 | Sonde de démarrage ; le seuil élevé permet le temps d'installation au premier démarrage. |
| `liveness_probe` | HTTP `/i/` 300s de délai | Sonde de vivacité ; `/status` est un point de terminaison JSON non authentifié alternatif. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Désactivé par défaut ; FreshRSS ne requiert pas Redis. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis si activé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (FreshRSS n'en déclare aucun). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> runtime `gen1` avec des montages NFS, IAP sans identités
> autorisées, un `redis_port`/`backup_retention_days` hors de portée, un
> `database_type` qui ne correspond pas à une extension activée. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | Le désactiver place le répertoire de données FreshRSS sur un disque éphémère — `config.php`, l'état par utilisateur et le cache sont effacés à chaque démarrage à froid/redéploiement, forçant une réinstallation. |
| `nfs_mount_path` | `/var/www/FreshRSS/data` | Critique | Le monter ailleurs rend le répertoire de données éphémère (même effet que pas de NFS). |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommer recrée la base de données/l'utilisateur et orpheline toutes les données de flux. |
| `database_type` | `POSTGRES_15` | Critique | FreshRSS s'installe avec `--db-type pgsql` ; un moteur non-Postgres casse l'installateur et `db-init`. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `container_port` | `80` | Élevé | FreshRSS/Apache écoute sur le port 80 ; un mauvais port fait échouer la sonde de démarrage et le service ne devient jamais prêt. |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket Auth Proxy évite l'exigence SSL du TCP IP privé direct vers Cloud SQL Postgres ; le désactiver peut rompre la connectivité. |
| `min_instance_count` | `1` (par défaut) pour une actualisation fiable | Élevé | Avec `0` (mise à l'échelle à zéro), le cron d'actualisation des flux intégré au conteneur se met en pause en veille ; les flux ne sont mis à jour que lorsqu'une requête réveille le service. |
| `max_instance_count` | `1` | Élevé | L'exécution de plus d'une instance duplique le cron d'actualisation intégré au conteneur et divise l'état de session/cache basé sur les fichiers. |
| `enable_iap` | uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les clients mobiles utilisant l'API Google Reader / Fever. |
| `FRESHRSS_ADMIN_PASSWORD` (auto-généré) | Modifier dans l'interface utilisateur après la première connexion | Moyen | La rotation du secret seul ne réinitialise pas un compte déjà installé ; le premier mot de passe reste valide jusqu'à ce qu'il soit modifié dans l'application. |
| `memory_limit` | `2Gi` | Moyen | Des valeurs inférieures à 512Mi risquent un OOM en cas d'actualisation intensive des flux. |
| `application_version` | Épingler en production | Moyen | `latest` se résout en un tag épinglé au moment de la build, mais l'épinglage explicite rend les mises à niveau délibérées. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à FreshRSS partagée avec la variante GKE est décrite
dans **[FreshRSS_Common](FreshRSS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : FreshRSS sur Cloud Run](../labs/FreshRSS_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [FreshRSS sur GKE Autopilot](FreshRSS_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreshRSS Common — Configuration d'application partagée](FreshRSS_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Memos sur Google Cloud Run](Memos_CloudRun.md), [Trilium sur Google Cloud Run](Trilium_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md) dans la solution **Connaissances personnelles et lecture**.
