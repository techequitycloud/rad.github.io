---
title: "SearXNG sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de SearXNG sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SearXNG_CloudRun.md @ 15fd4c7 sha256:da8a1c91dd35 -->

# SearXNG sur Google Cloud Run {#searxng-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_CloudRun.png" alt="SearXNG sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG est un métamoteur de recherche auto-hébergé, respectueux de la vie
privée, qui agrège les résultats de plus de 70 services de recherche sans suivre
les utilisateurs ni diffuser de publicités. Ce module déploie SearXNG sur
**Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par SearXNG et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

SearXNG s'exécute comme un conteneur Python/Flask léger sur Cloud Run v2. Le
déploiement relie un ensemble minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Flask, 1 vCPU / 512 Mio par défaut, autoscaling basé sur les requêtes |
| Cache / limitation de débit | Redis | Optionnel — désactivé par défaut ; sauvegarde les compteurs du limiteur. La limitation de débit nécessite également `enable_limiter = true` |
| Secrets | Secret Manager | `SEARXNG_SECRET` (clé de session) auto-généré injecté à l'exécution |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** SearXNG est entièrement
  stateless — il agrège les résultats de recherche au moment de la requête et
  ne stocke rien.
- **Aucun NFS ou Cloud Storage n'est provisionné.** SearXNG n'a pas de
  téléchargements ou de fichiers partagés.
- **`min_instance_count` est fixé à 0 (mise à l'échelle à zéro).** Les démarrages à
  froid de SearXNG sont rapides (moins de 5 secondes) car aucune connexion ou
  migration de base de données n'est effectuée au démarrage.
- **Le limiteur est désactivé par défaut, et Redis seul ne l'active pas.**
  L'image RAD épingle `server.limiter: false` afin que l'API JSON reste utilisable par
  les appelants internes de serveur à serveur. Pour un déploiement invocable
  publiquement, définissez À LA FOIS `enable_redis = true` et `enable_limiter = true`, et
  exemptez les appelants de confiance via `limiter_pass_ips`, pour obtenir une
  limitation de débit et une détection de bot contre l'abus des moteurs en
  amont.
- **`SEARXNG_SECRET` est générée automatiquement** et stockée dans Secret
  Manager. La même clé est partagée entre toutes les instances en cours
  d'exécution — ne la remplacez pas par une valeur aléatoire par instance.
- **Les sondes de santé ciblent `/healthz`.** Le point de terminaison de
  santé intégré de SearXNG renvoie 200 lorsque l'application est prête.
- **`vpc_egress_setting` est par défaut `PRIVATE_RANGES_ONLY`.** SearXNG doit
  atteindre les moteurs de recherche externes ; assurez-vous qu'une passerelle
  Cloud NAT est configurée ou passez à `ALL_TRAFFIC`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont
définis. Les noms de services et de ressources sont indiqués dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service SearXNG {#a-cloud-run--the-searxng-service}

SearXNG s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à
la charge de requêtes, se mettant à l'échelle à zéro lorsqu'il est inactif.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti
entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### Limitation connue : le limiteur ne peut pas identifier les clients sur Cloud Run {#known-limitation-the-limiter-cannot-identify-clients-on-cloud-run}

`enable_limiter = true` active réellement le limiteur (`/config`
signale `limiter.enabled: true`), mais sur Cloud Run, il bloque actuellement
**tous** les appelants, y compris ceux figurant sur la liste blanche. SearXNG
enregistre :

```
ERROR:searx.botdetection: X-Forwarded-For nor X-Real-IP header is set!
```

`botdetection.ProxyFix` résout le client dans l'ordre X-Forwarded-For →
X-Real-IP → `REMOTE_ADDR`, en revenant à l'adresse black-hole
`100::` s'il n'en trouve aucune. Aucun des en-têtes de proxy
n'atteint le conteneur sur Cloud Run, de sorte que chaque requête se résout à
cette même valeur de repli : une identité partagée, un seau de jetons partagé,
et `limiter_pass_ips` ne peut jamais correspondre car l'adresse à laquelle il
se compare n'est pas celle de l'appelant.

L'échec dépend de la direction et est facile à mal interpréter :

- Avec `limiter_trusted_proxies` **vide**, `REMOTE_ADDR` (une adresse
  link-local) n'est pas fiable, les en-têtes sont ignorés, et le client
  link-local résultant n'est pas limité par défaut — donc le limiteur est
  activé et **admet tout le monde**.
- Avec les plages privées/link-local **fiables**, les en-têtes sont consultés,
  trouvés absents, et tout s'effondre à `100::` — donc le limiteur
  **rejette tout le monde**.

Vérifié en direct : 25/25 requêtes non authentifiées ont renvoyé 429, tout comme
l'appelant figurant sur la liste blanche. Les en-têtes forgés `X-Real-IP`
et `X-Forwarded-For` ont également été rejetés, de sorte que la liste
blanche n'est au moins pas falsifiable.

Tant que les en-têtes de proxy n'atteignent pas le conteneur, une instance Cloud
Run invocable publiquement ne peut pas être protégée par le limiteur. Restreignez
plutôt l'accès — un équilibreur de charge HTTP interne avec un NEG sans
serveur et `ingress_settings =
"internal-and-cloud-load-balancing"`, ou IAP — et laissez `enable_limiter = false`. La
variante GKE n'est pas affectée là où un contrôleur d'ingress définit
normalement X-Forwarded-For ; définissez `limiter_trusted_proxies` sur la plage de ce
contrôleur.

### B. Cache Redis (optionnel) {#b-redis-cache-optional}

`enable_redis = true` provisionne le backend Redis dans lequel le limiteur
conserve ses compteurs par IP. Il n'active **pas** à lui seul la limitation de
débit : l'image RAD fournit `server.limiter: false` afin que l'API JSON reste
utilisable par les appelants internes de serveur à serveur. Définissez
`enable_limiter = true` également pour activer réellement la détection de bot —
le plan échoue si vous l'activez sans Redis. Lorsque `redis_host` est
laissé vide et que Redis est activé, le module utilise par défaut
`127.0.0.1`.

Le limiteur traite les appels API sans en-tête comme des bots, alors listez les
plages source de tous les appelants internes de confiance dans `limiter_pass_ips`
ou ils seront limités avec tous les autres. Activez les deux sur toute instance
accessible depuis l'internet public : sinon, quiconque trouve l'URL peut
consommer les quotas de moteur en amont dont elle dépend.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET {#c-secret-manager--searxng_secret}

`SearXNG_Common` génère automatiquement la clé de session
`SEARXNG_SECRET` et la stocke dans Secret Manager. Cette clé signe les
cookies de session de SearXNG et les paramètres de requête HMAC ; toutes les
instances doivent partager la même valeur. Elle est injectée dans le service au
moment de l'exécution.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être superposé ; les paramètres d'ingress et l'egress VPC
contrôlent la connectivité aux moteurs de recherche externes.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud
Run sont acheminées vers Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application SearXNG {#3-searxng-application-behaviour}

- **Entièrement stateless.** SearXNG récupère les résultats des moteurs de
  recherche externes au moment de la requête et ne stocke rien localement.
  Aucune migration de base de données ou job d'initialisation ne s'exécute.
- **Pas de job de configuration au premier déploiement.** Comme il n'y a pas de
  base de données, le déploiement se termine sans étape d'initialisation de la
  base de données — le service est prêt dès que le conteneur démarre.
- **`SEARXNG_SECRET` est stable.** La clé de session est générée une
  seule fois et persiste dans Secret Manager à travers les révisions de
  service. La faire pivoter invalide toutes les sessions utilisateur actives ;
  évitez la rotation en production sauf si cela est requis pour la sécurité.
- **`SEARXNG_BIND_ADDRESS` est injecté automatiquement** comme
  `0.0.0.0:8080` afin que SearXNG écoute sur toutes les interfaces à
  son port natif.
- **`ENABLE_REDIS` est injecté automatiquement** ; **`REDIS_URL`
  seulement lorsque `enable_redis = true`** (il est entièrement omis sinon, de
  sorte qu'un client ne peut pas confondre une valeur vide avec un véritable
  point de terminaison). L'URL est dérivée de `redis_host`,
  `redis_port` et, si défini, `redis_auth` — une instance
  Memorystore avec AUTH activé rejette une URL sans mot de passe.
- **`SEARXNG_LIMITER` et `SEARXNG_LIMITER_PASS_IPS` sont injectés
  automatiquement** à partir de `enable_limiter` et `limiter_pass_ips` ;
  le point d'entrée les substitue dans `server.limiter` et écrit
  `/etc/searxng/limiter.toml`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/healthz` (HTTP GET), auquel SearXNG répond une fois
  l'application entièrement initialisée.
- **Démarrages à froid rapides.** SearXNG démarre en moins de 5 secondes —
  aucune connexion à la base de données ou migration de schéma. La sonde de
  démarrage utilise un délai initial de 10 secondes.
- **Egress VPC pour les moteurs externes.** SearXNG récupère les résultats des
  services de recherche en amont sur Internet. Assurez-vous que l'egress du
  connecteur VPC n'est pas restreint aux plages privées uniquement, ou
  configurez Cloud NAT pour l'accès Internet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
SearXNG sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `searxng` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `SearXNG Search` | Nom convivial affiché dans la console. |
| `description` | `SearXNG — privacy-respecting metasearch engine on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de l'image SearXNG ; épingler à une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. 1 vCPU gère un trafic SearXNG modéré. |
| `memory_limit` | `512Mi` | Mémoire par instance. Mettre à l'échelle à `1Gi` pour les instances publiques à fort trafic. |
| `max_instance_count` | `3` | Nombre maximal d'instances (plafond de coût). |
| `container_port` | `8080` | Port HTTP natif de SearXNG. |
| `execution_environment` | `gen2` | Gen2 recommandé pour un démarrage plus rapide et une mise en réseau améliorée. |
| `timeout_seconds` | `60` | Durée maximale de la requête. Les moteurs en amont lents peuvent nécessiter d'augmenter à 120–300. |
| `container_image_source` | `custom` | Utilisez l'image officielle de SearXNG (`prebuilt`) ou construisez à partir de la source (`custom`). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — SearXNG est un proxy de recherche stateless sans travail de fond en cours de processus, donc le CPU n'est nécessaire que lors du traitement d'une requête. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry avant le déploiement. |
| `enable_cloudsql_volume` | `false` | **Laissez false** — SearXNG n'utilise pas de base de données. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Utilisez `internal` pour les déploiements privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. Définissez `ALL_TRAFFIC` si Cloud NAT n'est pas configuré. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy (déploiements internes). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="", SEARXNG_BIND_ADDRESS="0.0.0.0:8080" }` | Paramètres supplémentaires. `ENABLE_REDIS` et `REDIS_URL` sont également injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager pour des secrets supplémentaires (par exemple, clés API de moteur en amont). |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

SearXNG est stateless — il n'y a pas de données d'application à sauvegarder. Les
variables de sauvegarde sont héritées de l'interface de la fondation mais n'ont
aucune utilité pratique. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

Non applicable à SearXNG (pas de base de données). Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. Recommandé pour les déploiements publics. |
| `admin_ip_ranges` | `[]` | CIDR exemptés des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS (SSL géré par Google). |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG est stateless — aucun bucket GCS n'est requis. Laissez false. |
| `enable_nfs` | `false` | SearXNG est stateless — NFS n'est pas requis. Laissez false. |
| `gcs_volumes` | `[]` | Montages GCS Fuse (non utilisés par SearXNG). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — SearXNG n'utilise pas de base de données. Ne pas modifier. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG ne nécessite aucun job d'initialisation — laissez vide. |
| `cron_jobs` | `[]` | Tâches planifiées optionnelles (par exemple, préchauffage du cache). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Point de terminaison de santé intégré de SearXNG ; le démarrage permet un délai initial de 10s. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métrique optionnelles. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Provisionne le backend Redis dont le limiteur a besoin. N'active PAS la limitation de débit à lui seul. |
| `enable_limiter` | `false` | Active le limiteur de détection de bot. Nécessite `enable_redis`. Définir à true sur toute instance invocable publiquement. |
| `limiter_pass_ips` | `[]` | CIDR source exemptés de la détection de bot, pour les appelants internes de confiance tels que n8n. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser par défaut `127.0.0.1` lorsque Redis est activé ; définissez sur l'IP Memorystore pour une instance gérée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode dry-run. |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vides pour SearXNG). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails de connexion GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut d'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SEARXNG_SECRET` (auto-généré) | auto-généré | Critique | Si remplacé par une valeur aléatoire par instance, chaque démarrage à froid produit une clé différente, invalidant tous les cookies de session existants. Utilisez toujours la valeur auto-générée de Secret Manager. |
| `database_type` | `NONE` | Critique | Changer pour un type de base de données réel provisionne une instance Cloud SQL inutilisée et interrompt le démarrage. |
| `vpc_egress_setting` | `ALL_TRAFFIC` ou Cloud NAT configuré | Élevé | `PRIVATE_RANGES_ONLY` bloque les requêtes sortantes de SearXNG vers les moteurs de recherche externes (Google, Bing, DuckDuckGo, etc.), renvoyant des résultats vides. |
| `enable_redis` | `true` pour les déploiements publics | Élevé | Sans Redis, SearXNG n'a pas de limitation de débit ; les instances publiques sont vulnérables au scraping qui épuise les quotas des moteurs en amont. |
| `redis_host` | IP Memorystore ou valeur explicite | Élevé | Lorsque `enable_redis = true` et `redis_host = ""`, le module utilise par défaut `127.0.0.1` — il n'y a pas de Redis sidecar dans Cloud Run, donc la limitation de débit est silencieusement désactivée. |
| `timeout_seconds` | `60`–`300` | Moyen | SearXNG attend tous les moteurs de recherche activés ; les moteurs en amont lents peuvent nécessiter jusqu'à 30 secondes par requête. Trop bas provoque des erreurs 504 avant que les résultats ne soient agrégés. |
| `application_version` | épinglé (pas `latest`) | Moyen | L'utilisation de `latest` rend les déploiements non reproductibles ; une nouvelle version de SearXNG peut modifier le schéma de configuration. |
| `enable_cloud_armor` | `true` pour les déploiements publics | Moyen | Sans Cloud Armor, il n'y a pas de protection WAF/DDoS sur le point de terminaison public. |
| `enable_iap` | `true` pour usage interne uniquement | Moyen | Pour les déploiements de recherche internes, IAP restreint l'accès aux comptes Google authentifiés. |
| `ingress_settings` | `all` pour public ; `internal` pour privé | Moyen | `all` est intentionnel pour un métamoteur de recherche public ; combinez avec la limitation de débit Redis et Cloud Armor pour la production. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à SearXNG partagée avec la variante GKE est décrite
dans **[SearXNG_Common](SearXNG_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SearXNG sur Cloud Run](../labs/SearXNG_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [SearXNG sur GKE Autopilot](SearXNG_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [SearXNG Common — Configuration d'application partagée](SearXNG_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) dans la solution **Assistant IA Privé**.
