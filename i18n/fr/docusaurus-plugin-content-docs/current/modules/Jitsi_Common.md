---
title: "Module de configuration partagée Jitsi Common"
description: "Référence de configuration partagée pour le module Jitsi — paramètres de la couche application consommés par le déploiement GKE Autopilot."
---

<!-- translated-from: docs/modules/Jitsi_Common.md @ 2829548 sha256:247f9cad6b2d -->

# Module de configuration partagée Jitsi Common {#jitsi-common-shared-configuration-module}

Le module `Jitsi Common` définit la configuration de la visioconférence Jitsi Meet pour l'écosystème des modules RAD. Il produit une sortie `config` consommée par le module wrapper de la plateforme `Jitsi GKE`. Contrairement à la plupart des modules Common, il n'est **pas** purement déclaratif : il génère deux mots de passe de composant XMPP internes et les stocke dans Secret Manager.

## 1. Vue d'ensemble {#1-overview}

**Objectif** : Centraliser toute la configuration spécifique à Jitsi — les quatre images et leur balise de version partagée, la famille de domaines XMPP internes, l'environnement pour chaque composant, les trois `additional_services` back-end, et les mots de passe des composants partagés — dans un seul module.

**Architecture** :

```
Layer 3: Application Wrapper
└── Jitsi_GKE  ── reserves the jvb static IP, computes the prosody Service name,
                  instantiates Jitsi_Common
                           ↓
              Jitsi_Common (this module)
              Creates: 2 random passwords + 2 Secret Manager secrets (+ versions)
              Produces: config, secret_ids, secret_values, storage_buckets, path
                           ↓
Layer 2: Platform Module
└── App_GKE       (Kubernetes deployment)
                           ↓
Layer 1: App_Common (networking, storage, secrets, IAM)
```

Il n'y a pas de variante Cloud Run : le pont vidéo nécessite de l'UDP entrant et une adresse publique fixe.

**Caractéristiques clés** :
- **Quatre images, une balise.** `jitsi/web` est le conteneur principal ; `jitsi/prosody`, `jitsi/jicofo` et `jitsi/jvb` sont `additional_services`. Tous les quatre utilisent `application_version` (par défaut `stable-11031`).
- **Pré-construit, pas de Dockerfile.** Les quatre images sont pilotées uniquement par des variables d'environnement (s6 + modèles confd), donc `image_source = "prebuilt"` et la configuration de build sont désactivées. Le module n'a pas de répertoire `scripts/`.
- **Pas de base de données.** `database_type = "NONE"` ; l'état de la conférence est en mémoire de prosody.
- **Média sur UDP.** jvb est exposé comme un `LoadBalancer` UDP épinglé à une adresse que le wrapper réserve. Cette build n'a pas de repli média TCP.
- **Mots de passe de composants générés et partagés** pour jicofo et jvb, lus par prosody et le composant correspondant à partir du même Secret Kubernetes.

---

## 2. Sorties {#2-outputs}

### `config` {#config}
L'objet de configuration de l'application passé à `App_GKE` via `application_config`.

| Champ | Valeur / Description |
|---|---|
| `app_name` | `var.application_name` (par défaut `"jitsi"`) |
| `application_version` | `var.application_version` (par défaut `"stable-11031"`) |
| `display_name` / `description` | `var.display_name` / `var.description` |
| `container_image` | `"jitsi/web"` |
| `image_source` | `"prebuilt"` |
| `enable_image_mirroring` | `var.enable_image_mirroring` (par défaut `true`) |
| `container_build_config` | `enabled = false`, tous les autres champs `null`/vides |
| `container_port` | `80` — la passerelle termine le TLS et transmet le HTTP en clair |
| `database_type` | `"NONE"` (`db_name`/`db_user` vides) |
| `enable_cloudsql_volume` | `false` |
| `gcs_volumes` | `[]` |
| `container_resources` | `cpu_limit = var.cpu_limit` (`"1000m"`), `memory_limit = var.memory_limit` (`"2Gi"`), requêtes `null` |
| `min_instance_count` / `max_instance_count` | `var.min_instance_count` (`1`) / `var.max_instance_count` (`3`) — uniquement la couche web |
| `environment_variables` | Variables du conteneur web (voir §4) fusionnées avec `var.environment_variables` |
| `secret_environment_variables` | `JICOFO_AUTH_PASSWORD`, `JVB_AUTH_PASSWORD` (ID Secret Manager) fusionnés avec `var.secret_environment_variables` |
| `initialization_jobs` | `[]` |
| `startup_probe` / `liveness_probe` | `var.startup_probe` / `var.liveness_probe` (voir §6) |
| `additional_services` | prosody, jicofo, jvb (voir §5) |

### `secret_ids` {#secret_ids}
`{ JICOFO_AUTH_PASSWORD = <secret id>, JVB_AUTH_PASSWORD = <secret id> }`. Le wrapper le passe comme `module_secret_env_vars`.

### `secret_values` (sensible) {#secret_values-sensitive}
Les mots de passe générés bruts. Le wrapper les passe comme `explicit_secret_values` afin que le **premier** apply réussisse — la recherche Secret Manager au moment du plan de la Foundation ne peut pas lire une version que le même apply n'a pas encore créée.

### `storage_buckets` {#storage_buckets}
`[]` — Jitsi n'a pas besoin de buckets.

### `path` {#path}
Le répertoire du module.

---

## 3. Variables d'entrée {#3-input-variables}

### Application {#application}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `application_name` | `string` | `"jitsi"` | Nom de base ; fait également partie des ID de secret. |
| `application_version` | `string` | `"stable-11031"` | Balise appliquée aux quatre images. La valeur du wrapper l'emporte. |
| `display_name` | `string` | `"Jitsi Meet"` | Nom d'affichage. |
| `description` | `string` | `"Jitsi Meet — open-source video conferencing: browser-based meetings with no account required."` | Description. |
| `cpu_limit` | `string` | `"1000m"` | Limite de CPU du conteneur web. |
| `memory_limit` | `string` | `"2Gi"` | Limite de mémoire du conteneur web. |
| `min_instance_count` | `number` | `1` | Réplicas web minimum. |
| `max_instance_count` | `number` | `3` | Réplicas web maximum. |
| `environment_variables` | `map(string)` | `{}` | Variables d'environnement supplémentaires du conteneur web, fusionnées avec celles du module. |
| `secret_environment_variables` | `map(string)` | `{}` | Variables d'environnement secrètes supplémentaires du conteneur web. |
| `enable_image_mirroring` | `bool` | `true` | Mettre en miroir l'image web dans Artifact Registry. |
| `startup_probe` / `liveness_probe` | `object` | voir §6 | Sondes du conteneur web. |

### Spécifique à Jitsi {#jitsi-specific}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `public_url` | `string` | `""` | `PUBLIC_URL` pour le web et prosody — l'URL utilisée par les navigateurs. Non dérivée si vide. |
| `xmpp_domain` | `string` | `"meet.jitsi"` | Racine de la famille de domaines XMPP internes. Pas de DNS public. |
| `xmpp_server_host` | `string` | `""` | Nom DNS du Service de prosody. Défini par le wrapper (`<service-name>-prosody`) ; ne pas le surcharger. |
| `jvb_port` | `number` | `10000` | Port média UDP. |
| `jvb_loadbalancer_ip` | `string` | `""` | IP externe réservée annoncée par jvb. Définie par le wrapper à partir d'un `google_compute_address`. |
| `enable_auth` | `bool` | `false` | Exiger une authentification pour créer une salle. |
| `enable_guests` | `bool` | `true` | Permettre aux utilisateurs non authentifiés de rejoindre des salles créées par un utilisateur authentifié. |
| `timezone` | `string` | `"UTC"` | `TZ` pour chaque conteneur. |

### Placement des secrets {#secrets-placement}

| Variable | Type | Défaut | Description |
|---|---|---|---|
| `project_id` | `string` | `""` | Projet pour les deux secrets Secret Manager. |
| `resource_prefix` | `string` | `""` | Préfixe dans les ID de secret (`secret-<prefix>-<application_name>-jicofo-auth`). |
| `region` | `string` | `"us-central1"` | L'emplacement du réplica unique des deux secrets. |

### Déclarées mais inutilisées {#declared-but-unused}

`labels`, `deployment_id_suffix`, `service_url`, `admin_username` (Jitsi n'a pas de compte administrateur ni d'interface utilisateur d'administration), `admin_email`, `tenant_id` (validées, non utilisées autrement), `db_name`, `db_user`, `gcs_volumes`, `initialization_jobs`, `enable_cloudsql_volume` et `enable_gcs_storage_volume` sont déclarées pour la cohérence de l'interface mais ne sont pas lues par `main.tf`. Les descriptions sur `startup_probe` et `enable_gcs_storage_volume` mentionnent phinx/MySQL et une bibliothèque CMS ; elles ont été reprises d'un autre module et ne décrivent pas Jitsi.

---

## 4. Variables d'environnement {#4-environment-variables}

### Conteneur web (`jitsi/web`) {#web-container-jitsiweb}

| Variable | Valeur | Objectif |
|---|---|---|
| `TZ` | `var.timezone` | Fuseau horaire du conteneur. |
| `PUBLIC_URL` | `var.public_url` | URL publique écrite dans la configuration servie. |
| `XMPP_DOMAIN` | `var.xmpp_domain` | Hôte virtuel XMPP principal. |
| `XMPP_AUTH_DOMAIN` | `auth.<xmpp_domain>` | Utilisateurs authentifiés. |
| `XMPP_GUEST_DOMAIN` | `guest.<xmpp_domain>` | Invités. |
| `XMPP_MUC_DOMAIN` | `muc.<xmpp_domain>` | Salles de conférence. |
| `XMPP_INTERNAL_MUC_DOMAIN` | `internal-muc.<xmpp_domain>` | Salles de composants internes (bridge brewery). |
| `XMPP_RECORDER_DOMAIN` | `recorder.<xmpp_domain>` | Domaine de l'enregistreur. |
| `XMPP_SERVER` | `var.xmpp_server_host` | Où prosody s'exécute réellement. |
| `XMPP_BOSH_URL_BASE` | `http://<xmpp_server_host>:5280` | Point de terminaison BOSH/WebSocket de prosody que le web proxyfie. |
| `XMPP_WEBSOCKET` | `/xmpp-websocket` | Chemin sur l'origine publique ; le WebSocket XMPP du navigateur passe par le nginx du web. |
| `ENABLE_AUTH` / `ENABLE_GUESTS` | `"1"` ou `"0"` | Politique de création de salle. |
| `ENABLE_LETSENCRYPT` | `"0"` | La passerelle termine le TLS ; une tentative de certificat intra-pod échouerait à son défi HTTP-01. |
| `DISABLE_HTTPS` | `"1"` | Le conteneur ne sert que du HTTP. |

### Conteneurs back-end {#back-end-containers}

| Conteneur | Variables |
|---|---|
| prosody | `TZ`, `PUBLIC_URL`, les six valeurs `XMPP_*_DOMAIN`, `JICOFO_AUTH_USER = "focus"`, `JVB_AUTH_USER = "jvb"`, `ENABLE_AUTH`, `ENABLE_GUESTS` ; secrets `JICOFO_AUTH_PASSWORD`, `JVB_AUTH_PASSWORD` |
| jicofo | `TZ`, `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_MUC_DOMAIN`, `XMPP_RECORDER_DOMAIN`, `XMPP_SERVER`, `JICOFO_AUTH_USER = "focus"`, `JVB_BREWERY_MUC = "jvbbrewery"`, `ENABLE_AUTH` ; secrets comme ci-dessus |
| jvb | `TZ`, `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_SERVER`, `JVB_AUTH_USER = "jvb"`, `JVB_BREWERY_MUC = "jvbbrewery"`, `JVB_PORT`, `JVB_ADVERTISE_IPS` et `DOCKER_HOST_ADDRESS` (les deux = `jvb_loadbalancer_ip` ; les deux noms sont définis car les modèles de cette balise lisent encore l'ancien à certains endroits), `JVB_DISABLE_STUN = "true"` ; secrets comme ci-dessus |

`var.environment_variables` est fusionné uniquement dans le conteneur **web**.

---

## 5. Services additionnels {#5-additional-services}

Il n'y a pas de jobs d'initialisation. Le back-end est composé de trois `additional_services`, chacun construit à partir d'un objet de valeurs par défaut partagé qui fournit tous les champs lus par la Foundation (un objet fourni par le module contourne les valeurs par défaut optionnelles de la variable typée). Chacun exécute exactement un réplica (`min_instance_count = max_instance_count = 1`) et n'a pas de sondes.

| Nom | Image | Port(s) | Protocole | Service | Limite de mémoire |
|---|---|---|---|---|---|
| `prosody` | `jitsi/prosody:<version>` | 5222 ; extra 5280 (`bosh`), 5347 (`xmpp-component`) | TCP | ClusterIP | `1Gi` |
| `jicofo` | `jitsi/jicofo:<version>` | 8888 (santé/REST ; requis uniquement pour construire un Service) | TCP | ClusterIP | `2Gi` |
| `jvb` | `jitsi/jvb:<version>` | `var.jvb_port` (10000) | **UDP** | **LoadBalancer** (`ingress = INGRESS_TRAFFIC_ALL`) sur `loadbalancer_ip = var.jvb_loadbalancer_ip` | `2Gi` |

Tous les trois ont une limite de CPU `1000m`. L'entrée jvb dépend du champ `protocol` par service de `App_GKE` (par défaut `"TCP"`), ajouté pour ce module ; GCP ne permet pas à un Service LoadBalancer de mélanger TCP et UDP, donc jvb a son propre Service.

---

## 6. Sondes de santé {#6-health-probes}

Les sondes s'appliquent uniquement au conteneur **web**. `Jitsi_GKE` transmet ses `startup_probe_config` et `health_check_config` dans ces variables, de sorte que les valeurs du wrapper sont celles qui sont déployées.

| Sonde | `Jitsi_Common` par défaut | Tel que déployé par `Jitsi_GKE` (valeur par défaut du wrapper) |
|---|---|---|
| Démarrage | HTTP `/`, 30s de délai, 10s de timeout, 15s de période, 20 échecs | HTTP `/`, 60s de délai, 5s de timeout, 10s de période, 3 échecs |
| Vivacité | HTTP `/`, 60s de délai, 10s de timeout, 30s de période, 3 échecs | HTTP `/`, 60s de délai, 5s de timeout, 30s de période, 3 échecs |

---

## 7. Secrets {#7-secrets}

| Ressource | Détail |
|---|---|
| `random_password.jicofo_auth`, `random_password.jvb_auth` | 32 caractères, pas de caractères spéciaux. Identifiants machine, jamais tapés par un humain. |
| `google_secret_manager_secret.jicofo_auth` | `secret-<prefix>-<application_name>-jicofo-auth` |
| `google_secret_manager_secret.jvb_auth` | `secret-<prefix>-<application_name>-jvb-auth` |

La réplication est `user_managed` avec un seul réplica dans `var.region`, non automatique : la réplication automatique enregistre le secret à l'emplacement `global`, ce que la politique `constraints/gcp.resourceLocations` au niveau du dossier sur les projets gérés par RAD refuse. La réplication est ignorée après la création.

Si prosody et un composant voient un jour des mots de passe différents, prosody démarre mais refuse le composant, et les appels se connectent sans média — le même symptôme que l'UDP bloqué. Garder les deux côtés sur un seul Secret Kubernetes est ce qui l'empêche.

---

## 8. Modèle d'implémentation {#8-implementation-pattern}

`Jitsi_GKE` instancie `Jitsi_Common` comme ceci (abrégé) :

```hcl
resource "google_compute_address" "jvb" {
  name         = "${module.deployment_id.service_name}-jvb"
  region       = local.region
  address_type = "EXTERNAL"
}

module "jitsi_app" {
  source = "../Jitsi_Common"

  project_id          = var.project_id
  resource_prefix     = module.deployment_id.tenant_resource_prefix
  xmpp_server_host    = "${module.deployment_id.service_name}-prosody"
  jvb_loadbalancer_ip = google_compute_address.jvb.address
  jvb_port            = var.jvb_port
  public_url          = var.public_url
  xmpp_domain         = var.xmpp_domain
  enable_auth         = var.enable_auth
  enable_guests       = var.enable_guests
  timezone            = var.timezone

  application_version = var.application_version
  cpu_limit           = var.container_resources.cpu_limit
  memory_limit        = var.container_resources.memory_limit
  startup_probe       = var.startup_probe_config
  liveness_probe      = var.health_check_config
  region              = local.region
  # ... other inputs
}

module "app_gke" {
  source = "../App_GKE"

  application_config     = { jitsi = local.jitsi_module }
  module_secret_env_vars = module.jitsi_app.secret_ids
  explicit_secret_values = module.jitsi_app.secret_values
  module_storage_buckets = module.jitsi_app.storage_buckets
  # ... other inputs
}
```

Parce que le nom du Service prosody est calculé à partir du même module `deployment_id` que `App_GKE` utilise, il est connu au moment du plan et ne peut pas dériver du Service réellement créé.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Module Jitsi GKE — Guide de configuration](Jitsi_GKE.md) — cette configuration déployée sur GKE.
- [Lab pratique : Jitsi sur GKE Autopilot](../labs/Jitsi_GKE.md) — déployer et l'opérer étape par étape.
