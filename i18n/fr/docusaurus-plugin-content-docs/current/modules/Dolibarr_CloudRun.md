---
title: "Dolibarr sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Dolibarr sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Dolibarr_CloudRun.md @ 15fd4c7 sha256:73fccf921e55 -->

# Dolibarr sur Google Cloud Run {#dolibarr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dolibarr_CloudRun.png" alt="Dolibarr sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dolibarr est une suite ERP et CRM gratuite et open source couvrant les clients et prospects,
les devis, les commandes, les factures, les produits et les stocks, les RH, les projets et la comptabilité via une
interface web PHP modulaire. Ce module déploie Dolibarr sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Dolibarr et sur la manière de les explorer et de les
opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Dolibarr s'exécute comme un conteneur PHP/Apache unique sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les documents/PDFs téléchargés persistent sous `/var/lib/dolibarr` après les redémarrages |
| Stockage d'objets | Cloud Storage | Un bucket `dolibarr-documents` provisionné automatiquement |
| Secrets | Secret Manager | `DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` auto-générés ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée
  (`database_type = MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est accessible via TCP sur l'IP privée.** Sur Cloud Run, cette variante
  par défaut `enable_cloudsql_volume = false`, de sorte que Dolibarr et le job `db-init`
  se connectent à l'IP privée de l'instance sur le port 3306 (Cloud SQL MySQL 8 utilise
  `caching_sha2_password`, géré par le job d'initialisation).
- **Instance unique par défaut.** `max_instance_count = 1`. Dolibarr conserve l'état de session
  et de verrouillage qui n'est pas sûr pour plusieurs instances sans stockage partagé et routage persistant —
  n'augmentez pas `max_instance_count` au-dessus de 1 sans vérifier cela au préalable.
- **La mise à l'échelle à zéro est activée** (`min_instance_count = 0`). Les démarrages à froid ajoutent quelques
  secondes plus le démarrage PHP/Apache sur la première requête après l'inactivité ; définissez
  `min_instance_count = 1` pour un service toujours chaud.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/lib/dolibarr`)
  afin que les documents téléchargés et les PDF générés survivent à la recréation du conteneur.
- **Installation automatique au premier démarrage.** `DOLI_INSTALL_AUTO = 1` fait en sorte que l'installateur Dolibarr
  crée le schéma au premier démarrage ; il n'y a pas de job de migration séparé.
- **`DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` sont générés automatiquement**
  et stockés dans Secret Manager. Le mot de passe administrateur est utilisé pour créer le compte
  super-administrateur de première exécution (nom d'utilisateur `DOLI_ADMIN_LOGIN`, par défaut `admin`).
- **`DOLI_URL_ROOT` est défini à partir de l'URL de service prédite** au moment de la planification afin que les liens absolus
  et les redirections de connexion se résolvent à l'adresse Cloud Run réelle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Dolibarr {#a-cloud-run--the-dolibarr-service}

Dolibarr s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dolibarr"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Dolibarr stocke toutes les données d'application (tiers, factures, produits, utilisateurs,
comptabilité) dans une instance Cloud SQL gérée pour MySQL 8.0. Avec la valeur par défaut de Cloud Run
`enable_cloudsql_volume = false`, le service se connecte via **TCP à l'IP privée de l'instance**
sur le port 3306 ; aucune IP publique n'est exposée. Lors du premier déploiement, le
job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations ; l'installateur Dolibarr
crée ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `dolibarr-documents`, injecté par la
couche commune) est provisionné automatiquement, aux côtés du bucket standard avec le suffixe `data`
de `storage_buckets`. Séparément, l'arborescence des documents de Dolibarr se trouve sur **NFS**
à `/var/lib/dolibarr` afin que les téléchargements et les PDF générés survivent à la recréation du conteneur.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse, NFS et CMEK.

### D. Secret Manager {#d-secret-manager}

Deux secrets Dolibarr sont générés automatiquement et stockés dans Secret Manager :
`DOLI_ADMIN_PASSWORD` (le mot de passe super-administrateur de première exécution) et
`DOLI_INSTANCE_UNIQUE_ID` (un sel de sécurité par instance). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut
être ajouté ; les paramètres d'ingress et de sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Dolibarr {#3-dolibarr-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte à Cloud SQL (IP privée TCP sur Cloud Run),
  crée de manière idempotente la base de données de l'application, l'utilisateur et les autorisations, vérifie que l'utilisateur de l'application
  peut se connecter, puis arrête le sidecar Auth Proxy. Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de job de migration séparé).** Avec
  `DOLI_INSTALL_AUTO = 1`, l'image Dolibarr exécute son propre installateur au premier
  démarrage du conteneur, créant le schéma dans la base de données vide. Lors des mises à niveau de version, l'image applique ses propres étapes de mise à niveau au démarrage.
- **Compte administrateur.** L'installateur crée un super-administrateur dont le nom d'utilisateur est
  `DOLI_ADMIN_LOGIN` (par défaut `admin`) et dont le mot de passe est le secret
  `DOLI_ADMIN_PASSWORD` généré. Récupérez-le avant la première connexion.
- **Alias de variables d'environnement de la base de données.** La plateforme injecte les variables standard `DB_*` ;
  Dolibarr lit `DOLI_DB_*`. Le point d'entrée du wrapper les alias au moment de l'exécution et
  préfère les valeurs injectées `DB_*` aux valeurs par défaut `mysql`/`dolidb`
  intégrées à l'image — sinon le conteneur attend indéfiniment un hôte inexistant.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 80 ; la sonde de vivacité est **HTTP**
  `GET /` (la page de connexion renvoie 200 sans authentification). Attendez plusieurs minutes au premier
  démarrage pour l'installateur avant que la page de connexion ne soit servie.
- **`DOLI_INSTANCE_UNIQUE_ID` est un sel stable.** Gardez-le constant tout au long de la durée de vie
  du déploiement ; il est utilisé pour les URL cron et la signature de jetons.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION" --filter="metadata.name~dolibarr"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les
paramètres spécifiques ou notables pour Dolibarr sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dolibarr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `dolibarr/dolibarr` utilisé comme base de build personnalisé ; `latest` est épinglé à un tag connu et fonctionnel (`23.0.3`) au moment du build. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les modules lourds/grandes bibliothèques de documents. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; conservez `post_max_size ≥ upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Dolibarr est livré comme un build personnalisé léger ; conservez `custom`. |
| `cpu_limit` | `1000m` | 1 vCPU minimum pour Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512 Mio ; 2 Gio recommandés pour la production. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Gardez à 1** sauf si le partage multi-instance est vérifié. |
| `container_port` | `80` | Dolibarr s'exécute sur Apache, port 80. |
| `enable_cloudsql_volume` | `false` | `false` = connexion TCP IP privée (par défaut Cloud Run). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut pour que les documents téléchargés persistent. |
| `nfs_mount_path` | `/var/www/documents` | Où Dolibarr stocke les documents/PDFs. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket supplémentaire au-delà du bucket `dolibarr-documents` auto-provisionné, que la couche commune injecte via `module_storage_buckets`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Moteur fixe — Dolibarr nécessite MySQL. |
| `db_name` | `dolibarr` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `dolibarr` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 80, délai de 30s, 20 tentatives | Nécessite uniquement que l'écouteur Apache se lie. |
| `liveness_probe` | HTTP `/` délai de 300s | La page de connexion renvoie 200 non authentifié. |
| `uptime_check_config` | désactivé (`path = "/"`) | Vérification de disponibilité Cloud Monitoring optionnelle. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Cache d'objets optionnel ; désactivé par défaut. |
| `redis_host` / `redis_port` | `""` / `6379` | Point de terminaison Redis lorsqu'il est activé. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `container_port` invalide, un `timeout_seconds`/`backup_retention_days` hors de portée, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | La sélection d'un moteur non-MySQL bloque l'installateur et toutes les requêtes. |
| `db_name` / `db_user` | Défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `DOLI_INSTANCE_UNIQUE_ID` (auto-généré) | Ne jamais changer | Critique | Changer le sel après le premier démarrage invalide les jetons signés et les URL cron. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les documents/PDFs téléchargés éphémères — perdus à chaque recréation de conteneur. |
| `max_instance_count` | `1` | Élevé | L'augmenter sans stockage partagé + routage persistant risque des sessions divisées, des conflits de verrouillage et un état de document incohérent. |
| `enable_backup_import` | `false` sauf restauration | Élevé | L'activer sans un `backup_uri` valide fait échouer le job d'importation. |
| `DOLI_URL_ROOT` (auto-défini) | URL de service réelle | Élevé | Une URL racine erronée rompt les liens absolus et la redirection de connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mio, le conteneur PHP/Apache manque de mémoire sous charge ; gen2 a un plancher de 512 Mio. |
| `DOLI_ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous empêche d'accéder au premier compte super-administrateur jusqu'à la réinitialisation via la base de données. |
| `ingress_settings` | `all` | Moyen | `internal` bloque l'accès public à l'interface utilisateur de Dolibarr. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid lors de la première requête après l'inactivité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur est publiquement accessible sans protection WAF. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Dolibarr
partagée avec la variante GKE est décrite dans **[Dolibarr_Common](Dolibarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dolibarr sur Cloud Run](../labs/Dolibarr_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Dolibarr sur GKE Autopilot](Dolibarr_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Dolibarr Common — Configuration d'application partagée](Dolibarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md), [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
