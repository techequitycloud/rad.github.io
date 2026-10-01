---
title: "SearXNG sur Google Cloud Run"
description: "Référence de configuration pour déployer SearXNG sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SearXNG_CloudRun.md @ 3055034 sha256:c6b24a354c30 -->

# SearXNG sur Google Cloud Run {#searxng-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SearXNG_CloudRun.png" alt="SearXNG sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SearXNG est un métamoteur de recherche auto-hébergé et respectueux de la vie privée, qui
agrège les résultats de plus de 70 services de recherche sans pister les utilisateurs ni
afficher de publicités. Ce module déploie SearXNG sur **Cloud Run v2** en s'appuyant sur
le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par SearXNG et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

SearXNG s'exécute sous forme de conteneur Python/Flask léger sur Cloud Run v2. Le
déploiement assemble un ensemble minimal de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Python/Flask, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique en fonction des requêtes |
| Cache / limitation de débit | Redis | Facultatif — désactivé par défaut ; stocke les compteurs du limiteur. La limitation de débit nécessite aussi `enable_limiter = true` |
| Secrets | Secret Manager | `SEARXNG_SECRET` (clé de session) généré automatiquement et injecté à l'exécution |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** SearXNG est entièrement sans état — il
  agrège les résultats de recherche au moment de la requête et ne stocke rien.
- **Ni NFS ni Cloud Storage ne sont provisionnés.** SearXNG n'a ni téléversements ni
  fichiers partagés.
- **`min_instance_count` est fixé à 0 (mise à l'échelle à zéro).** Les démarrages à froid
  de SearXNG sont rapides (moins de 5 secondes), car aucune connexion à une base de données
  ni aucune migration n'est effectuée au démarrage.
- **Le limiteur est désactivé par défaut, et Redis seul ne l'active pas.** L'image RAD
  fixe `server.limiter: false` afin que l'API JSON reste utilisable par des appelants
  internes de serveur à serveur. Pour un déploiement invocable publiquement, définissez À
  LA FOIS `enable_redis = true` et `enable_limiter = true`, et exemptez les appelants de
  confiance via `limiter_pass_ips`, pour bénéficier de la limitation de débit et de la
  détection des bots contre les abus des moteurs en amont.
- **`SEARXNG_SECRET` est généré automatiquement** et stocké dans Secret Manager. La même
  clé est partagée par toutes les instances en cours d'exécution — ne la remplacez pas par
  une valeur aléatoire propre à chaque instance.
- **Les sondes de santé ciblent `/healthz`.** Le point de terminaison de santé intégré de
  SearXNG renvoie 200 lorsque l'application est prête.
- **`vpc_egress_setting` vaut `PRIVATE_RANGES_ONLY` par défaut.** SearXNG doit joindre
  des moteurs de recherche externes ; assurez-vous qu'une passerelle Cloud NAT est
  configurée ou passez à `ALL_TRAFFIC`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service SearXNG {#a-cloud-run--the-searxng-service}

SearXNG s'exécute sous forme de service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, jusqu'à zéro en période d'inactivité. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre révisions pour
des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### Limitation connue : le limiteur ne peut pas identifier les clients sur Cloud Run {#known-limitation-the-limiter-cannot-identify-clients-on-cloud-run}

`enable_limiter = true` active réellement le limiteur (`/config` indique
`limiter.enabled: true`), mais sur Cloud Run il bloque actuellement **tous** les
appelants, y compris ceux de la liste d'autorisation. SearXNG journalise :

```
ERROR:searx.botdetection: X-Forwarded-For nor X-Real-IP header is set!
```

`botdetection.ProxyFix` résout le client dans l'ordre X-Forwarded-For → X-Real-IP →
`REMOTE_ADDR`, et se rabat sur l'adresse « trou noir » `100::` lorsqu'il n'en trouve
aucune. Aucun des deux en-têtes de proxy n'atteint le conteneur sur Cloud Run ; chaque
requête est donc résolue vers cette même adresse de repli : une identité partagée, un
seau de jetons partagé, et `limiter_pass_ips` ne peut jamais correspondre, car l'adresse
à laquelle il se compare n'est pas celle de l'appelant.

L'échec dépend du sens de la configuration et se lit facilement de travers :

- Avec `limiter_trusted_proxies` **vide**, `REMOTE_ADDR` (une adresse link-local) n'est
  pas considéré comme fiable, les en-têtes sont ignorés, et le client link-local qui en
  résulte n'est pas soumis à la limitation de débit par défaut — le limiteur est donc
  actif et **laisse passer tout le monde**.
- Avec les plages privées/link-local **considérées comme fiables**, les en-têtes sont
  consultés, trouvés absents, et tout se réduit à `100::` — le limiteur **rejette tout le
  monde**.

Vérifié en conditions réelles : 25 requêtes non authentifiées sur 25 ont renvoyé 429, de
même que l'appelant figurant dans la liste d'autorisation. Des en-têtes `X-Real-IP` et
`X-Forwarded-For` falsifiés ont également été rejetés ; la liste d'autorisation n'est
donc au moins pas usurpable.

Tant que les en-têtes de proxy n'atteignent pas le conteneur, une instance Cloud Run
invocable publiquement ne peut pas être protégée par le limiteur. Restreignez plutôt
l'accès — un équilibreur de charge HTTP interne avec un NEG sans serveur et
`ingress_settings = "internal-and-cloud-load-balancing"`, ou IAP — et laissez
`enable_limiter = false`. La
variante GKE n'est pas concernée lorsqu'un contrôleur d'entrée définit normalement
X-Forwarded-For ; définissez `limiter_trusted_proxies` avec la plage de ce contrôleur.

### B. Cache Redis (facultatif) {#b-redis-cache-optional}

`enable_redis = true` provisionne le backend Redis dans lequel le limiteur conserve ses
compteurs par adresse IP. Il n'active **pas** à lui seul la limitation de débit : l'image
RAD est livrée avec `server.limiter: false` afin que l'API JSON reste utilisable par des
appelants internes de serveur à serveur. Définissez également `enable_limiter = true`
pour activer réellement la détection des bots — le plan échoue si vous l'activez sans
Redis. Lorsque `redis_host` est laissé vide et que Redis est activé, le module utilise
`127.0.0.1` par défaut.

Le limiteur considère les appels d'API sans en-têtes comme des bots ; listez donc les
plages sources de vos appelants internes de confiance dans `limiter_pass_ips`, faute de
quoi ils seront limités comme tout le monde. Activez les deux sur toute instance
accessible depuis l'internet public : sinon, quiconque trouve l'URL peut consommer les
quotas des moteurs en amont dont elle dépend.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### C. Secret Manager — SEARXNG_SECRET {#c-secret-manager--searxng_secret}

`SearXNG_Common` génère automatiquement la clé de session `SEARXNG_SECRET` et la stocke
dans Secret Manager. Cette clé signe les cookies de session et les paramètres de requête
HMAC de SearXNG ; toutes les instances doivent partager la même valeur. Elle est injectée
dans le service à l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut s'y ajouter ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité vers les moteurs de
recherche externes.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run sont
envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application SearXNG {#3-searxng-application-behaviour}

- **Entièrement sans état.** SearXNG récupère les résultats auprès de moteurs de
  recherche externes au moment de la requête et ne stocke rien localement. Aucune
  migration de base de données ni job d'initialisation ne s'exécute.
- **Aucune tâche de configuration au premier déploiement.** Comme il n'y a pas de base
  de données, le déploiement se termine sans étape db-init — le service est prêt dès que
  le conteneur démarre.
- **`SEARXNG_SECRET` est stable.** La clé de session est générée une seule fois et
  persiste dans Secret Manager d'une révision du service à l'autre. Sa rotation invalide
  toutes les sessions utilisateur actives ; évitez-la en production sauf si la sécurité
  l'exige.
- **`SEARXNG_BIND_ADDRESS` est injecté automatiquement** avec la valeur `0.0.0.0:8080`,
  afin que SearXNG écoute sur toutes les interfaces, sur son port natif.
- **`ENABLE_REDIS` est injecté automatiquement** ; **`REDIS_URL` ne l'est que lorsque
  `enable_redis = true`** (il est entièrement omis dans le cas contraire, afin qu'un
  client ne puisse pas prendre une valeur vide pour un point de terminaison réel). L'URL
  est dérivée de `redis_host`, `redis_port` et, s'il est défini, `redis_auth` — une
  instance Memorystore avec AUTH activé rejette une URL sans mot de passe.
- **`SEARXNG_LIMITER` et `SEARXNG_LIMITER_PASS_IPS` sont injectés automatiquement** à
  partir de `enable_limiter` et `limiter_pass_ips` ; le point d'entrée les substitue dans
  `server.limiter` et écrit `/etc/searxng/limiter.toml`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `/healthz` (HTTP GET), auquel SearXNG répond une fois l'application entièrement
  initialisée.
- **Démarrages à froid rapides.** SearXNG démarre en moins de 5 secondes — sans connexion
  à une base de données ni migration de schéma. La sonde de démarrage utilise un délai
  initial de 10 secondes.
- **Sortie VPC vers les moteurs externes.** SearXNG récupère les résultats auprès de
  services de recherche en amont via internet. Assurez-vous que la sortie du connecteur
  VPC n'est pas limitée aux seules plages privées, ou configurez Cloud NAT pour l'accès à
  internet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à SearXNG ou notables pour lui sont listés ;
toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `searxng` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `SearXNG Search` | Nom convivial affiché dans la console. |
| `description` | `SearXNG — privacy-respecting metasearch engine on Cloud Run` | Description du service. |
| `application_version` | `latest` | Tag de l'image SearXNG ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. 1 vCPU suffit pour un trafic SearXNG modéré. |
| `memory_limit` | `512Mi` | Mémoire par instance. Passez à `1Gi` pour les instances publiques à fort trafic. |
| `max_instance_count` | `3` | Nombre maximal d'instances (plafond de coût). |
| `container_port` | `8080` | Port HTTP natif de SearXNG. |
| `execution_environment` | `gen2` | Gen2 recommandé pour un démarrage plus rapide et un réseau amélioré. |
| `timeout_seconds` | `60` | Durée maximale d'une requête. Des moteurs en amont lents peuvent nécessiter de la porter à 120–300. |
| `container_image_source` | `prebuilt` | Utilise l'image officielle de SearXNG (`prebuilt`) ou la construit à partir des sources (`custom`). |
| `cpu_always_allocated` | `false` | Facturation à la requête — SearXNG est un proxy de recherche sans état, sans travail d'arrière-plan dans le processus ; le CPU n'est donc nécessaire que pendant le traitement d'une requête. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry avant le déploiement. |
| `enable_cloudsql_volume` | `false` | **Laissez false** — SearXNG n'utilise pas de base de données. |
| `traffic_split` | `[]` | Répartit le trafic entre révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux autorisés à joindre le service. Utilisez `internal` pour les déploiements privés. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Mode de routage du trafic sortant via le connecteur VPC. Définissez `ALL_TRAFFIC` si Cloud NAT n'est pas configuré. |
| `enable_iap` | `false` | Exige une connexion Google via Identity-Aware Proxy (déploiements internes). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ INSTANCE_NAME="SearXNG", AUTOCOMPLETE="", SEARXNG_BIND_ADDRESS="0.0.0.0:8080" }` | Paramètres supplémentaires. `ENABLE_REDIS` et `REDIS_URL` sont également injectés automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager pour des secrets supplémentaires (par exemple les clés d'API des moteurs en amont). |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

SearXNG est sans état — il n'y a aucune donnée applicative à sauvegarder. Les variables
de sauvegarde sont héritées de l'interface du socle mais n'ont aucune utilité pratique.
Consultez [App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

Sans objet pour SearXNG (pas de base de données). Consultez
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. Recommandé pour les déploiements publics. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS (SSL géré par Google). |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | SearXNG est sans état — aucun bucket GCS n'est requis. Laissez false. |
| `enable_nfs` | `false` | SearXNG est sans état — NFS n'est pas requis. Laissez false. |
| `gcs_volumes` | `[]` | Montages GCS Fuse (non utilisés par SearXNG). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Imposé — SearXNG n'utilise pas de base de données. Ne le modifiez pas. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | SearXNG ne nécessite aucun job d'initialisation — laissez vide. |
| `cron_jobs` | `[]` | Tâches planifiées facultatives (par exemple le préchauffage du cache). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Point de terminaison de santé intégré de SearXNG ; la sonde de démarrage prévoit un délai initial de 10s. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Provisionne le backend Redis dont le limiteur a besoin. N'active PAS la limitation de débit à lui seul. |
| `enable_limiter` | `false` | Active le limiteur de détection des bots. Nécessite `enable_redis`. À définir à true sur toute instance invocable publiquement. |
| `limiter_pass_ips` | `[]` | Plages CIDR sources exemptées de la détection des bots, pour des appelants internes de confiance tels que n8n. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser `127.0.0.1` par défaut lorsque Redis est activé ; définissez l'adresse IP Memorystore pour une instance gérée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour SearXNG). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration (aucune par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails de la connexion GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SEARXNG_SECRET` (généré automatiquement) | généré automatiquement | Critique | S'il est remplacé par une valeur aléatoire propre à chaque instance, chaque démarrage à froid produit une clé différente, ce qui invalide tous les cookies de session existants. Utilisez toujours la valeur générée automatiquement dans Secret Manager. |
| `database_type` | `NONE` | Critique | Passer à un véritable type de base de données provisionne une instance Cloud SQL inutilisée et casse le démarrage. |
| `vpc_egress_setting` | `ALL_TRAFFIC` ou Cloud NAT configuré | Élevé | `PRIVATE_RANGES_ONLY` bloque les requêtes sortantes de SearXNG vers les moteurs de recherche externes (Google, Bing, DuckDuckGo, etc.), qui renvoie alors des résultats vides. |
| `enable_redis` | `true` pour les déploiements publics | Élevé | Sans Redis, SearXNG n'a aucune limitation de débit ; les instances publiques sont exposées à un moissonnage qui épuise les quotas des moteurs en amont. |
| `redis_host` | Adresse IP Memorystore ou valeur explicite | Élevé | Lorsque `enable_redis = true` et `redis_host = ""`, le module utilise `127.0.0.1` par défaut — il n'y a pas de sidecar Redis dans Cloud Run, donc la limitation de débit est désactivée sans aucun message. |
| `timeout_seconds` | `60`–`300` | Moyen | SearXNG attend tous les moteurs de recherche activés ; des moteurs en amont lents peuvent nécessiter jusqu'à 30 secondes par requête. Une valeur trop faible provoque des erreurs 504 avant l'agrégation des résultats. |
| `application_version` | épinglée (pas `latest`) | Moyen | Utiliser `latest` rend les déploiements non reproductibles ; une nouvelle version de SearXNG peut modifier le schéma de configuration. |
| `enable_cloud_armor` | `true` pour les déploiements publics | Moyen | Sans Cloud Armor, le point de terminaison public n'a aucune protection WAF/DDoS. |
| `enable_iap` | `true` pour un usage strictement interne | Moyen | Pour les déploiements de recherche internes, IAP restreint l'accès aux comptes Google authentifiés. |
| `ingress_settings` | `all` pour un usage public ; `internal` pour un usage privé | Moyen | `all` est voulu pour un métamoteur de recherche public ; associez-le à la limitation de débit Redis et à Cloud Armor en production. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à SearXNG
partagée avec la variante GKE est décrite dans
**[SearXNG_Common](SearXNG_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SearXNG sur Cloud Run](../labs/SearXNG_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [SearXNG sur GKE Autopilot](SearXNG_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [SearXNG Common — Configuration applicative partagée](SearXNG_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[Ollama sur Google Cloud Run](Ollama_CloudRun.md), [LiteLLM sur Google Cloud Run](LiteLLM_CloudRun.md), [Qdrant sur Google Cloud Run](Qdrant_CloudRun.md), [Open WebUI sur Google Cloud Run](OpenWebUI_CloudRun.md) dans la solution **Private AI Assistant**.
