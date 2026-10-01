---
title: "Element sur Google Cloud Run"
description: "Référence de configuration pour déployer Element sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Element_CloudRun.md @ 3055034 sha256:67090eaf55a9 -->

# Element sur Google Cloud Run {#element-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Element_CloudRun.png" alt="Element sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Element est le principal client web open source (AGPLv3) pour
[Matrix](https://matrix.org/) — une application de messagerie et de collaboration
auto-hébergée, chiffrée de bout en bout. Ce module déploie Element sur **Cloud Run v2**
en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Element est une **application monopage (SPA) statique servie par nginx** : le navigateur
communique directement avec un serveur d'accueil (homeserver) Matrix (tel que Synapse ou
Dendrite) via HTTPS, de sorte que le conteneur lui-même ne conserve aucun état côté
serveur — ni base de données, ni Redis, ni stockage persistant, ni secrets.

Ce guide se concentre sur les services cloud utilisés par Element et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications Cloud Run — identité du service,
entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls et cycle de vie du déploiement —
reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Element s'exécute comme un conteneur nginx statique sur Cloud Run v2. Le déploiement
assemble un ensemble volontairement réduit de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | SPA statique nginx, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique serverless ; mise à l'échelle jusqu'à zéro activée |
| Build du conteneur | Cloud Build + Artifact Registry | Image personnalisée légère `FROM vectorim/element-web` avec un point d'entrée générant `config.json` à l'exécution |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |
| Secrets | — | **Aucun.** Element ne nécessite aucun secret |
| Base de données | — | **Aucune.** C'est le serveur d'accueil Matrix qui conserve tout l'état, pas Element |
| Stockage d'objets | — | **Aucun.** Element est sans état |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Element est sans état.** L'ensemble de l'état des conversations, des clés de
  chiffrement et des médias réside sur le serveur d'accueil Matrix et dans le navigateur
  de l'utilisateur. Element lui-même ne stocke rien côté serveur ; il n'y a donc ni base
  de données, ni Redis, ni bucket GCS, ni secret Secret Manager.
- **Le serveur d'accueil relève de la configuration d'exécution.** `homeserver_url` /
  `homeserver_name` sont écrits dans `/app/config.json` par le point d'entrée du
  conteneur à chaque démarrage, de sorte qu'une même image peut pointer vers n'importe
  quel serveur d'accueil sans nouveau build. Les laisser vides revient par défaut au
  serveur public `matrix.org`.
- **Build personnalisé avec version épinglée.** `container_image_source = "custom"`
  construit une image légère au-dessus de `vectorim/element-web`.
  `application_version = "latest"` se résout vers le tag éprouvé épinglé `v1.11.86` via
  un ARG de build propre à l'application, `ELEMENT_VERSION`.
- **La mise à l'échelle jusqu'à zéro est activée par défaut** (`min_instance_count = 0`,
  `cpu_always_allocated = false`). Un serveur d'assets statiques ne coûte rien au repos
  et démarre à froid en bien moins d'une seconde — les démarrages à froid ne posent
  aucun problème pour Element.
- **Entrée publique par défaut.** `ingress_settings = "all"` rend l'interface du client
  accessible ; Element effectue sa propre connexion auprès du serveur d'accueil. Ajoutez
  IAP si vous souhaitez un contrôle par identité Google devant l'interface.
- **Port 80.** nginx sert la SPA sur le port 80 ; les sondes ciblent `/`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Element {#a-cloud-run--the-element-service}

Element s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge de requêtes, entre le nombre minimal et le nombre maximal d'instances.
Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre
révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Image de conteneur — Cloud Build et Artifact Registry {#b-container-image--cloud-build--artifact-registry}

L'image Element est construite par Cloud Build à partir d'un Dockerfile léger qui ajoute
un point d'entrée générant `config.json` au-dessus de `vectorim/element-web`, puis
poussée vers Artifact Registry. `application_version = "latest"` construit la version
épinglée `v1.11.86`.

- **Console :** Cloud Build → History ; Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit 5
  gcloud artifacts docker images list <region>-docker.pkg.dev/<project>/<repo> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le pipeline de build, la mise en miroir
des images et la règle de conservation.

### C. Réseau et entrée {#c-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les
paramètres d'entrée et la sortie VPC contrôlent la connectivité. Element étant un
serveur d'assets statiques, c'est un excellent candidat pour Cloud CDN.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### D. Identity-Aware Proxy (facultatif) {#d-identity-aware-proxy-optional}

Element est livré ouvert par défaut afin que les utilisateurs puissent se connecter
auprès du serveur d'accueil. Pour restreindre à vos identités Google le simple
chargement de l'interface du client, activez IAP (`enable_iap = true`).

- **Console :** Security → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la configuration d'IAP et l'écran de
consentement OAuth.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur (accès/erreurs nginx) sont envoyés vers Cloud Logging ; les
métriques Cloud Run sont envoyées vers Cloud Monitoring, avec un test de disponibilité et
une alerte en cas d'échec de ce test provisionnés lorsque le point de terminaison est
publiquement accessible.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting / Uptime checks.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Element {#3-element-application-behaviour}

- **Génération de la configuration à l'exécution.** Le point d'entrée du conteneur écrit
  `/app/config.json` à chaque démarrage à partir de `HOMESERVER_URL` /
  `HOMESERVER_NAME`, puis passe la main à nginx. Changer de serveur d'accueil revient à
  redéployer avec de nouvelles valeurs d'environnement — sans reconstruire l'image.
- **Ni base de données, ni migrations.** Element sert des assets statiques ; il n'y a ni
  schéma, ni job d'initialisation, ni fenêtre de migration au premier démarrage. Le
  service est prêt (Ready) dès que nginx écoute sur le port 80.
- **La connexion est un échange entre le navigateur et le serveur d'accueil.** Element
  authentifie l'utilisateur directement auprès du serveur d'accueil Matrix configuré ;
  il n'y a aucune session côté serveur dans le conteneur Cloud Run et rien à
  pré-remplir dans Secret Manager.
- **Vérifiez le serveur d'accueil injecté.** Confirmez que l'environnement de la
  révision en cours correspond au serveur d'accueil voulu :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
  Ouvrez ensuite `$SERVICE_URL` — l'écran de connexion doit afficher votre serveur
  d'accueil, et `curl -s "$SERVICE_URL/config.json"` doit renvoyer le JSON contenant
  votre `base_url`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, auquel nginx
  répond immédiatement et sans authentification.
- **Mise à niveau d'Element.** Augmentez `application_version` (ou épinglez un tag
  `element-web` plus récent) et redéployez ; une nouvelle image est construite et une
  nouvelle révision est déployée. Comme Element réutilise un même tag de version d'un
  build à l'autre, c'est le déclencheur fondé sur le hachage du contenu du build qui
  produit la nouvelle image ; vérifiez le condensé (digest) de la révision déployée si
  une modification semble ne pas avoir été prise en compte.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Element ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
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
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `element` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Element` | Nom lisible affiché dans la console. Non personnalisé pour Element dans `variables.tf` — remplacez-le par exemple par `"Element"` pour un nom d'affichage plus clair. |
| `application_version` | `latest` | Tag de l'image Element ; `latest` construit la version épinglée `v1.11.86`. Épinglez un tag `element-web` précis en production. |
| `homeserver_url` | `""` | URL de base du serveur d'accueil Matrix écrite dans `config.json`. Vide → `matrix.org`. |
| `homeserver_name` | `""` | Nom du serveur Matrix (identité de délégation) annoncé par Element. Vide → `matrix.org`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image Element légère via Cloud Build. |
| `container_image` | `""` | Remplacez-la par l'URI d'une image préconstruite ou mise en miroir. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512 MiB). |
| `container_port` | `80` | nginx écoute sur le port 80. |
| `min_instance_count` | `0` | **Codé en dur, non ajustable.** `element.tf` fixe cette valeur à `0` dans l'appel au module socle et dans la fusion de configuration ; `var.min_instance_count` n'est jamais transmise, de sorte que l'augmenter (par ex. pour éliminer les démarrages à froid) est ignoré sans avertissement. La mise à l'échelle jusqu'à zéro s'applique toujours — un serveur statique ne coûte rien au repos, quelle que soit la valeur saisie. |
| `max_instance_count` | `3` | Limite supérieure de la mise à l'échelle automatique — réellement ajustable ; transmise via `var.max_instance_count`. |
| `cpu_always_allocated` | `false` | Facturation à la requête (moins chère) — Element n'effectue aucun travail en arrière-plan. |
| `execution_environment` | `gen2` | Environnement d'exécution Cloud Run. |
| `enable_cloudsql_volume` | `false` | Aucune base de données — l'Auth Proxy n'est pas monté. |
| `enable_image_mirroring` | `true` | Met l'image en miroir dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Interface publique. Définissez `internal` pour la restreindre au VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google pour charger l'interface du client. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires fusionnés avec les valeurs injectées `HOMESERVER_URL` / `HOMESERVER_NAME`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Element n'en a besoin d'aucune. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Hérité d'[App_CloudRun](App_CloudRun.md) et **sans effet pour Element** (il n'y a rien à
sauvegarder). `backup_schedule`, `backup_retention_days`, `enable_backup_import`,
`backup_source`, `backup_uri`, `backup_format`.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Équilibreur de charge, CDN et rétention des images {#group-9--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN — intéressant pour les assets statiques d'Element. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

Hérité et **non utilisé par Element** (sans état). `create_cloud_storage`,
`storage_buckets` (vide), `enable_nfs` (`false`), `gcs_volumes` (vide),
`manage_storage_kms_iam`, `enable_artifact_registry_cmek`.

### Groupe 12 — Base de données {#group-12--database}

Hérité d'[App_CloudRun](App_CloudRun.md) et **sans effet** — `Element_Common` définit
`database_type = "NONE"`. Aucune instance Cloud SQL, aucun utilisateur ni mot de passe
n'est créé.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Element ne déclare aucun job d'initialisation. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 10 s, 6 échecs | Sonde de démarrage. |
| `liveness_probe` | HTTP `/` délai de 15 s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Test de disponibilité Cloud Monitoring facultatif (le point de terminaison est public). |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

Hérité d'[App_CloudRun](App_CloudRun.md) et **sans effet** — une SPA statique n'a ni
cache ni file d'attente côté serveur. `enable_redis`, `redis_host`, `redis_port`,
`redis_auth`.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
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
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour Element). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des tâches de configuration (aucune pour Element). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `timeout_seconds` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `homeserver_url` / `homeserver_name` | Votre véritable serveur d'accueil, ou vide pour matrix.org | High | Un serveur d'accueil erroné ou injoignable empêche les utilisateurs de se connecter — l'interface se charge mais l'authentification échoue. |
| `application_version` | Épinglez un véritable tag `element-web` | High | `latest` n'est pas un tag `element-web` valide ; le module épingle `v1.11.86`, mais un `latest` défini à la main dans un ARG de build brut échouerait avec `MANIFEST_UNKNOWN`. |
| `ingress_settings` | `all` pour une interface publique | High | `internal` rend l'interface du client inaccessible depuis les navigateurs situés hors du VPC. |
| `container_image_source` | `custom` | High | Passer à `prebuilt` avec une image dépourvue du point d'entrée `config.json` livre un Element pointant vers le mauvais serveur d'accueil (ou vers aucun). |
| `memory_limit` | `512Mi` | Medium | L'environnement d'exécution gen2 rejette toute valeur inférieure à 512 MiB au moment du plan, quel que soit le mode de facturation. |
| `enable_iap` | À activer pour protéger l'interface | Medium | Sans IAP, toute personne disposant de l'URL peut charger le client (il lui faut toutefois des identifiants du serveur d'accueil pour se connecter). |
| `enable_cdn` | À activer pour les déploiements publics | Low | Servir les assets statiques directement depuis Cloud Run fait passer à côté d'un gain facile en latence et en trafic sortant. |
| Entrées Base de données / Redis / Sauvegarde | Laisser la valeur par défaut | Low | Sans effet pour Element ; les définir n'a aucune incidence. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Element,
partagée avec la variante GKE, est décrite dans **[Element_Common](Element_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Element sur Cloud Run](../labs/Element_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Element sur GKE Autopilot](Element_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Element Common — Configuration applicative partagée](Element_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) et [Headscale sur Google Cloud Run](Headscale_CloudRun.md) dans la solution **Secure Team Communications**.
