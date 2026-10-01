---
title: "Metabase sur GKE Autopilot"
description: "Référence de configuration pour déployer Metabase sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Metabase_GKE.md @ 3055034 sha256:3d9a9e5458f5 -->

# Metabase sur GKE Autopilot {#metabase-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Metabase_GKE.png" alt="Metabase sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Metabase est une plateforme open source de business intelligence et d'analyse qui
permet à des utilisateurs non techniques d'interroger, de visualiser et de partager des
données sans écrire de SQL. Ce module déploie Metabase sur **GKE Autopilot** au-dessus
du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Metabase et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, mise à
l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Metabase s'exécute comme une charge de travail web Java/JVM (Jetty). Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods JVM, 2 vCPU / 4 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Metabase stocke tout l'état de l'application (questions, tableaux de bord, utilisateurs) dans PostgreSQL |
| Secrets | Secret Manager | Mot de passe de la base de données généré automatiquement ; aucun mot de passe administrateur n'est géré ici (Metabase gère le sien) |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec, par défaut, un nom d'hôte HTTPS `<ip>.nip.io` sans configuration (`enable_custom_domain = true`) ; définissez `application_domains` pour un véritable domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge.** Tout l'état de l'application —
  questions, tableaux de bord, collections, utilisateurs — réside dans cette base de
  données.
- **Aucun Redis n'est requis.** Metabase n'utilise pas Redis pour la mise en cache ;
  `enable_redis` vaut `false` par défaut.
- **L'affinité de session vaut `ClientIP`.** Le routage persistant maintient une session
  de navigateur sur un même pod, évitant la perte de session lors de l'augmentation du
  nombre de pods par le HPA.
- **Le démarrage de la JVM prend 60 à 120 secondes.** La sonde de démarrage cible
  `/api/health` avec un délai initial de 60 secondes et 18 tentatives, soit une tolérance
  totale d'environ 240 secondes. `min_instance_count = 1` maintient au moins un pod prêt.
- **`MB_JETTY_PORT = "3000"` et `JAVA_TIMEZONE = "UTC"` sont injectés
  automatiquement** — ne les remplacez pas.
- **Aucun bucket de stockage GCS n'est créé par défaut.** Metabase stocke tout dans
  PostgreSQL. N'ajoutez un bucket via `storage_buckets` qu'en cas de besoin.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Metabase {#a-gke-autopilot--the-metabase-workload}

Les pods Metabase sont planifiés sur Autopilot, qui facture le processeur et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas. La JVM mettant 60 à
120 secondes à s'initialiser, conservez `min_instance_count = 1` en production pour
éviter les délais de démarrage à froid et les échecs de sonde.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Metabase pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Metabase stocke l'intégralité de l'état de son application — questions, tableaux de bord,
collections, utilisateurs, autorisations et paramètres — dans une instance gérée Cloud SQL
for PostgreSQL 15. Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth
Proxy** sur un socket Unix, de sorte qu'aucune adresse IP publique n'est exposée. Lors du
premier déploiement, un job d'initialisation crée la base de données et l'utilisateur
de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Le mot de passe de la base de données est stocké sous forme de secret Secret Manager et
injecté dans les pods à l'exécution ; il n'apparaît jamais en clair dans la configuration.
Metabase gère séparément sa propre clé de chiffrement interne.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI
et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

`enable_custom_domain = true` par défaut, donc App_GKE provisionne d'emblée un ingress
HTTPS basé sur une Gateway. Si aucun `application_domains` n'est défini, il dérive un nom
d'hôte `<ip>.nip.io` sans configuration à partir de l'adresse IP statique réservée, ainsi
qu'un certificat géré par Google correspondant, de sorte que Metabase dispose
immédiatement du HTTPS. Définissez `application_domains` pour servir plutôt un véritable
domaine personnalisé ; une adresse IP statique est réservée par défaut afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
de l'adresse IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (y compris les journaux de la JVM Metabase) sont
envoyées à Cloud Logging ; les métriques de GKE et de Cloud SQL sont envoyées à Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont
disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Metabase {#3-metabase-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation s'exécute avant la charge de travail applicative ; il utilise
  `postgres:15-alpine` pour se connecter à Cloud SQL via l'Auth Proxy et créer de manière
  idempotente la base de données et l'utilisateur de l'application. Il peut être
  relancé sans risque.
- **Aucune migration automatique au démarrage.** Contrairement à certaines autres
  applications, Metabase n'exécute pas de migrations de schéma à chaque démarrage. Les
  migrations s'exécutent dans le cadre du processus applicatif Metabase au premier
  démarrage, sur une base de données déjà initialisée — d'où l'importance de la réussite
  préalable de la tâche `db-init`.
- **Prudence lors des mises à niveau.** Les migrations de Metabase sont à sens unique.
  Revenir à une version antérieure après l'exécution d'une migration corrompt le schéma.
  Testez toujours les mises à niveau dans un environnement de préproduction avant de les
  appliquer en production.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health`, qui
  ne renvoie HTTP 200 que lorsque la JVM est complètement initialisée et connectée à
  PostgreSQL. La sonde de démarrage utilise un délai initial de 60 secondes avec
  18 tentatives (période de 10s), soit une tolérance totale d'environ 240 secondes. Ne
  réduisez pas ces valeurs.
- **Configuration de l'administrateur.** Au premier démarrage, Metabase présente un
  assistant de configuration dans le navigateur. Une fois la configuration terminée, les
  identifiants administrateur sont gérés dans Metabase lui-même — ce module ne gère ni
  `SECRET_KEY` ni mot de passe administrateur.
- **Sources de données.** Metabase est un outil de BI qui interroge des bases de données
  externes. Après le déploiement, configurez les sources de données dans Metabase Admin →
  Databases. Les sources natives GCP courantes incluent BigQuery, Cloud SQL
  PostgreSQL/MySQL et Google Sheets.
- **`MB_JETTY_PORT` et `JAVA_TIMEZONE` sont fixés.** Ils sont injectés automatiquement
  par `Metabase_Common`. Les remplacer via `environment_variables` casse le routage ou
  produit des horodatages de rapports incorrects.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Metabase ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `metabase` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Metabase Analytics` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `v0.51.3` | Tag de version de l'image Metabase ; incrémentez-le pour déployer une nouvelle version. **Ne revenez jamais à une version antérieure** — les migrations sont irréversibles. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites de processeur/mémoire. La JVM requiert au moins 2 GiB ; 4 GiB recommandés en production. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Conservez ≥ 1 pour éviter les démarrages à froid de la JVM de 60 à 120s. |
| `max_instance_count` | `5` | Nombre maximal de réplicas (plafond de l'autoscaler). |
| `container_port` | `3000` | Port Jetty de Metabase — doit correspondre à `MB_JETTY_PORT`. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket Unix. Obligatoire. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources — recommandé pour dimensionner correctement la JVM. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `MB_JETTY_PORT` et `JAVA_TIMEZONE` sont injectés automatiquement — ne les remplacez pas. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager (par exemple, mot de passe SMTP). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Manière dont le Service est exposé. |
| `session_affinity` | `ClientIP` | Routage persistant requis pour maintenir les sessions de navigateur sur un même pod lors de l'augmentation du nombre de pods par le HPA. |
| `workload_type` | `null` | Résolu automatiquement ; Metabase étant sans état, utilisez `"Deployment"`. |
| `termination_grace_period_seconds` | `60` | Nombre de secondes pendant lesquelles Kubernetes attend après SIGTERM ; permet aux requêtes en cours de se terminer. |

### Groupe 7 — StatefulSet (avancé) {#group-7--statefulset-advanced}

Non recommandé pour Metabase — l'application est sans état. Consultez
[App_GKE](App_GKE.md) pour les mécanismes des StatefulSet si nécessaire.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le processeur, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers bruts sont interprétés comme des octets et bloquent la planification. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Augmentez `min_instance_count` au-delà de 1 si vous avez besoin de marge pour les évictions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | `/api/health`, délai initial de 60s, seuil d'échec de 18 | Sonde HTTP ; tolérance totale d'environ 240s pour le démarrage de la JVM. Ne la réduisez pas. |
| `health_check_config` | `/api/health`, délai initial de 120s, seuil d'échec de 3 | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche intégrée `db-init` (création de la base de données PostgreSQL et de l'utilisateur). |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés pour toute tâche récurrente. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Le stockage NFS n'est pas requis pour Metabase — tout l'état se trouve dans PostgreSQL. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne des buckets GCS lorsque `storage_buckets` n'est pas vide. |
| `storage_buckets` | `[]` | Vide par défaut — Metabase n'a pas besoin de stockage d'objets. N'ajoutez des buckets ici qu'en cas de besoin (par exemple pour le stockage S3 de Metabase Enterprise). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé — ne le modifiez pas. Metabase requiert PostgreSQL. |
| `application_database_name` | `metabase` | Entrée générique d'App_GKE pour le nom de la base de données. **Sans effet pour ce module** — App_GKE dérive le nom réel de la base de données de la configuration `db_name` du module (voir ci-dessous), et non de cette variable. |
| `application_database_user` | `metabase` | Entrée générique d'App_GKE pour l'utilisateur de la base de données. **Sans effet pour ce module** — voir `db_user` ci-dessous. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |
| `db_name` | `metabase` | Nom de la base de données **faisant autorité**, transmis à `Metabase_Common`. Immuable après le premier déploiement — le renommer recrée la base de données et détruit les données. |
| `db_user` | `metabase` | Utilisateur de l'application **faisant autorité**, transmis à `Metabase_Common`. Immuable après le premier déploiement. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 pour la production/la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'ingress HTTPS de la Gateway ; dérive un nom d'hôte `<ip>.nip.io` sans configuration lorsque `application_domains` est vide. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |
| `network_tags` | `['nfsserver']` | Tags de nœud/pod pour les règles de pare-feu. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Metabase. Vivement recommandé — sinon, la page de connexion propre à Metabase est joignable publiquement. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor et CDN {#group-21--cloud-armor--cdn}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la règle. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'atteindre Metabase. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'importation (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Metabase requiert PostgreSQL ; tout autre moteur empêche le démarrage. |
| `enable_cloudsql_volume` | `true` | Critique | Le désactiver casse toutes les connexions à la base de données (le sidecar Auth Proxy est requis). |
| `container_resources.memory_limit` | `4Gi` | Critique | En dessous de 2 GiB, la JVM plante avec une OutOfMemoryError au démarrage. |
| `db_name` / `db_user` | à définir une seule fois | Critique | Ce sont eux qui contrôlent le nom/l'utilisateur **réels** de la base de données (transmis à `Metabase_Common`) ; immuables après le premier déploiement — les renommer recrée la base de données/l'utilisateur et détruit toutes les données de l'application. `application_database_name`/`application_database_user` sont les entrées génériques d'App_GKE, mais elles sont masquées/sans effet pour ce module (App_GKE dérive le nom réel de la configuration `db_name` du module) ; les modifier n'a donc aucun effet. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer la tâche d'importation. |
| `application_version` | à incrémenter avec prudence | Critique | Les migrations de Metabase sont à sens unique ; revenir à une version antérieure corrompt le schéma. Testez toujours les mises à niveau en préproduction. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers bruts sont interprétés comme des octets et bloquent toute planification. |
| `startup_probe_config.failure_threshold` | `18` (≥ 18) | Élevé | Le réduire provoque l'arrêt prématuré des pods avant que la JVM n'ait terminé son démarrage. |
| `min_instance_count` | `1` | Élevé | `0` entraîne des démarrages à froid de 60 à 120s ; échecs de sonde à la première requête. |
| `container_resources.cpu_limit` | `2000m` | Élevé | En dessous de 500m, la compilation JIT de la JVM bloque le démarrage et déclenche des échecs de sonde. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les déploiements multi-pods perdent l'état des sessions de navigateur lors de l'augmentation du nombre de pods. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Élevé | Sinon, la page de connexion de Metabase est joignable publiquement. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |
| `pdb_min_available` vs `min_instance_count` | laissez de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (l'unique pod ne peut pas être évincé). |
| `enable_redis` | `false` | Faible | Metabase n'utilise pas Redis ; l'activer n'a aucun effet. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
mise à l'échelle automatique, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Metabase partagée avec la
variante Cloud Run est décrite dans **[Metabase_Common](Metabase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Metabase sur GKE Autopilot](../labs/Metabase_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Metabase sur Google Cloud Run](Metabase_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Metabase Common — Configuration applicative partagée](Metabase_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Kestra sur GKE Autopilot](Kestra_GKE.md), [Apache Superset sur GKE Autopilot](Superset_GKE.md) dans la solution **Analytics Warehouse**.
