---
title: "Module Xibo GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Xibo sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Xibo_GKE.md @ 2829548 sha256:db7911d042bd -->

# Module Xibo GKE — Guide de configuration {#xibo-gke-module--configuration-guide}

Ce guide décrit toutes les variables de configuration disponibles dans le module `Xibo_GKE`. `Xibo_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Xibo_Common`](./Xibo_Common.md) pour déployer le CMS [Xibo](https://xibosignage.com/) — un affichage numérique open-source qui planifie et distribue des mises en page, des listes de lecture et des médias à des réseaux de lecteurs d'affichage — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration dans `Xibo GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Xibo** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE uniquement :** La médiathèque de Xibo (`/var/www/cms/library`) contient tous les fichiers téléchargés et les certificats de signature OAuth du lecteur, et Apache la sert avec XSendFile, qui nécessite une sémantique de fichier POSIX réelle. C'est pourquoi Xibo est proposé sur GKE, où la médiathèque peut se trouver sur un volume persistant, plutôt que sur Cloud Run.

> **Lisez le [Groupe 7](#group-7-stateful-workloads) avant votre premier déploiement.** Avec les valeurs par défaut du module, la médiathèque **n'est pas** persistante.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section du guide App_GKE | Notes spécifiques à Xibo |
|---|---|---|
| Projet et identité | Groupe 1 — Projet et identité | Identique. |
| Identité de l'application | Groupe 3 — Identité de l'application | Les valeurs par défaut des noms d'affichage sont des résidus d'échafaudage ; voir [Groupe 3](#group-3-application-identity). |
| Exécution et mise à l'échelle | Groupe 4 — Exécution et mise à l'échelle | Build personnalisé à partir de `ghcr.io` ; `container_port = 80` ; voir [Groupe 4](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | Groupe 5 — Variables d'environnement et secrets | Variables `MYSQL_*` / `CMS_*` définies par le module ; voir [Groupe 5](#group-5-environment-variables--secrets). |
| Configuration du backend GKE | Groupe 6 — Configuration du backend GKE | `service_type = "ClusterIP"` ; voir [Groupe 6](#group-6-gke-backend-configuration). |
| Charges de travail avec état | Groupe 7 — StatefulSet / PVC | **Requis pour persister la médiathèque** ; voir [Groupe 7](#group-7-stateful-workloads). |
| Jobs d'initialisation et CronJobs | Groupe 11 — Automatisation des charges de travail | `db-init` fourni par `Xibo Common` ; voir [Groupe 11](#group-11-workload-automation). |
| Stockage — NFS | Groupe 13 — Stockage NFS | Monté par défaut à `/mnt/nfs`, inutilisé par Xibo ; voir [Groupe 13](#group-13-nfs). |
| Stockage — GCS | Groupe 14 — Cloud Storage | Deux buckets créés, inutilisés par Xibo ; voir [Groupe 14](#group-14-cloud-storage). |
| Configuration de la base de données | Groupe 16 — Configuration de la base de données | **MySQL 8.0, fixe** ; voir [Groupe 16](#group-16-database). |
| Planification et rétention des sauvegardes | Groupe 17 — Sauvegarde et maintenance | Identique. |
| Scripts SQL personnalisés | Groupe 18 — Scripts SQL personnalisés | Identique. |
| Observabilité et vérifications de santé | Groupe 10 — Observabilité | Sondes sur `/login`, et elles atteignent le conteneur déployé ; voir [Groupe 10](#group-10-observability--health). |
| WAF Cloud Armor | Groupe 21 — Cloud Armor et CDN | Identique. |
| Proxy conscient de l'identité (IAP) | Groupe 20 — Proxy conscient de l'identité | Les lecteurs doivent toujours atteindre le CMS ; voir [Groupes 20-22](#groups-2022-iap-cloud-armor-vpc-service-controls). |
| Autorisation binaire | Groupe 12 — CI/CD | Identique. |
| Contrôles de service VPC | Groupe 22 — Contrôles de service VPC et journalisation d'audit | Identique. |
| Pilote CSI du magasin de secrets | Groupe 5 — Variables d'environnement et secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | Groupe 19 — Accès et réseau | Identique. |
| Domaine personnalisé et IP statique | Groupe 19 — Accès et réseau | Définir `CMS_SERVER_NAME` pour un domaine personnalisé ; voir [Groupe 19](#group-19-custom-domain--networking). |
| Déclencheurs Cloud Build | Groupe 12 — CI/CD | Identique. |
| Pipeline Cloud Deploy | Groupe 12 — CI/CD | Identique. |
| Mise en miroir des images | Groupe 4 — Exécution et mise à l'échelle | Identique. |
| Budgets d'interruption de pod | Groupe 9 — Fiabilité | Activé par défaut. |
| Rotation automatique des mots de passe | Groupe 16 — Configuration de la base de données | Voir [Groupe 16](#group-16-database). |
| Cache Redis | Groupe 15 — Cache Redis | Non utilisé par Xibo. |
| Importation de sauvegarde | Groupe 17 — Sauvegarde et maintenance | Identique. |

---

## Comment Xibo GKE se rapporte à App GKE {#how-xibo-gke-relates-to-app-gke}

`Xibo GKE` transmet ses variables à `App GKE` et ajoute un sous-module `Xibo Common` qui fournit une configuration spécifique à Xibo. Les principaux effets sont les suivants :

1. **Une image personnalisée fine de ghcr.io.** `Xibo Common` fournit un Dockerfile, `FROM ghcr.io/xibosignage/xibo-cms:${XIBO_VERSION}`, qui ajoute un point d'entrée enveloppe. `XIBO_VERSION` est défini à partir de `application_version` (un argument de build spécifique à l'application, de sorte que le générique `APP_VERSION` de la Fondation ne peut pas le remplacer). `xibosignage/xibo-cms` de Docker Hub est abandonné (tag le plus récent `release23`, 2023) et n'a jamais reçu Xibo 4.x.
2. **MySQL 8.0 est fixe.** `Xibo Common` définit `database_type = "MYSQL_8_0"` dans la configuration de l'application, ce que `App GKE` provisionne, quelle que soit la valeur de `database_type` de l'enveloppe.
3. **TCP vers l'IP privée, pas le socket.** Le point d'entrée de l'enveloppe exporte `MYSQL_HOST = $DB_IP`, `MYSQL_PORT = ${DB_PORT:-3306}`, `MYSQL_DATABASE`, `MYSQL_USER` et `MYSQL_PASSWORD`, puis passe la main à `/entrypoint.sh` de Xibo. `DB_HOST` peut être un répertoire de socket, que Xibo ne peut pas utiliser. `Xibo Common` corrige donc `enable_cloudsql_volume = false`.
4. **Installation non interactive.** Le point d'entrée de Xibo crée la base de données si elle est absente et exécute l'installation/mise à niveau complète de phinx à chaque démarrage. Le job `db-init` n'existe que pour créer l'utilisateur et la base de données MySQL avec `caching_sha2_password` de Cloud SQL MySQL 8 géré correctement.
5. **Trois valeurs par défaut d'image corrigées.** `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT = "false"` (l'image exige une vérification sans CA, donc PDO refuse Cloud SQL tel qu'il est livré) ; `CMS_PHP_COOKIE_SECURE = "On"` (le conteneur ne voit que HTTP derrière la passerelle de terminaison TLS) ; `CMS_SERVER_NAME` dérivé de l'URL du service au lieu de `localhost` livré.
6. **Sondes sur `/login`.** Xibo n'a pas de point de terminaison de santé ; le générique `/healthz` de la Fondation renverrait 404 et redémarrerait un pod sain. `/login` renvoie 200 et prouve que le CMS a été rendu. `Xibo GKE` transfère `startup_probe_config`/`health_check_config` dans `Xibo Common`, ce sont donc les sondes réellement déployées.
7. **Le service web est ClusterIP.** Le CMS est publié via la passerelle L7 ; un service `LoadBalancer` dépenserait une deuxième IP externe sur la même surface HTTP.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity). `project_id` (requis), `tenant_id` (`"demo"`), `region` (`"us-central1"`, repli lorsque la découverte de sous-réseau ne trouve rien).

---

## Groupe 2 : Environnement de déploiement {#group-2-deployment-environment}

Identique à `App_GKE` : `support_users` (`[]`), `resource_labels` (`{}`).

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

| Variable | Valeur par défaut Xibo GKE | Notes |
|---|---|---|
| `application_name` | `"xibo"` | Nom de base pour toutes les ressources. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Wiki.js"` | **Résidu d'échafaudage** du module à partir duquel cet enveloppe a été cloné. Il est transmis à `Xibo Common` comme `display_name` et devient le nom d'affichage de l'application. Définissez-le sur quelque chose comme `"Xibo CMS"`. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | Également résidu d'échafaudage ; modifiez-le librement. |
| `application_version` | `"release-4.5.2"` | Tag sur `ghcr.io/xibosignage/xibo-cms`, utilisé comme `XIBO_VERSION` du build. Épinglez une version exacte : une reconstruction sous un tag inchangé ne produit pas de diff Terraform et donc pas de déploiement. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

| Variable | Valeur par défaut Xibo GKE | Notes |
|---|---|---|
| `container_image_source` | `"custom"` | Construit l'image de l'enveloppe via Cloud Build. |
| `container_image` | `"ghcr.io/xibosignage/xibo-cms"` | Référence de l'image de base. |
| `container_port` | `80` | Fixé par `Xibo Common` — Apache sur 80 ; le point d'entrée ne lit jamais `$PORT`. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Seules les limites sont transmises. |
| `min_instance_count` | `1` | — |
| `max_instance_count` | `3` | **Défini sur `1`.** Chaque réplica aurait sa propre médiathèque (voir Groupe 7). |
| `enable_cloudsql_volume` | `true` | **N'a aucun effet.** `Xibo Common` fixe la configuration de l'application à `false` et Xibo se connecte via TCP. |

Les variables d'exécution restantes (`deploy_application`, `container_build_config`, `enable_image_mirroring`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

`Xibo Common` les définit sur le conteneur ; les entrées `environment_variables` sont fusionnées **par-dessus**, vous pouvez donc les remplacer.

| Variable | Valeur | Objectif |
|---|---|---|
| `MYSQL_PORT` | `"3306"` | Port de la base de données (le point d'entrée le réexporte de `DB_PORT` lorsqu'il est défini). |
| `MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` | `"false"` | Le certificat IP privée de Cloud SQL ne peut pas être vérifié depuis le conteneur ; le `true` livré avec l'image sans CA fait que PDO refuse la connexion. Le trafic reste sur la plage privée du VPC. |
| `CMS_PHP_COOKIE_SECURE` | `"On"` | Sécurise les cookies de session derrière la passerelle de terminaison TLS. |
| `CMS_PHP_MEMORY_LIMIT` | `"512M"` | Limite de mémoire PHP (le 256M livré échoue sur les importations de grandes mises en page). |
| `CMS_PHP_CLI_MEMORY_LIMIT` | `"512M"` | Idem, pour PHP CLI. |

**Définies par le point d'entrée de l'enveloppe au démarrage :**

| Variable | Source |
|---|---|
| `MYSQL_HOST` | `DB_IP` (IP privée) |
| `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD` | `DB_NAME`, `DB_USER`, `DB_PASSWORD` (injectées par `App GKE`) |
| `CMS_SERVER_NAME` | Uniquement si non défini ou `localhost` : la partie hôte de `CLOUDRUN_SERVICE_URL`, `GKE_SERVICE_URL` ou `SERVICE_URL` (la première présente) |

Le point d'entrée échoue rapidement si `DB_IP`, `DB_NAME`, `DB_USER` ou `DB_PASSWORD` est manquant.

**Remplacements utiles :**

| Variable | Quand |
|---|---|
| `CMS_SERVER_NAME` | Servir sur un domaine personnalisé — Xibo l'écrit dans la configuration du lecteur et les liens sortants. |
| `CMS_PHP_MEMORY_LIMIT` / `CMS_PHP_CLI_MEMORY_LIMIT` | Très grandes importations. |
| `XMR_HOST` | Uniquement si vous exécutez le serveur push XMR de Xibo séparément — ce module n'en déploie pas. |

**Secrets.** Xibo ne crée pas ses propres secrets d'application. Les seules informations d'identification sont le mot de passe de la base de données (`DB_PASSWORD`) et le mot de passe root utilisé par `db-init`, tous deux créés et injectés par `App GKE`. `secret_environment_variables`, `secret_rotation_period`, `secret_propagation_delay` et `protect_sensitive_environment_variables` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Configuration du backend GKE {#group-6-gke-backend-configuration}

| Variable | Valeur par défaut Xibo GKE | Notes |
|---|---|---|
| `service_type` | `"ClusterIP"` | La passerelle fournit déjà l'adresse externe. Un `LoadBalancer` ici dépense une deuxième IP externe — ce qui, sur un projet à son quota d'adresses, peut laisser le répartiteur de charge d'un autre module `<pending>`. |
| `workload_type` | `null` | Se résout en `"StatefulSet"` lorsque `stateful_pvc_enabled = true`, sinon `"Deployment"`. |
| `session_affinity` | `"ClientIP"` | — |
| `deployment_strategy` | `null` | Déclaré mais non référencé — aucun effet. |

`namespace_name`, `enable_network_segmentation` et `termination_grace_period_seconds` (`30`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-6--gke-backend-config).

---

## Groupe 7 : Charges de travail avec état {#group-7-stateful-workloads}

**Ce groupe décide si les médias téléchargés survivent à un redémarrage de pod.**

Xibo conserve tout ce qui est important sur le disque sous `/var/www/cms/library` : tous les médias téléchargés, le répertoire `certs/` contenant les clés de signature OAuth du lecteur, `brand/`, `playersoftware/` et `temp/`. La base de données stocke l'*emplacement* ; les fichiers eux-mêmes ne sont que sur le disque.

Avec les valeurs par défaut du module, rien n'est monté à ce chemin :

| Variable | Valeur par défaut | Effet de la valeur par défaut |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Se résout en `false` → le CMS s'exécute comme un `Deployment` sans PVC. |
| `stateful_pvc_mount_path` | `"/data"` | Même avec un PVC activé, il serait monté à `/data`, et non à la médiathèque. |

**Paramètres recommandés, appliqués lors du premier déploiement :**

```hcl
stateful_pvc_enabled       = true
stateful_pvc_mount_path    = "/var/www/cms/library"
stateful_pvc_size          = "20Gi"      # size for your media
stateful_pvc_storage_class = "standard-rwo"
max_instance_count         = 1
```

Un modèle de revendication de volume de StatefulSet ne peut pas être modifié sur place, il faut donc choisir la taille et la classe à l'avance. L'activation du PVC sur un déploiement existant remplace le `Deployment` par un `StatefulSet` dont la médiathèque démarre vide — téléchargez les médias après. GCS Fuse (`gcs_volumes`) n'est pas un substitut approprié pour la médiathèque car XSendFile a besoin de la sémantique POSIX.

`stateful_pvc_storage_class` (`"standard-rwo"`), `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy` et `stateful_fs_group` (`0`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-7--statefulset--pvc).

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

`enable_pod_disruption_budget` est par défaut `true` et `pdb_min_available` est par défaut `"1"`. Avec un seul réplica, les évictions volontaires (mises à niveau de nœuds) attendent le pod de remplacement.

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

`startup_probe_config` et `health_check_config` sont transférés dans `Xibo Common` comme `startup_probe`/`liveness_probe` du conteneur, ce sont donc les sondes réellement déployées.

| Sonde | Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage (`startup_probe_config`) | `/login` (HTTP) | 60s | 5s | 10s | 3 |
| Vivacité (`health_check_config`) | `/login` (HTTP) | 60s | 5s | 30s | 3 |

Ne changez pas le chemin vers `/healthz` — Xibo renvoie 404 là-bas. `/` passe également (302 → `/login`), mais `/login` renvoie 200 et prouve que le CMS a été rendu.

`uptime_check_config` est par défaut `{ enabled = false, path = "/" }` ; `alert_policies` se comporte comme décrit dans [App_GKE](./App_GKE.md#group-10--observability).

---

## Groupe 11 : Automatisation des charges de travail {#group-11-workload-automation}

Lorsque `initialization_jobs` est vide, `Xibo Common` fournit un job :

| Champ | Valeur |
|---|---|
| Nom du job | `db-init` |
| Image | `mysql:8.0-debian` |
| Script | `Xibo_Common/scripts/db-init.sh` |
| Exécutions | Sur apply (`execute_on_apply = true`) |
| Délai d'expiration / tentatives | 600s / 3 |
| CPU / Mémoire | `1000m` / `512Mi` |

Il attend MySQL sur le port 3306, crée (ou réinitialise le mot de passe de) l'utilisateur `xibo`, crée la base de données `xibo`, lui accorde tous les privilèges, vérifie que l'utilisateur peut se connecter, puis signale à tout sidecar Cloud SQL Proxy dans le pod du Job de se terminer afin que le Job puisse se terminer. Une liste `initialization_jobs` non vide **remplace** ce job. `cron_jobs` et `additional_services` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Groupe 12 : CI/CD et intégration GitHub {#group-12-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

---

## Groupe 13 : NFS {#group-13-nfs}

`enable_nfs` est par défaut `true` et monte le partage NFS `Services_GCP` à `nfs_mount_path` (`"/mnt/nfs"`). Xibo ne lit ni n'écrit ce chemin. Les autres variables se comportent comme décrit dans [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Groupe 14 : Cloud Storage {#group-14-cloud-storage}

Avec `create_cloud_storage = true`, deux buckets sont créés : `storage` (déclaré par `Xibo Common`) et `data` (la valeur par défaut `storage_buckets` de l'enveloppe). Une entrée dans `storage_buckets` avec le même `name_suffix` remplace le préréglage. Xibo n'utilise aucun des deux buckets. Les variables de rétention d'image et CMEK se comportent comme décrit dans [App_GKE](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 15 : Redis {#group-15-redis}

`enable_redis` est par défaut `false`. Xibo n'est pas configuré pour utiliser Redis par ce module.

---

## Groupe 16 : Base de données {#group-16-database}

| Variable | Valeur par défaut Xibo GKE | Notes |
|---|---|---|
| `database_type` | `"MYSQL_8_0"` | Alimente uniquement les gardes de validation au moment de la planification. Le moteur est fixé à MySQL 8.0 par `Xibo Common`. |
| `application_database_name` | `"xibo"` | Passé à `Xibo Common` comme `db_name`. **Ne pas modifier après le déploiement** — une nouvelle base de données vide serait créée. |
| `application_database_user` | `"xibo"` | Passé comme `db_user`. Ne pas modifier après le déploiement. |
| `database_password_length` | `32` | Le modifier régénère le mot de passe d'un utilisateur de base de données en direct. |
| `enable_auto_password_rotation` | `false` | La rotation redémarre les pods après `rotation_propagation_delay_sec` (`90`). |

`enable_mysql_plugins`/`mysql_plugins` et les alias `db_*_env_var_name` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-16--database-configuration). Les variables d'extension PostgreSQL ne s'appliquent pas.

---

## Groupes 17-18 : Sauvegarde et maintenance, SQL personnalisé {#groups-1718-backup--maintenance-custom-sql}

Identique à `App_GKE`. Les sauvegardes couvrent **uniquement la base de données** — les médias dans la médiathèque sont sur le volume du pod (lorsque vous en configurez un), pas dans Cloud SQL. `backup_schedule` (`"0 2 * * *"`), `backup_retention_days` (`7`), `enable_backup_import` (`false`), `backup_source` (`"gcs"`), `backup_file` (`"backup.sql"`), `backup_format` (`"sql"`), et les variables `custom_sql_scripts_*`.

---

## Groupe 19 : Domaine personnalisé et réseau {#group-19-custom-domain--networking}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking). Avec `application_domains = []`, la passerelle obtient un nom d'hôte `nip.io` gratuit à partir de son IP réservée, et `CMS_SERVER_NAME` en est dérivé.

> **Sur un domaine personnalisé**, définissez également `CMS_SERVER_NAME = "<your-domain>"` dans `environment_variables`. Le point d'entrée ne le dérive que s'il n'est pas défini ou `localhost`, et Xibo l'écrit dans les lecteurs de configuration reçus.

---

## Groupes 20-22 : IAP, Cloud Armor, Contrôles de service VPC {#groups-2022-iap-cloud-armor-vpc-service-controls}

Identique à `App_GKE` — voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy). Si vous activez IAP, n'oubliez pas que les lecteurs d'affichage appellent également le CMS et ne peuvent pas effectuer de connexion Google.

---

## Exploration du déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

- **Kubernetes Engine → Charges de travail**, filtré sur l'espace de noms : la charge de travail CMS (un `Deployment`, ou un `StatefulSet` lorsqu'un PVC est activé) et le job `db-init`.
- **Kubernetes Engine → Passerelles, Services et Ingress** : le service ClusterIP et la passerelle avec son IP externe.
- **SQL** : l'instance Cloud SQL MySQL 8.0 et la base de données `xibo`.
- **Cloud Build → Historique** : le build d'image à partir du Dockerfile `Xibo_Common`.
- **Sécurité → Secret Manager** : le secret du mot de passe de la base de données.

### gcloud CLI et kubectl {#gcloud-cli-and-kubectl}

```bash
gcloud container clusters get-credentials CLUSTER_NAME --region=REGION --project=PROJECT_ID

kubectl get deploy,statefulset,pods,pvc,jobs -n NAMESPACE

# Start-up line printed by the wrapper entrypoint: db host:port/name and server_name
kubectl logs -n NAMESPACE POD_NAME | grep "\[startup\]"

# db-init job output
kubectl logs -n NAMESPACE job/JOB_NAME

# Is anything mounted at the library?
kubectl exec -n NAMESPACE POD_NAME -- df -h /var/www/cms/library

# The login page through the Gateway
curl -s -o /dev/null -w "%{http_code}\n" SERVICE_URL/login
```

---

## Sorties du module {#module-outputs}

`Xibo GKE` expose les sorties `App_GKE` standard, y compris :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `service_url` | URL du service (l'URL `nip.io` de la passerelle lorsqu'aucun domaine personnalisé n'est défini) |
| `service_external_ip` | IP externe du LoadBalancer (si l'IP statique est réservée) |
| `namespace` | Espace de noms Kubernetes |
| `database_instance_name` | Nom de l'instance Cloud SQL |
| `database_name` / `database_user` | Base de données et utilisateur de l'application |
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données |
| `storage_buckets` | Buckets GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `initialization_jobs` | Noms des jobs d'initialisation créés |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster était accessible et que les ressources Kubernetes ont été déployées |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(requis)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `stateful_pvc_enabled` + `stateful_pvc_mount_path` | `true` + `"/var/www/cms/library"` | **Critique** | Les valeurs par défaut du module laissent la médiathèque sur le système de fichiers du conteneur : tous les fichiers téléchargés et les certificats de signature du lecteur sont perdus lorsque le pod est remplacé. |
| `max_instance_count` | `1` | **Élevé** | Plus d'un réplica donne à chacun sa propre médiathèque ; les médias téléchargés via un pod sont manquants sur les autres. |
| `application_database_name` / `application_database_user` | `"xibo"` | **Critique** | La modification après le déploiement pointe le CMS vers une nouvelle base de données vide. |
| `database_password_length` | `32` | **Élevé** | Le modifier régénère une information d'identification en direct ; une incompatibilité entre le secret et l'octroi de la base de données bloque le CMS. |
| `application_version` | `"release-4.5.2"` | **Élevé** | Doit exister sur `ghcr.io/xibosignage/xibo-cms`. La réutilisation d'un tag après une reconstruction ne produit aucun déploiement. |
| `startup_probe_config.path` / `health_check_config.path` | `"/login"` | **Élevé** | `/healthz` renvoie 404 et la sonde redémarre un pod sain en boucle. |
| `environment_variables.MYSQL_ATTR_SSL_VERIFY_SERVER_CERT` | `"false"` (défini par le module) | **Élevé** | Le remplacer par `true` fait que PDO refuse la connexion Cloud SQL. |
| `CMS_SERVER_NAME` sur un domaine personnalisé | votre domaine | **Moyen** | Laissé dérivé, les lecteurs et les liens sortants utilisent l'hôte `nip.io`. |
| Connexion via HTTP simple | utiliser HTTPS | **Moyen** | `CMS_PHP_COOKIE_SECURE = "On"` : le navigateur ne renverra pas le cookie de session via HTTP, la connexion semble donc ne pas fonctionner. |
| Mot de passe `xibo_admin` | changer lors de la première connexion | **Critique** | L'image amorce un compte administrateur fixe ; le module ne définit pas son mot de passe. |
| `application_display_name` | `"Xibo CMS"` | **Faible** | Le `"Wiki.js"` par défaut est affiché dans la plateforme. |
| `service_type` | `"ClusterIP"` | **Moyen** | `"LoadBalancer"` dépense une deuxième IP externe pour la même surface HTTP. |
| `enable_cloudsql_volume` | (n'importe lequel) | **Faible** | N'a aucun effet pour Xibo. |
| `enable_nfs` / `create_cloud_storage` | `true` / `true` | **Faible** | Provisionné mais inutilisé par Xibo — un petit coût évitable. |
| `backup_retention_days` | `7` | **Moyen** | Sauvegardes de base de données uniquement ; les médias sur le volume de la médiathèque ne sont pas inclus. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Xibo sur GKE Autopilot](../labs/Xibo_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Xibo Common — Configuration d'application partagée](Xibo_Common.md) — la configuration spécifique à Xibo sur laquelle ce module est basé.
