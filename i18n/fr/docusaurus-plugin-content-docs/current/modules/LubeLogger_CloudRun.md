---
title: "LubeLogger sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de LubeLogger sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/LubeLogger_CloudRun.md @ 15fd4c7 sha256:6f5b69dc7887 -->

# LubeLogger sur Google Cloud Run {#lubelogger-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/LubeLogger_CloudRun.png" alt="LubeLogger sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

LubeLogger est un outil de suivi de l'entretien des véhicules et de la consommation
de carburant, gratuit et open source, basé sur ASP.NET Core (.NET), livré sous
forme d'une seule image conteneur avec une base de données LiteDB embarquée. Ce
module déploie LubeLogger sur **Cloud Run v2** en s'appuyant sur le module
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par LubeLogger et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez-vous référer au
[guide App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

LubeLogger s'exécute comme un conteneur ASP.NET Core sur Cloud Run v2. Le
déploiement connecte un ensemble minimal de services Google Cloud — il n'y a pas
de base de données gérée dans la configuration par défaut :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service ASP.NET Core, 1 vCPU / 1 GiB par défaut, autoscaling serverless ; fixé à une seule instance |
| Base de données | Aucune (par défaut) | Le mode par défaut de LubeLogger utilise un fichier de base de données LiteDB embarqué interne — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage | Deux buckets : `storage` (fichier de base de données LiteDB + photos/reçus/documents téléchargés) et `dpkeys` (clés de protection des données ASP.NET Core) |
| Cache & file d'attente | Aucun | LubeLogger n'utilise pas Redis et n'a pas de worker/file d'attente en arrière-plan |
| Secrets | Aucun | Aucun secret n'est généré — le premier compte est créé via l'enregistrement en libre-service |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app` (`ingress_settings = "all"`) ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe par défaut.** `database_type = "NONE"` — le fichier de base de
  données LiteDB embarqué de LubeLogger est la source de vérité, persisté via un
  volume GCS FUSE. LubeLogger prend également en charge un backend Postgres
  externe optionnel via une seule variable d'environnement DSN `POSTGRES_CONNECTION`, mais ce
  module ne connecte pas Cloud SQL pour cela.
- **Une seule instance.** `min_instance_count = 1` et `max_instance_count = 1` — le mode par défaut de LubeLogger
  sert un fichier de base de données partagé à partir d'un seul volume ;
  l'exécution de plusieurs instances sur le même fichier le corrompt.
- **Sécurisé par défaut.** `EnableAuth = "true"` remplace le paramètre par défaut de LubeLogger
  `appsettings.json` d'accès entièrement ouvert. Il n'y a pas de compte administrateur
  pré-initialisé — la première personne à remplir le formulaire
  **Register** sur `/Login` obtient l'accès.
- **Clés de protection des données persistantes.** Un petit bucket `dpkeys` dédié
  est toujours monté à `/root/.aspnet/DataProtection-Keys` afin que les sessions de connexion survivent aux
  redémarrages des conteneurs ; ceci est séparé du bucket principal `storage`.
- **Image pré-construite, pas d'étape de build.** Le module déploie directement
  l'image officielle `ghcr.io/hargata/lubelogger` (mise en miroir dans Artifact Registry par défaut) —
  il n'y a pas de Dockerfile ou de Cloud Build impliqué.
- **Les sondes de santé utilisent `/Login`,** pas `/` — la racine de l'application
  est protégée par `[Authorize]` et ferait échouer une sonde de plateforme non
  authentifiée même sur un conteneur sain.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service LubeLogger {#a-cloud-run--the-lubelogger-service}

LubeLogger s'exécute comme un service Cloud Run v2 unique (fixé à une instance).
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

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage {#b-cloud-storage}

Deux buckets **Cloud Storage** dédiés sont provisionnés automatiquement :

- **`storage`** — monté à `/App/data` via GCS FUSE ; contient le fichier de base de
  données LiteDB embarqué et les photos/reçus/documents téléchargés.
- **`dpkeys`** — monté à `/root/.aspnet/DataProtection-Keys` ; contient les clés de signature de cookie/session
  d'ASP.NET Core.

```bash
gcloud storage buckets list --project "$PROJECT" --filter="name~lubelogger"
gcloud storage ls gs://<storage-bucket>/        # bucket names are in the Outputs
```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`). Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être ajoutés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte optionnels.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application LubeLogger {#3-lubelogger-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** Il n'y a
  pas de job `db-init` — LubeLogger initialise son propre fichier de base de données
  LiteDB et sa structure de répertoires (`config/`, `documents/`, `images/`, `temp/`, `themes/`,
  `translations/` sous `/App/data`) au premier démarrage.
- **Pas de credential admin fixe.** Ouvrez le service, allez à `/Login`, et
  soumettez le formulaire **Register** — cela deviendra le compte utilisable.
  Effectuez cette opération immédiatement après le premier déploiement : `EnableAuth = "true"`
  restreint le reste de l'application, mais l'enregistrement lui-même est ouvert
  à quiconque peut atteindre l'URL jusqu'à ce qu'un premier compte existe.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/Login` — la
  page publique et non authentifiée de LubeLogger. La racine de l'application
  `/` est protégée par `[Authorize]` et renverrait un 401/redirigerait une sonde non
  authentifiée même sur un conteneur sain.
- **Postgres externe optionnel.** LubeLogger prend en charge une seule variable
  d'environnement DSN `POSTGRES_CONNECTION` (`Host=<host>;Port=5432;Username=<user>;Password=<pass>;Database=<db>;`) pour utiliser une base de données Postgres
  externe au lieu du fichier LiteDB embarqué. Ce module ne provisionne pas Cloud
  SQL pour ce chemin — un opérateur fournissant sa propre instance Postgres peut
  définir la variable via `secret_environment_variables`.
- **Instance unique, toujours.** `max_instance_count` est fixé à `1` — le mode par défaut de
  LubeLogger n'a pas de support de verrouillage distribué ou de multi-écriture
  pour sa base de données embarquée.
- **Inspecter la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
LubeLogger sont listés ; toutes les autres entrées sont héritées de
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
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `lubelogger` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `LubeLogger` | Nom lisible par l'homme affiché dans la Console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image sur `ghcr.io/hargata/lubelogger`. L'image étant pré-construite (non construite sur mesure), cela sélectionne directement la version publiée. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Maintenu à `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | **Doit rester à `1`** — le mode par défaut de LubeLogger sert un fichier de base de données partagé. |
| `container_port` | `8080` | LubeLogger écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Le mode par défaut de LubeLogger n'a pas de Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LubeLogger dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public — LubeLogger est une application web destinée aux utilisateurs. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, fusionnés avec le `EnableAuth = "true"` par défaut du module. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Utilisez ceci pour `POSTGRES_CONNECTION` si vous connectez le backend Postgres externe optionnel. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà des buckets `storage`/`dpkeys` auto-provisionnés. |
| `enable_nfs` | `true` | Non utilisé par LubeLogger par défaut. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — le mode par défaut de LubeLogger n'a pas de base de données Cloud SQL. |
| `database_password_length` | `32` | Non référencé dans la configuration par défaut. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Le mode par défaut de LubeLogger n'a pas besoin de job d'initialisation. |
| `cron_jobs` | `[]` | Pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/Login` délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/Login` délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/Login` | Sonde structurée alternative. |
| `health_check_config` | HTTP `/Login` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/Login" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 23 — VPC Service Controls et Audit Logging {#group-23--vpc-service-controls--audit-logging}

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
| `lubelogger_url` | URL VPC interne pour l'interface web LubeLogger. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`storage`, `dpkeys`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Audit logging et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide
> les valeurs *et les combinaisons* au moment de la planification. Une
> configuration invalide fait échouer la **planification** avec une erreur
> claire et nommée avant la création de toute ressource, de sorte que la plupart
> des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de
> l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Le mode par défaut de LubeLogger sert un fichier de base de données embarqué partagé à partir d'un seul volume ; plus d'une instance risque la corruption de la base de données par des écritures concurrentes. |
| Buckets `storage`/`dpkeys` | Ne jamais supprimer | Critique | La perte de `storage` entraîne la perte de tous les enregistrements de véhicules ; la perte de `dpkeys` invalide toutes les sessions de connexion existantes (récupérable — force uniquement la reconnexion). |
| `EnableAuth` | `true` (par défaut) | Critique | Le définir à `false` revient au mode d'accès entièrement ouvert de LubeLogger — toute personne ayant l'URL peut consulter/modifier toutes les données sans aucune connexion. |
| Enregistrement initial | À compléter immédiatement après le déploiement | Élevé | Tant qu'un premier compte n'est pas enregistré, le formulaire d'enregistrement est accessible à quiconque peut atteindre l'URL. |
| Chemin `startup_probe`/`liveness_probe` | `/Login` | Critique | Pointer les sondes vers `/` (ou tout chemin protégé par `[Authorize]`) fait échouer la sonde sur un conteneur par ailleurs sain — la révision ne devient jamais prête. |
| `database_type` | `NONE` (par défaut) | Élevé | Le mode par défaut de LubeLogger ignore entièrement ce paramètre ; le modifier ne connecte pas LubeLogger à une instance Cloud SQL — utilisez `POSTGRES_CONNECTION` à la place pour le chemin Postgres externe optionnel. |
| `min_instance_count` | `1` | Moyen | Le définir à `0` permet les démarrages à froid ; puisque `max_instance_count` est fixé à `1`, il n'y a pas de risque de répartition du trafic, seulement une latence supplémentaire lors de la première requête après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface web publique et l'API REST sont accessibles sans protection WAF autrement. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
LubeLogger partagée avec la variante GKE est décrite dans
**[LubeLogger_Common](LubeLogger_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : LubeLogger sur Cloud Run](../labs/LubeLogger_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [LubeLogger Common — Configuration d'application partagée](LubeLogger_Common.md) — la configuration partagée par les deux cibles de déploiement.
