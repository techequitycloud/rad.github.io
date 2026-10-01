---
title: "LubeLogger sur Google Cloud Run"
description: "Référence de configuration pour déployer LubeLogger sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/LubeLogger_CloudRun.md @ 3055034 sha256:0a1ed1e76a2a -->

# LubeLogger sur Google Cloud Run {#lubelogger-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_CloudRun.png" alt="LubeLogger sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger est un outil gratuit et open source de suivi de l'entretien des véhicules
et de la consommation de carburant, construit sur ASP.NET Core (.NET) et livré sous
la forme d'une image de conteneur unique avec une base de données LiteDB intégrée.
Ce module déploie LubeLogger sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise LubeLogger et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, ingress et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LubeLogger s'exécute sous la forme d'un conteneur ASP.NET Core sur Cloud Run v2. Le
déploiement assemble un ensemble minimal de services Google Cloud — la configuration
par défaut ne comporte aucune base de données gérée :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service ASP.NET Core, 1 vCPU / 1 GiB par défaut, autoscaling serverless ; fixé à une seule instance |
| Base de données | Aucune (par défaut) | Le mode par défaut de LubeLogger utilise un fichier de base de données LiteDB intégré — aucune instance Cloud SQL n'est créée |
| Stockage objet | Cloud Storage | Deux buckets : `storage` (fichier de base de données LiteDB + photos/reçus/documents téléversés) et `dpkeys` (clés ASP.NET Core Data Protection) |
| Cache et file d'attente | Aucun | LubeLogger n'utilise pas Redis et n'a ni worker en arrière-plan ni file d'attente |
| Secrets | Aucun | Aucun secret n'est généré — le premier compte est créé par inscription en libre-service |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données externe par défaut.** `database_type = "NONE"` — le
  fichier de base de données LiteDB intégré de LubeLogger fait foi et est conservé
  via un volume GCS FUSE. LubeLogger prend aussi en charge un backend Postgres
  externe facultatif via une unique variable d'environnement DSN
  `POSTGRES_CONNECTION`, mais ce module ne câble pas Cloud SQL pour cela.
- **Une seule instance.** `min_instance_count = 1` et `max_instance_count = 1` — le
  mode par défaut de LubeLogger sert un unique fichier de base de données partagé
  depuis un seul volume ; exécuter plusieurs instances sur le même fichier le
  corrompt.
- **Sécurisé par défaut.** `EnableAuth = "true"` remplace la valeur par défaut de
  `appsettings.json` de LubeLogger, qui laisse l'accès entièrement ouvert. Aucun
  compte administrateur n'est pré-créé — la première personne qui remplit le
  formulaire d'inscription sur `/Login` obtient l'accès.
- **Clés Data Protection persistantes.** Un petit bucket `dpkeys` dédié est toujours
  monté sur `/root/.aspnet/DataProtection-Keys` afin que les sessions de connexion
  survivent aux redémarrages du conteneur ; il est distinct du bucket principal
  `storage`.
- **Image préconstruite, sans étape de build.** Le module déploie directement
  l'image officielle `ghcr.io/hargata/lubelogger` (mise en miroir dans Artifact
  Registry par défaut) — aucun Dockerfile ni Cloud Build n'intervient.
- **Les sondes de santé utilisent `/Login`,** et non `/` — la racine de
  l'application est protégée par `[Authorize]` et ferait échouer une sonde non
  authentifiée de la plateforme, même sur un conteneur en bonne santé.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service LubeLogger {#a-cloud-run--the-lubelogger-service}

LubeLogger s'exécute sous la forme d'un unique service Cloud Run v2 (fixé à une
instance). Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage {#b-cloud-storage}

Deux buckets **Cloud Storage** dédiés sont provisionnés automatiquement :

- **`storage`** — monté sur `/App/data` via GCS FUSE ; contient le fichier de base de
  données LiteDB intégré et les photos/reçus/documents téléversés.
- **`dpkeys`** — monté sur `/root/.aspnet/DataProtection-Keys` ; contient les clés
  de signature des cookies et des sessions d'ASP.NET Core.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
gcloud storage ls gs://<storage-bucket>/        # bucket names are in the Outputs
```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Réseau et entrée {#c-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut y être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux du conteneur sont acheminés vers Cloud Logging ; les métriques Cloud
Run vers Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LubeLogger {#3-lubelogger-application-behaviour}

- **Aucune initialisation de base de données au premier déploiement.** Il n'y a pas
  de job `db-init` — LubeLogger initialise lui-même son fichier de base de données
  LiteDB et son arborescence (`config/`,
  `documents/`, `images/`, `temp/`, `themes/`, `translations/` sous `/App/data`) au
  premier démarrage.
- **Aucun identifiant administrateur fixe.** Ouvrez le service, allez sur `/Login`
  et soumettez le formulaire **Register** (inscription) — il devient le compte
  utilisable. Faites-le immédiatement après le premier déploiement :
  `EnableAuth = "true"` restreint le reste de l'application, mais l'inscription
  elle-même reste ouverte à quiconque peut atteindre l'URL tant qu'aucun premier
  compte n'existe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/Login` — la
  page publique et non authentifiée de LubeLogger. La racine de l'application `/`
  est protégée par `[Authorize]` et renverrait une 401/une redirection à une sonde
  non authentifiée, même sur un conteneur en bonne santé.
- **Postgres externe facultatif.** LubeLogger prend en charge une unique variable
  d'environnement DSN `POSTGRES_CONNECTION`
  (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`)
  pour utiliser une base de données Postgres externe à la place du fichier LiteDB
  intégré. Ce module ne provisionne pas Cloud SQL pour cette option — un opérateur
  qui fournit sa propre instance Postgres peut définir la variable via
  `secret_environment_variables`.
- **Une seule instance, toujours.** `max_instance_count` est fixé à `1` — le mode
  par défaut de LubeLogger ne prend en charge ni le verrouillage distribué ni
  l'écriture multiple pour sa base de données intégrée.
- **Inspecter la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à LubeLogger ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Labels appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lubelogger` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `LubeLogger` | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image sur `ghcr.io/hargata/lubelogger`. Comme l'image est préconstruite (et non construite sur mesure), cette valeur sélectionne directement la version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Maintenu à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`** — le mode par défaut de LubeLogger sert un unique fichier de base de données partagé. |
| `container_port` | `8080` | LubeLogger écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Le mode par défaut de LubeLogger n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image LubeLogger dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements par étapes. |
| `max_revisions_to_retain` | `7` | Déclarée par cohérence avec la convention ; non utilisée par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public — LubeLogger est une application web destinée aux utilisateurs. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets, fusionnés avec la valeur par défaut du module `EnableAuth = "true"`. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager. Utilisez-la pour `POSTGRES_CONNECTION` si vous câblez le backend Postgres externe facultatif. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires, en plus des buckets `storage`/`dpkeys` provisionnés automatiquement. |
| `enable_nfs` | `false` | Non utilisé par LubeLogger par défaut. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires (gen2 requis). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le mode par défaut de LubeLogger n'a pas de base de données Cloud SQL. |
| `database_password_length` | `32` | Non utilisée dans la configuration par défaut. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Le mode par défaut de LubeLogger n'a besoin d'aucun job d'initialisation. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/Login`, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/Login` | Sonde structurée alternative. |
| `health_check_config` | HTTP `/Login` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/Login" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `lubelogger_url` | URL VPC interne de l'interface web de LubeLogger. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | Le mode par défaut de LubeLogger sert un unique fichier de base de données intégré et partagé depuis un seul volume ; plus d'une instance expose à une corruption de la base par des écritures concurrentes. |
| Buckets `storage`/`dpkeys` | Ne jamais les supprimer | Critical | Perdre `storage` fait perdre tous les dossiers de véhicules ; perdre `dpkeys` invalide toutes les sessions de connexion existantes (récupérable — impose seulement une nouvelle connexion). |
| `EnableAuth` | `true` (par défaut) | Critical | Le passer à `false` rétablit le mode d'accès entièrement ouvert de LubeLogger — toute personne disposant de l'URL peut consulter et modifier toutes les données sans aucune connexion. |
| Inscription au premier lancement | À effectuer immédiatement après le déploiement | High | Tant qu'aucun premier compte n'est inscrit, le formulaire d'inscription est accessible à quiconque peut atteindre l'URL. |
| Chemin de `startup_probe`/`liveness_probe` | `/Login` | Critical | Pointer les sondes sur `/` (ou sur tout chemin protégé par `[Authorize]`) fait échouer la sonde sur un conteneur par ailleurs en bonne santé — la révision ne devient jamais Ready. |
| `database_type` | `NONE` (par défaut) | High | Le mode par défaut de LubeLogger ignore entièrement ce paramètre ; le modifier ne connecte pas LubeLogger à une instance Cloud SQL — utilisez plutôt `POSTGRES_CONNECTION` pour l'option Postgres externe facultative. |
| `min_instance_count` | `1` | Medium | La valeur `0` autorise les démarrages à froid ; comme `max_instance_count` est fixé à `1`, il n'y a aucun risque lié à la répartition du trafic, seulement une latence accrue sur la première requête après une période d'inactivité. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |
| `enable_cloud_armor` | à activer en production | Medium | Sinon, l'interface web publique et l'API REST sont accessibles sans protection WAF. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à LubeLogger, partagée avec la variante GKE, est décrite dans
**[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LubeLogger sur Cloud Run](../labs/LubeLogger_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [LubeLogger Common — Configuration applicative partagée](LubeLogger_Common.md) — la configuration partagée par les deux cibles de déploiement.
