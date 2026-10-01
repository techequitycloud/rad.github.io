---
title: "TechnitiumDNS sur Google Cloud Run"
description: "Référence de configuration pour déployer TechnitiumDNS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/TechnitiumDNS_CloudRun.md @ 3055034 sha256:712f741a75ee -->

# TechnitiumDNS sur Google Cloud Run {#technitiumdns-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/TechnitiumDNS_CloudRun.png" alt="TechnitiumDNS sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **Précision sur le périmètre :** ce module déploie **uniquement la console d'administration web
> + l'API REST** de Technitium (port 5380/HTTP). La fonction principale de résolveur DNS de Technitium
> (port 53/udp+tcp) **ne peut pas** être exposée via l'ingress HTTP(S) uniquement de Cloud Run. Aucun
> client, où qu'il soit, ne peut interroger ce déploiement en tant que résolveur DNS. Consultez les §1
> et §7 ci-dessous pour l'explication complète.

Technitium DNS Server est un serveur DNS faisant autorité et récursif, auto-hébergé, open source et
multiplateforme (.NET), doté d'une console d'administration web complète et d'une API REST pour gérer
les zones, les enregistrements, le blocage des publicités et des traqueurs au niveau DNS, le transfert
conditionnel et le DNS-over-HTTPS/TLS. Ce module déploie l'image officielle `technitium/dns-server`
sur **Cloud Run v2**, sans modification, au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise TechnitiumDNS et sur la manière de les explorer
et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs
à toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

TechnitiumDNS s'exécute comme un conteneur préconstruit unique sur Cloud Run v2. Le déploiement
assemble un ensemble volontairement restreint de services Google Cloud — TechnitiumDNS n'a lui-même
aucune dépendance à une base de données ou à un cache :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur préconstruit unique, 500m vCPU / 512 MiB par défaut ; facturation à la requête, mise à l'échelle jusqu'à zéro |
| Base de données | **Aucune** | `database_type = "NONE"` ; les zones, paramètres et journaux sont des fichiers plats locaux, aucun Cloud SQL n'est provisionné |
| Persistance | Cloud Storage (GCS FUSE) | Bucket de configuration monté sur `/etc/dns` ; survit aux redémarrages et aux redéploiements |
| Stockage d'objets | Cloud Storage | Un bucket « config » créé automatiquement (également la couche de persistance ci-dessus) |
| Cache / file d'attente | **Aucun** | Pas de Redis ; TechnitiumDNS n'a besoin d'aucun cache externe |
| Secrets | Secret Manager | Un secret généré automatiquement : `DNS_SERVER_ADMIN_PASSWORD` |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut pour la **console web uniquement** — le port 53 n'est jamais exposé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — TechnitiumDNS conserve les
  zones, les paramètres et les journaux sous forme de fichiers plats locaux sous `/etc/dns`. Les
  variables liées à la base de données existent par souci d'exhaustivité mais sont sans effet.
- **Persistant par défaut.** Un volume GCS FUSE est monté automatiquement sur `/etc/dns` — la
  configuration, les zones et les journaux survivent aux redémarrages et aux redéploiements sans
  configuration supplémentaire.
- **Image préconstruite, sans Dockerfile personnalisé.** `container_image_source = "prebuilt"` déploie
  `technitium/dns-server` tel quel — vérifié localement : l'image démarre proprement et respecte
  `DNS_SERVER_ADMIN_PASSWORD` / `DNS_SERVER_DOMAIN` au premier démarrage.
- **Mise à l'échelle jusqu'à zéro par défaut** (`min_instance_count = 0`, `cpu_always_allocated = false`)
  — la console d'administration est une simple application requête/réponse, sans planificateur
  d'arrière-plan ni flux WebSocket.
- **Le point de terminaison de santé est `/`**, la page racine non authentifiée de la console, qui
  renvoie HTTP 200 avec le HTML complet de la console dès que le serveur se lie à son port.
- **Un secret généré automatiquement.** `DNS_SERVER_ADMIN_PASSWORD` initialise le compte `admin`
  initial lors du tout premier démarrage uniquement ; les redémarrages ultérieurs l'ignorent (le
  `auth.config` persisté prévaut).
- **Pas de résolveur DNS.** Voir le §7 ci-dessous — c'est le point le plus important à comprendre avant
  de déployer ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des
ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service de console TechnitiumDNS {#a-cloud-run--the-technitiumdns-console-service}

TechnitiumDNS s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les
  métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Persistance — le bucket Cloud Storage de configuration {#b-persistence--the-config-cloud-storage-bucket}

TechnitiumDNS n'a **aucune instance Cloud SQL**. Toutes les zones, tous les paramètres, la base
d'authentification et les journaux résident sous `/etc/dns`, adossés à un bucket Cloud Storage monté via
GCS FUSE et créé pour ce déploiement.

- **Console :** Cloud Storage → Buckets → recherchez le bucket nommé `gcs-<service-name>-config`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~-config"
  gcloud storage ls "gs://<bucket-name>/"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de montage de volumes GCS FUSE.

### C. Secret Manager {#c-secret-manager}

TechnitiumDNS génère exactement un secret au moment du déploiement : le mot de passe administrateur
initial.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app` — il s'agit de l'**URL de la console web**, et
non d'un point de terminaison DNS. Un équilibreur de charge HTTPS externe avec un domaine personnalisé,
Cloud CDN et Cloud Armor peut être ajouté pour la console ; rien de tout cela n'expose la résolution DNS
(port 53).

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run sont envoyées vers
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte optionnels.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application TechnitiumDNS {#3-technitiumdns-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** TechnitiumDNS n'a ni base de
  données externe ni étape de migration. Il lit et écrit des fichiers plats locaux sous `/etc/dns` dès
  son démarrage.
- **Initialisation de l'administrateur au premier démarrage.** `DNS_SERVER_ADMIN_PASSWORD` n'est
  appliqué que lorsque `/etc/dns/auth.config` n'existe pas encore (un déploiement réellement neuf). À
  chaque redémarrage ou redéploiement ultérieur, le `auth.config` persisté sur le volume monté sur GCS
  prévaut et le mot de passe injecté est ignoré.
- **Chemin de santé.** Les sondes de démarrage et de liveness ciblent `/`, qui renvoie HTTP 200 avec le
  HTML complet de la console dès que le serveur se lie au port 5380. Vérifiez :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w '%{http_code} %{size_download}\n' "$SERVICE_URL/"   # expect 200 and a large body
  ```
- **Connexion.** Ouvrez `$SERVICE_URL` dans un navigateur, connectez-vous en tant que `admin` avec le
  mot de passe stocké dans Secret Manager, et modifiez-le immédiatement depuis la page de gestion des
  utilisateurs de la console elle-même (Technitium ne relit pas `DNS_SERVER_ADMIN_PASSWORD` après le
  premier démarrage ; le modifier à cet endroit est donc le seul moyen d'en effectuer la rotation par la
  suite).
- **API REST.** Toutes les actions de la console sont également disponibles via l'API REST
  (`$SERVICE_URL/api/...`) à l'aide d'un jeton de session obtenu via `/api/user/login`. Consultez la
  [documentation de l'API de Technitium](https://github.com/TechnitiumSoftware/DnsServer/blob/master/APIDOCS.md).
- **Aucune résolution DNS depuis ce déploiement.** Voir le §7 ci-dessous.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement.
Seuls les paramètres propres à TechnitiumDNS ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `application_name` | `technitiumdns` | Nom de base du service, du dépôt du registre et des secrets. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `TechnitiumDNS` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image TechnitiumDNS (p. ex. `latest`, `13.5.1`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle telle quelle ; `custom` est accepté pour la compatibilité future, mais aucun Dockerfile n'est fourni. |
| `cpu_limit` | `"1000m"` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le minimum gen2 est de 512Mi). |
| `min_instance_count` | `0` | Descend à zéro en cas d'inactivité. |
| `max_instance_count` | `1` | Nombre maximal d'instances. |
| `container_port` | `5380` | Port par défaut de la console web. |
| `cpu_always_allocated` | `false` | Facturation à la requête — aucun travail d'arrière-plan pour lequel rester actif. |
| `enable_cloudsql_volume` | `false` | Désactivé — TechnitiumDNS n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Réplique l'image TechnitiumDNS dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à la console par défaut. |
| `enable_iap` | `false` | Exige une connexion Google. **Vivement recommandé** — sinon, la console repose uniquement sur son propre mot de passe administrateur. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `DNS_SERVER_*` supplémentaires (p. ex. `DNS_SERVER_FORWARDERS`, `DNS_SERVER_DOMAIN`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (secrets supplémentaires ; `DNS_SERVER_ADMIN_PASSWORD` est déjà raccordé). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires à monter ; le bucket de configuration sur `/etc/dns` est ajouté automatiquement. |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de configuration créé automatiquement. |
| `enable_nfs` | `false` | Inutile par défaut — le volume GCS sur `/etc/dns` assure déjà la persistance de l'état. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `NONE` | TechnitiumDNS n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `technitiumdns` | Sans effet — aucune base de données n'est provisionnée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | TechnitiumDNS n'a besoin d'aucun job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés optionnels. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 20s | Sonde de démarrage ciblant la page racine publique de la console. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de liveness. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring optionnel. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — TechnitiumDNS n'a aucune dépendance à Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut de la console web (pas un point de terminaison DNS). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de la base de données — vides pour le moteur par défaut `NONE`. |
| `database_password_secret` / `database_host` / `database_port` | Champs du point de terminaison de la base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de configuration). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la
> fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment
> du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant
> toute création de ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à ce que ce déploiement soit un résolveur DNS | Ne pas faire pointer les paramètres DNS des clients vers ce déploiement | **Critical** | Le port 53/udp+tcp n'est jamais exposé par l'ingress HTTP(S) uniquement de Cloud Run — les requêtes DNS adressées à ce déploiement échouent tout simplement ; seules la console web et l'API sont joignables. |
| `enable_iap` | `true` pour tout usage au-delà d'un test rapide | Critical | Sans IAP, la console n'est protégée que par son propre mot de passe administrateur sur l'internet public — un seul identifiant divulgué ou faible donne un accès complet à la gestion DNS. |
| Rotation de `DNS_SERVER_ADMIN_PASSWORD` | Modifier le mot de passe depuis la console après la première connexion | High | Technitium ne relit jamais la variable d'environnement après le premier démarrage — effectuer la rotation de la seule valeur dans Secret Manager ne modifie PAS le mot de passe effectif de la console. |
| Volume GCS sur `/etc/dns` | Laisser `enable_gcs_storage_volume` activé (par défaut) | Critical | Sans volume persistant monté, le système de fichiers racine en lecture seule de Cloud Run empêcherait toute modification de configuration ou de zone de survivre à un redémarrage ou à un redéploiement. |
| `ingress_settings` | `all` pour l'accès à la console, `internal` derrière IAP/VPN uniquement si c'est l'intention | Medium | `internal` bloque tout accès externe à la console, y compris celui de l'opérateur, sauf s'il existe un chemin via VPN ou bastion. |
| `min_instance_count` | `0` (par défaut) convient pour un usage d'administration occasionnel | Low | Les démarrages à froid ajoutent quelques secondes de latence à la première requête après une période d'inactivité ; passez à `1` uniquement si cela compte. |
| `application_version` | Épingler une version explicite en production | Low | `latest` suit les versions publiées en amont ; épinglez explicitement pour maîtriser le calendrier des mises à niveau. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et réplication d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à TechnitiumDNS, partagée avec
la variante GKE, est décrite dans **[TechnitiumDNS_Common](TechnitiumDNS_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : TechnitiumDNS sur Cloud Run](../labs/TechnitiumDNS_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [TechnitiumDNS Common — Configuration applicative partagée](TechnitiumDNS_Common.md) — la configuration partagée par les deux cibles de déploiement.
