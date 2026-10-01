---
title: "Module Invoice Ninja GKE — Guide de configuration"
description: "Référence de configuration pour déployer InvoiceNinja sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/InvoiceNinja_GKE.md @ 3055034 sha256:936b2a35f794 -->

# Module Invoice Ninja GKE — Guide de configuration {#invoice-ninja-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/InvoiceNinja_GKE.png" alt="Module Invoice Ninja GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit chaque variable de configuration disponible dans le module `InvoiceNinja_GKE`. `InvoiceNinja_GKE` est un **module enveloppe** (wrapper) qui combine le module d'infrastructure générique `App_GKE` avec la configuration applicative partagée `InvoiceNinja_Common` pour déployer [Invoice Ninja](https://invoiceninja.com/) — la plateforme open source de facturation — sur Google Kubernetes Engine (GKE) Autopilot.

Invoice Ninja fournit une suite de facturation complète auto-hébergée : devis, factures, reçus, paiements clients, facturation récurrente, suivi des dépenses, suivi du temps, gestion de projets et portail client en libre-service. C'est une alternative auto-hébergée à FreshBooks ou QuickBooks.

La plupart des options de configuration de `InvoiceNinja GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable a un comportement identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seuls les variables et les valeurs par défaut **propres à Invoice Ninja** sont décrites en détail ici.

> **Remarque :** les variables indiquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les domaines de configuration suivants sont fournis par le module sous-jacent `App_GKE`.

| Domaine de configuration | Remarques propres à Ghost |
|---|---|
| Projet et identité | Identique à `App_GKE`. |
| Identité de l'application | Valeurs par défaut propres à Invoice Ninja pour `application_name`, `application_display_name` et `application_version` ; voir [Groupe 3 : Identité de l'application](#group-3-application-identity). |
| Exécution et mise à l'échelle | Valeurs par défaut propres à Invoice Ninja pour `container_port`, `cpu_limit`, `memory_limit` et `container_resources` ; voir [Groupe 4 : Exécution et mise à l'échelle](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | `DB_CONNECTION=mysql`, `TRUSTED_PROXIES=*` et les variables snappdf sont injectées automatiquement ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et règles réseau | Identique à `App_GKE`. |
| Jobs d'initialisation et CronJobs | Le job MySQL `db-init` et `artisan-migrate` sont fournis automatiquement par `InvoiceNinja Common` ; voir [Groupe 11 : Jobs et tâches planifiées](#group-11-jobs--scheduled-tasks). |
| Stockage — NFS | `enable_nfs` vaut `true` par défaut ; voir [Groupe 16 : Stockage — NFS](#group-16-storage--nfs). |
| Stockage — GCS | Bucket GCS `data` provisionné automatiquement ; voir [Groupe 17 : Stockage — GCS](#group-17-storage--gcs). |
| Configuration de la base de données | **MySQL 8.0 obligatoire** ; voir [Groupe 18 : Configuration de la base de données](#group-18-database-configuration). |
| Planification et rétention des sauvegardes | Identique à `App_GKE`. |
| Scripts SQL personnalisés | Identique à `App_GKE`. |
| Observabilité et santé | Réglage des sondes pour Invoice Ninja ; voir [Groupe 19 : Observabilité et santé](#group-19-observability--health). |
| Cloud Armor WAF | Identique à `App_GKE`. |
| Identity-Aware Proxy | Identique à `App_GKE`. |
| Binary Authorization | Identique à `App_GKE`. |
| VPC Service Controls | Identique à `App_GKE`. |
| Cache Redis | Invoice Ninja **exige** Redis ; `enable_redis = true` par défaut ; voir [Groupe : Cache Redis](#redis-cache). |

---

## Relation entre InvoiceNinja GKE et App GKE {#how-invoiceninja-gke-relates-to-app-gke}

`InvoiceNinja GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `InvoiceNinja Common` qui fournit les valeurs par défaut et la configuration applicative propres à Invoice Ninja. Les principaux effets sont les suivants :

1. **MySQL 8.0 est obligatoire.** L'application Laravel d'Invoice Ninja ne prend en charge que MySQL. La valeur par défaut de `database_type` est `"MYSQL_8_0"`.
2. **`DB_CONNECTION=mysql` est injecté automatiquement.** Laravel a besoin de cette variable d'environnement pour sélectionner le pilote PDO MySQL.
3. **`TRUSTED_PROXIES=*` est injecté automatiquement.** Sans cela, Laravel génère des liens `http://` derrière l'équilibreur de charge GKE même lorsque les clients accèdent en HTTPS, ce qui casse les liens des factures.
4. **Les variables de génération PDF snappdf sont injectées.** `PDF_GENERATOR=snappdf` et `SNAPPDF_EXECUTABLE_PATH=/usr/local/bin/chrome` sont définies automatiquement. Le conteneur `invoiceninja/invoiceninja:5` embarque Chromium à cet emplacement.
5. **`APP_KEY` est généré automatiquement et stocké dans Secret Manager.** `InvoiceNinja Common` crée la clé de chiffrement Laravel lors du premier apply et l'injecte à l'exécution. Elle n'est jamais écrite en clair dans l'état.
6. **Un bucket GCS `data` est provisionné automatiquement.** `InvoiceNinja Common` fournit une définition de bucket `data` pour le stockage des documents.
7. **Deux jobs d'initialisation s'exécutent lors du premier déploiement.** `db-init` crée le schéma et l'utilisateur MySQL ; `artisan-migrate` exécute les migrations Laravel, y compris les données initiales. Les deux s'exécutent à chaque apply (`execute_on_apply = true`), de sorte que les montées de version appliquent automatiquement les modifications de schéma.
8. **Les ressources par défaut sont dimensionnées pour Invoice Ninja.** Les valeurs par défaut de `cpu_limit` (2 vCPU) et de `memory_limit` (2 Gi) tiennent compte de la génération PDF par Chromium. 4 Gi sont recommandés pour les déploiements à fort volume.
9. **Redis est obligatoire et activé par défaut.** Invoice Ninja utilise Redis pour `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. Sans Redis, la génération PDF en arrière-plan et l'envoi des e-mails bloquent le cycle de requête HTTP et échouent sous charge concurrente.
10. **L'affinité de session vaut `"ClientIP"` par défaut.** Invoice Ninja utilise des sessions PHP côté serveur. Sans routage persistant, les administrateurs sont déconnectés lorsque des requêtes sont acheminées vers un autre pod.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | — | ID du projet GCP. **Obligatoire.** |
| `region` | `"us-central1"` | Région GCP. Utilisée en repli lorsque la découverte réseau ne peut pas déterminer la région à partir des sous-réseaux VPC existants. |

---

## Groupe 2 : Identité du déploiement {#group-2-deployment-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `"demo"` | Suffixe court ajouté à tous les noms de ressources. |
| `support_users` | `[]` | Adresses e-mail pour les alertes de surveillance et l'accès IAM. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources provisionnées. |

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

**Valeurs par défaut propres à Invoice Ninja :**

| Variable | Valeur par défaut InvoiceNinja GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `application_name` | `"invoiceninja"` | `"gkeapp"` | Nom de base des ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Invoice Ninja"` | `"App GKE Application"` | Affiché dans l'interface de la plateforme et les tableaux de bord. |
| `application_description` | `"Invoice Ninja Invoicing on GKE Autopilot"` | `"App GKE Custom Application…"` | Libellé descriptif. |
| `application_version` | `"5"` | `"1.0.0"` | La version d'Invoice Ninja à déployer. |
| `display_name` | `"Invoice Ninja"` | *(absent de App GKE)* | Alias lisible. |
| `description` | `"Invoice Ninja - Open-source invoicing platform on GKE Autopilot"` | *(absent de App GKE)* | Description transmise à `InvoiceNinja Common` pour les métadonnées des jobs d'initialisation. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

**Valeurs par défaut et comportement propres à Invoice Ninja :**

| Variable | Valeur par défaut InvoiceNinja GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `container_port` | `80` | `8080` | Invoice Ninja utilise nginx sur le port 80. Ne modifiez pas cette valeur sauf si votre Dockerfile personnalisé lie nginx à un autre port. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Invoice Ninja exige au minimum 2 vCPU / 2 Gi pour la génération PDF par Chromium. |
| `cpu_limit` | `"2000m"` | — | Alias abrégé de `container_resources.cpu_limit`. Transmis à `InvoiceNinja Common`. |
| `memory_limit` | `"2Gi"` | — | Alias abrégé de `container_resources.memory_limit`. Minimum 2 Gi pour Chromium. |
| `min_instance_count` | `1` | `1` | Identique à la valeur par défaut de `App_GKE` — Invoice Ninja reste démarré. Un démarrage à froid implique PHP-FPM, l'amorçage de Laravel et une éventuelle migration. |
| `max_instance_count` | `5` | `3` | Plafond plus élevé pour les pics de traitement des factures. |
| `container_image_source` | `"prebuilt"` | `"custom"` | L'image officielle `invoiceninja/invoiceninja:5` est prête pour la production sans personnalisation. |
| `enable_cloudsql_volume` | `true` | `true` | Le sidecar Cloud SQL Auth Proxy est nécessaire pour la connexion MySQL par socket Unix. |
| `session_affinity` | `"ClientIP"` | `"None"` | **Important pour Invoice Ninja.** Sans `"ClientIP"`, les administrateurs sont déconnectés lorsque des requêtes sont acheminées vers un autre pod, car les sessions PHP ne sont pas partagées entre les réplicas. |
| `timeout_seconds` | `300` | `300` | Portez à `600` pour les déploiements à fort volume où la génération PDF ou les exports de rapports par lots peuvent prendre plus de temps. |

Les variables `deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `container_protocol`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels` et `enable_cloudsql_volume` se comportent comme décrit dans la documentation de App_GKE.

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

**Variables d'environnement injectées automatiquement pour Invoice Ninja :**

Les variables suivantes sont injectées automatiquement par `InvoiceNinja Common` et n'ont pas besoin d'être définies manuellement dans `environment_variables` :

| Variable | Valeur injectée automatiquement | Rôle |
|---|---|---|
| `APP_ENV` | `"production"` | Mode d'environnement de Laravel. |
| `APP_DEBUG` | `"false"` | Désactive la sortie de débogage de Laravel. |
| `DB_CONNECTION` | `"mysql"` | Pilote de base de données de Laravel. |
| `TRUSTED_PROXIES` | `"*"` | Traitement correct de X-Forwarded-For et X-Forwarded-Proto derrière l'équilibreur de charge GKE. |
| `PDF_GENERATOR` | `"snappdf"` | Sélection du moteur de rendu PDF d'Invoice Ninja. |
| `SNAPPDF_EXECUTABLE_PATH` | `"/usr/local/bin/chrome"` | Chemin vers le Chromium intégré au conteneur. |
| `MAIL_FROM_NAME` | `var.mail_from_name` | Nom d'affichage de l'expéditeur des e-mails. |
| `MAIL_FROM_ADDRESS` | `var.mail_from_address` | Adresse de l'expéditeur des e-mails. |

**`APP_KEY` est injecté sous forme de référence Secret Manager** via `secret_environment_variables`, et non comme variable d'environnement en clair. Il est résolu au démarrage du pod et n'est jamais écrit dans l'état Terraform.

**Variables configurables par l'utilisateur :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en clair injectées dans le pod. À utiliser pour la configuration SMTP : `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`. Les variables essentielles sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager. À utiliser pour `MAIL_PASSWORD` et les autres valeurs sensibles. |
| `secret_rotation_period` | `"2592000s"` | Fréquence des notifications de rotation des secrets. Par défaut : 30 jours. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant le démarrage du pod. Augmentez cette valeur si les déploiements échouent avec des erreurs de secret introuvable. |

**Exemple de configuration SMTP :**

```hcl
environment_variables = {
  MAIL_MAILER   = "smtp"
  MAIL_HOST     = "smtp.mailgun.org"
  MAIL_PORT     = "587"
  MAIL_USERNAME = "postmaster@mg.example.com"
}

secret_environment_variables = {
  MAIL_PASSWORD = "invoiceninja-smtp-password-secret"
}
```

---

## Groupe 6 : Sauvegarde et maintenance {#group-6-backup--maintenance}

**Valeurs par défaut propres à Invoice Ninja :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Tous les jours à 02:00 UTC. Ajustez selon votre objectif de point de reprise (RPO). |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmentez-la nettement pour des données de facturation — de nombreuses juridictions exigent une conservation des factures de 5 à 7 ans. Minimum recommandé : 90 jours. |

**Import de sauvegarde :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Si `true`, exécute un Job Kubernetes d'import ponctuel pendant le déploiement pour restaurer la sauvegarde indiquée. |
| `backup_source` | `"gcs"` | `"gcs"` importe depuis un URI Cloud Storage ; `"gdrive"` importe depuis un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (par ex. `"gs://my-bucket/invoiceninja.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom d'un fichier de sauvegarde dans le bucket de sauvegardes GCS géré par le module. Alternative à `backup_uri`. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Variables disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`.

**Cas d'usage typique :** `container_image_source = "prebuilt"` étant la valeur par défaut, les déclencheurs CI/CD sont surtout utiles lorsque vous passez à `"custom"` pour construire une image Invoice Ninja intégrant une configuration propre à l'entreprise, des ressources de marque ou des extensions.

---

## Groupe 9 : Règles de fiabilité {#group-9-reliability-policies}

Identique à `App_GKE`.

Variables disponibles : `enable_pod_disruption_budget` (par défaut `true`), `pdb_min_available` (par défaut `"1"`), `enable_topology_spread` (par défaut `false`), `topology_spread_strict` (par défaut `false`).

> **Remarque :** avec `pdb_min_available = "1"` et un seul réplica, le PDB empêche indéfiniment les interruptions volontaires. Utilisez au moins 2 réplicas en production pour permettre une maintenance progressive.

---

## Groupe 10 : Configuration du backend GKE {#group-10-gke-backend-configuration}

**Valeurs par défaut et comportement propres à Invoice Ninja :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `service_type` | `"LoadBalancer"` | Expose Invoice Ninja via un équilibreur de charge externe GKE. |
| `workload_type` | `null` | Vaut `Deployment` par défaut. Définir `stateful_pvc_enabled = true` bascule automatiquement sur `StatefulSet`. |
| `session_affinity` | `"ClientIP"` | **Obligatoire pour Invoice Ninja.** Les sessions PHP sont stockées par pod. Sans `"ClientIP"`, les administrateurs sont déconnectés lorsque des requêtes sont acheminées vers un autre réplica. |
| `namespace_name` | `""` | Généré automatiquement à partir de `application_name` et `tenant_id` lorsqu'il est vide. |
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement un cluster géré par Services_GCP. |
| `deployment_timeout` | `1800` | Délai de déploiement progressif de 30 minutes. Invoice Ninja peut nécessiter plus de temps pour les migrations initiales sur une base de données volumineuse. |
| `enable_network_segmentation` | `false` | Définissez `true` pour créer des ressources Kubernetes NetworkPolicy limitant le trafic entre pods. |
| `termination_grace_period_seconds` | `30` | Kubernetes attend 30 secondes après SIGTERM avant de forcer SIGKILL. Portez à `60` si Invoice Ninja a besoin de temps pour terminer les requêtes de génération PDF en cours. |

---

## Groupe 11 : Jobs et tâches planifiées {#group-11-jobs--scheduled-tasks}

**Jobs d'initialisation par défaut d'Invoice Ninja :**

Lorsque `initialization_jobs` conserve sa valeur par défaut (liste vide `[]`), `InvoiceNinja Common` fournit automatiquement deux jobs :

| Job | Image | Rôle | S'exécute à chaque apply |
|---|---|---|---|
| `db-init` | `mysql:8.0-debian` | Crée la base de données et l'utilisateur MySQL avec le jeu de caractères et les privilèges corrects | Oui |
| `artisan-migrate` | `invoiceninja/invoiceninja:5` | Exécute `php artisan migrate --seed --force` pour appliquer le schéma et les données initiales | Oui |

`artisan-migrate` dépend de `db-init` et s'exécute une fois celui-ci terminé. L'exécution à chaque apply est intentionnelle — les montées de version d'Invoice Ninja incluent des migrations de base de données qui doivent être appliquées lorsque `application_version` est incrémenté.

Remplacez `initialization_jobs` par une liste non vide pour substituer des jobs personnalisés aux deux jobs par défaut.

**Les CronJobs** sont disponibles et se comportent comme décrit dans la documentation de App_GKE. Les champs des CronJobs suivent la sémantique des CronJobs Kubernetes (`restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`) plutôt que des champs de type Cloud Run.

**Les services supplémentaires** (conteneurs sidecar) sont également disponibles via `additional_services`.

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

**Valeurs par défaut des sondes propres à Invoice Ninja :**

L'initialisation de PHP-FPM, l'amorçage de Laravel et la migration de base de données au premier démarrage font d'Invoice Ninja une application lente à démarrer. Les valeurs par défaut des sondes de santé sont réglées en conséquence.

`InvoiceNinja_GKE` déclare **deux** ensembles de variables de sonde, mais un seul atteint réellement la spécification du pod Kubernetes :

- **`startup_probe` / `liveness_probe`** — ce sont ELLES qui contrôlent la véritable sonde K8s. `main.tf` fusionne inconditionnellement un objet codé en dur dans `application_config`, écrasant ce que fournit `Invoice Ninja Common` :

  | Variable | Valeur |
  |---|---|
  | `startup_probe` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` |
  | `liveness_probe` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` |

  Invoice Ninja ne dispose d'aucun point de terminaison de santé dédié ; le chemin racine `/` renvoyant HTTP 200 (une fois PHP-FPM/nginx en service) constitue le signal de disponibilité. 20 × 15 s = 300 s de tolérance supplémentaire après le délai initial de 90 s permettent d'absorber les migrations du premier démarrage.

- **`startup_probe_config` / `health_check_config`** — déclarées avec des valeurs par défaut **TCP** (leur propre description en donne la raison : le `/` d'Invoice Ninja redirige parfois en 302 vers `https://<app_url>/`, et une sonde HTTP du kubelet qui suit la redirection atteint `https://<pod-ip>:443` où rien n'écoute, provoquant un faux échec). **Cependant, l'examen du câblage montre que ces deux variables ne sont jamais lues par le chemin de sonde K8s effectif de `App_GKE` pour ce module** — l'écrasement codé en dur de `startup_probe`/`liveness_probe` ci-dessus l'emporte toujours. Considérez-les comme actuellement inopérantes pour GKE ; ne comptez pas sur leur modification pour changer le type de sonde déployé.

| Variable | Valeur par défaut |
|---|---|
| `startup_probe_config` | `{ enabled=true, type="TCP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` |
| `health_check_config` | `{ enabled=true, type="TCP", path="/", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` |

**`uptime_check_config` :** vaut par défaut `{ enabled = false, path = "/" }` — les tests de disponibilité sont **désactivés par défaut** dans la variante GKE. Activez-les explicitement pour la surveillance en production.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring depuis des emplacements de sonde mondiaux. À activer en production. |
| `alert_policies` | `[]` | Règles d'alerte personnalisées Cloud Monitoring basées sur des métriques. |

---

## Groupe 14 : Quota de ressources {#group-14-resource-quota}

Identique à `App_GKE`.

Variables disponibles : `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`, `quota_max_pvcs`.

> **Critique :** `quota_memory_requests` et `quota_memory_limits` doivent utiliser des suffixes d'unité binaires (`Gi`, `Mi`) lorsqu'ils sont définis. Kubernetes interprète les entiers nus comme des octets, ce qui empêche la planification de tous les pods.

---

## Groupe 16 : Stockage — NFS {#group-16-storage--nfs}

**Valeurs par défaut propres à Invoice Ninja :**

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut. Invoice Ninja écrit les documents téléversés, les logos clients et les PDF générés dans le système de fichiers du conteneur. Sans NFS, les fichiers sont isolés par pod et perdus au redémarrage ou à la replanification du pod. |
| `nfs_mount_path` | `"/mnt/nfs"` | Chemin du conteneur où le volume NFS est monté. |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom d'une VM GCE NFS existante. Laissez vide pour la découverte automatique. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base de la VM NFS intégrée. L'ID de déploiement y est ajouté. |

---

## Groupe 17 : Stockage — GCS {#group-17-storage--gcs}

`InvoiceNinja Common` provisionne automatiquement un bucket GCS `data` en plus des buckets définis dans `storage_buckets`. Vous n'avez pas besoin de le définir manuellement.

| Bucket | `name_suffix` | Rôle |
|---|---|---|
| Provisionné automatiquement | `data` | Stockage des documents Invoice Ninja (fichiers téléversés, logos, PDF générés) |

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Définissez `false` pour ne pas créer de bucket GCS. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` | `false` | Crée une clé KMS CMEK et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

---

## Groupe 18 : Configuration de la base de données {#group-18-database-configuration}

**Valeurs par défaut et restrictions propres à Invoice Ninja :**

| Variable | Valeur par défaut InvoiceNinja GKE | Valeur par défaut App GKE | Remarques |
|---|---|---|---|
| `database_type` | `"MYSQL_8_0"` | `"POSTGRES"` | **Invoice Ninja exige MySQL 8.0.** Ne modifiez pas — le pilote PDO d'Invoice Ninja est exclusivement MySQL. |
| `application_database_name` | `"invoiceninja"` | `"gkeappdb"` | Nom de la base de données MySQL. **Immuable après le premier déploiement** — sa modification recrée la base de données et détruit toutes les données de factures et de facturation. |
| `application_database_user` | `"invoiceninja"` | `"gkeappuser"` | Utilisateur applicatif MySQL. **Immuable après le premier déploiement.** |
| `db_name` | `"invoiceninja"` | *(absent de App GKE)* | Forme abrégée transmise à `InvoiceNinja Common` pour les jobs `db-init` et `artisan-migrate`. Doit correspondre à `application_database_name`. |
| `db_user` | `"invoiceninja"` | *(absent de App GKE)* | Forme abrégée transmise à `InvoiceNinja Common`. Doit correspondre à `application_database_user`. |
| `database_password_length` | `32` | `32` | Plage : 16 à 64 caractères. |

**Découverte de l'instance Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante. Laissez vide pour la découverte automatique. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base de l'instance Cloud SQL intégrée. L'ID de déploiement y est ajouté. |

**Rotation automatique du mot de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un CronJob et un déclencheur Eventarc pour la rotation automatisée du mot de passe. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer les pods. |

---

## Groupe 19 : Domaine personnalisé et IP statique {#group-19-custom-domain--static-ip}

Identique à `App_GKE`.

> **Remarque sur la configuration de l'URL d'Invoice Ninja :** Invoice Ninja enregistre l'URL de son application dans la base de données lors de la configuration initiale. Lorsque vous utilisez un domaine personnalisé, la variable d'environnement `APP_URL` doit être définie sur l'URL du domaine avant le premier démarrage. Définissez-la via `environment_variables` :
>
> ```hcl
> environment_variables = {
>   APP_URL = "https://invoices.example.com"
> }
> ```
>
> Invoice Ninja utilise `APP_URL` pour générer les liens des factures envoyées et des e-mails du portail client. Une URL mal configurée produit des liens cassés dans les documents destinés aux clients.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Kubernetes Ingress pour les noms d'hôte de `application_domains`. Activé par défaut. |
| `application_domains` | `[]` | Noms de domaine personnalisés. Le DNS doit pointer vers l'IP de l'équilibreur de charge après le déploiement. |
| `reserve_static_ip` | `true` | Provisionne une IP externe statique globale pour un mappage DNS stable. |
| `static_ip_name` | `""` | Nom de l'IP réservée. Généré automatiquement lorsqu'il est vide. |
| `network_tags` | `["nfsserver"]` | Tags réseau appliqués aux nœuds GKE. Le tag `nfsserver` est nécessaire aux règles de pare-feu NFS lorsque `enable_nfs = true`. |

---

## Groupe 20 : Identity-Aware Proxy (IAP) {#group-20-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, IAP exige une authentification par identité Google avant que les utilisateurs puissent accéder à Invoice Ninja. Utile pour réserver le système de facturation aux employés authentifiés.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active IAP sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service. Format : `'user:email@example.com'`. |
| `iap_authorized_groups` | `[]` | Groupes Google. Format : `'group:name@example.com'`. |
| `iap_oauth_client_id` | `""` | ID client OAuth 2.0. Obligatoire lorsque `enable_iap = true`. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth 2.0. Sensible. |
| `iap_support_email` | `""` | Adresse e-mail d'assistance affichée sur l'écran de consentement OAuth. |

---

## Groupe 21 : Cloud Armor WAF et CDN {#group-21-cloud-armor-waf--cdn}

| Variable | Valeur par défaut | Remarques |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une politique Cloud Armor WAF au backend de l'Ingress GKE. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées par les règles Cloud Armor WAF. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à associer. |
| `enable_cdn` | `false` | Achemine le trafic via la Gateway API en vue de Cloud CDN. Remarque : après le déploiement, CDN doit être activé hors bande sur le service de backend via `gcloud compute backend-services update --enable-cdn`. Cloud CDN et IAP s'excluent mutuellement sur une même Gateway. Nécessite `enable_custom_domain = true`. |

---

## Cache Redis {#redis-cache}

Redis est **obligatoire pour les déploiements Invoice Ninja en production** et il est activé par défaut. Invoice Ninja utilise Redis pour trois rôles essentiels :

- **`QUEUE_CONNECTION=redis`** — génération PDF en arrière-plan, envoi des e-mails et traitement des webhooks. Sans Redis, ces opérations bloquent le cycle de requête HTTP et provoquent des dépassements de délai sous charge concurrente.
- **`CACHE_DRIVER=redis`** — mise en cache au niveau applicatif des paramètres de l'entreprise, des données clients et des calculs de taxes.
- **`SESSION_DRIVER=redis`** — stockage des sessions. Combiné à `session_affinity = "ClientIP"`, cela permet aux sessions d'administration de survivre aux redémarrages de pods (puisque les données de session résident dans Redis, et non sur le pod).

> **Remarque :** dans `InvoiceNinja GKE`, les variables Redis se trouvent dans le **groupe 15**.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis pour la file d'attente, le cache et les sessions. **Obligatoire en production.** Ne le désactivez que dans les environnements de développement où le traitement des jobs en arrière-plan n'est pas nécessaire. |
| `redis_host` | `""` (IP du serveur NFS par défaut) | Nom d'hôte ou IP du serveur Redis. Laissez vide pour utiliser l'IP du serveur NFS découverte automatiquement. Remplacez-la par une instance Memorystore for Redis pour une fiabilité de niveau production. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Port TCP de Redis, sous forme de chaîne. |
| `redis_auth` | `""` | Mot de passe AUTH de Redis. Sensible — jamais stocké en clair dans l'état. À définir pour les instances Memorystore où AUTH est activé. |

**Vérifier la connectivité Redis :**

```bash
# List Memorystore Redis instances (if using dedicated Memorystore)
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Confirm Redis environment variables are set in the Invoice Ninja pod
kubectl exec -n NAMESPACE POD_NAME -- env | grep -iE "redis|queue|cache|session"

# Test Redis TCP connectivity from inside the pod
kubectl exec -n NAMESPACE POD_NAME -- \
  nc -zv REDIS_HOST 6379

# Check that Invoice Ninja queues are processing (look for queue worker logs)
kubectl logs -n NAMESPACE -l app=invoiceninja --tail=50 | grep -i queue
```

---

## Groupe 22 : VPC Service Controls {#group-22-vpc-service-controls}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC autour des appels aux API GCP. Nécessite un périmètre existant. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR des sous-réseaux VPC pour le niveau d'accès VPC-SC. Découvertes automatiquement lorsqu'elles sont vides. |
| `vpc_sc_dry_run` | `true` | Journalise les violations sans les bloquer. Définissez `false` pour les appliquer. |
| `organization_id` | `""` | ID de l'organisation GCP. Découvert automatiquement à partir du projet. Obligatoire pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud détaillés DATA_READ, DATA_WRITE et ADMIN_READ. |

---

## Groupe 23 : Paramètres de l'application Invoice Ninja {#group-23-invoice-ninja-application-settings}

Ces variables sont propres à Invoice Ninja et absentes de `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `invoiceninja_admin_email` | `"admin@example.com"` | Adresse e-mail de l'administrateur. Utilisée pour la connexion et les notifications système. Remplacez-la par une adresse réelle avant la mise en service. |
| `mail_from_name` | `"Invoice Ninja"` | Nom d'affichage de l'expéditeur des e-mails sortants d'Invoice Ninja (envoi de factures, confirmations de paiement, devis). |
| `mail_from_address` | `"ninja@example.com"` | Adresse e-mail utilisée comme expéditeur. Doit correspondre à un domaine d'envoi vérifié pour garantir la délivrabilité. |

---

## Charges de travail avec état {#stateful-workloads}

Pour les déploiements qui nécessitent un stockage persistant par pod en plus de NFS (par ex. lorsque chaque pod met en cache localement les PDF générés avant de les téléverser), Invoice Ninja GKE prend en charge le mode StatefulSet.

Définir `stateful_pvc_enabled = true` bascule automatiquement `workload_type` sur `"StatefulSet"`. Ne définissez pas `workload_type = "Deployment"` en même temps que `stateful_pvc_enabled = true` — cela échoue lors du plan.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles de PVC dans le StatefulSet. Sélectionne automatiquement StatefulSet lorsque `true`. |
| `stateful_pvc_size` | `"10Gi"` | Stockage par réplica de pod. Le stockage PDF temporaire d'Invoice Ninja peut croître rapidement — prévoyez 20 à 50 Gi pour les déploiements actifs. La taille d'un PVC peut être augmentée mais pas réduite. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin du conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | StorageClass Kubernetes. `"standard-rwo"` (PD équilibré, ReadWriteOnce) est la valeur par défaut de GKE Autopilot. |
| `stateful_headless_service` | `null` | Crée un Service headless pour un DNS de pod stable. À définir lorsque les pods Invoice Ninja ont besoin d'une découverte entre pairs. |
| `stateful_pod_management_policy` | `null` | `"OrderedReady"` ou `"Parallel"`. Vaut `"OrderedReady"` par défaut. |
| `stateful_update_strategy` | `null` | `"RollingUpdate"` ou `"OnDelete"`. Vaut `"RollingUpdate"` par défaut. |

---

## Sorties du module {#module-outputs}

`InvoiceNinja GKE` expose les sorties suivantes :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `service_url` | URL du service. |
| `service_external_ip` | Adresse IP externe de l'équilibreur de charge. |
| `project_id` | ID du projet GCP. |
| `deployment_id` | Suffixe de l'ID de déploiement. |
| `namespace` | Espace de noms Kubernetes. |
| `database_instance_name` | Nom de l'instance Cloud SQL MySQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Nom de l'utilisateur de la base de données de l'application. |
| `database_password_secret` | Nom du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour la CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est joignable et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — relancez l'apply pour terminer le déploiement. |

---

## Explorer avec la console GCP {#exploring-with-the-gcp-console}

**Charges de travail GKE**
- Accédez à **Kubernetes Engine** → **Workloads**.
- Filtrez sur l'espace de noms d'Invoice Ninja (généré automatiquement sous la forme `invoiceninja-<deployment-id>` lorsque `namespace_name` est vide).
- Le Deployment ou le StatefulSet `invoiceninja` affiche le nombre actuel de pods en cours d'exécution, l'état du déploiement progressif et l'image de conteneur.
- Cliquez sur le nom de la charge de travail pour voir les conditions des pods, les événements et l'utilisation des ressources. Surveillez les événements `OOMKilled` avec 2 Gi de mémoire — ils indiquent que la génération PDF par Chromium atteint les limites de mémoire.

**Services et Ingress GKE**
- Accédez à **Kubernetes Engine** → **Services & Ingress**.
- Repérez le Service `invoiceninja` (de type `LoadBalancer` par défaut). Notez l'adresse IP externe — c'est le point de terminaison public d'Invoice Ninja.
- Si `enable_custom_domain = true`, repérez la ressource Ingress et vérifiez que l'état du certificat SSL indique `ACTIVE`.

**Pods de la charge de travail GKE**
- Accédez à **Kubernetes Engine** → **Workloads** → sélectionnez la charge de travail `invoiceninja` → **Managed pods**.
- Cliquez sur un pod pour consulter ses journaux, ses variables d'environnement (non secrètes), ses montages de volumes et ses limites de ressources.
- L'onglet **Logs** diffuse les journaux d'accès PHP-FPM, les journaux de l'application Laravel et les journaux d'accès nginx. Recherchez les erreurs fatales PHP, les échecs de connexion à la file d'attente et les rapports de plantage de Chromium.

**Jobs Kubernetes (initialisation)**
- Accédez à **Kubernetes Engine** → **Jobs** (ou **Workloads** filtré sur les Jobs).
- Filtrez sur l'espace de noms d'Invoice Ninja.
- Repérez les jobs `db-init` et `artisan-migrate`. Leur état indique `Complete` après un déploiement réussi ou `Failed` si l'initialisation a rencontré une erreur.
- Cliquez sur un Job pour voir son historique d'exécution, les journaux de ses pods et ses codes de sortie. La sortie de la migration Artisan est la plus utile pour déboguer les problèmes de schéma après une montée de version.

**Cloud SQL**
- Accédez à **SQL** → sélectionnez l'instance MySQL 8.0.
- **Overview** : surveillez l'utilisation du CPU, de la mémoire et du stockage. Les fonctions de reporting d'Invoice Ninja sont intensives en lecture — surveillez les IOPS de lecture lors des exports par lots.
- **Onglet Connections** : consultez les connexions actives. Chaque pod GKE avec `enable_cloudsql_volume = true` maintient des connexions via le sidecar Auth Proxy.
- **Databases** : vérifiez que la base de données `invoiceninja` existe.
- **Operations** : consultez les opérations CREATE, ALTER et DROP récentes issues du job `artisan-migrate`.

**Secret Manager**
- Accédez à **Security** → **Secret Manager**.
- Repérez les secrets d'Invoice Ninja (préfixés par le préfixe de ressources du déploiement) :
  - Secret du mot de passe de la base de données
  - Secret du mot de passe root de la base de données
  - Secret `APP_KEY` (clé de chiffrement Laravel)
- Vérifiez que la dernière version de chaque secret est `ENABLED`. Une version `DISABLED` ou `DESTROYED` empêche les pods Invoice Ninja de démarrer, avec une erreur Kubernetes `CreateContainerConfigError`.

**Surveillance**
- Accédez à **Monitoring** → **Metrics Explorer**.
- Sélectionnez la métrique `kubernetes.io/container/memory/used_bytes` filtrée sur l'espace de noms d'Invoice Ninja. Surveillez la pression mémoire pendant la génération des PDF.
- Accédez à **Monitoring** → **Uptime checks** pour voir l'état de disponibilité (si `uptime_check_config.enabled = true`).
- Accédez à **Monitoring** → **Alerting** pour les règles d'alerte configurées.

---

## Explorer avec gcloud {#exploring-with-gcloud}

Utilisez ces commandes pour inspecter et dépanner le déploiement Invoice Ninja sur GKE. Remplacez `PROJECT_ID`, `CLUSTER_NAME`, `REGION`, `NAMESPACE` et `DEPLOYMENT_ID` par vos valeurs réelles.

**Inspecter le cluster GKE et les charges de travail**
```bash
# List GKE clusters in the project
gcloud container clusters list \
  --project=PROJECT_ID \
  --format="table(name,location,status,currentMasterVersion,currentNodeVersion)"

# Get credentials for the cluster
gcloud container clusters get-credentials CLUSTER_NAME \
  --region=REGION \
  --project=PROJECT_ID

# List all pods in the Invoice Ninja namespace
kubectl get pods -n NAMESPACE \
  -o wide \
  --sort-by='.status.startTime'

# Describe the Invoice Ninja deployment
kubectl describe deployment invoiceninja -n NAMESPACE

# View resource usage per pod
kubectl top pods -n NAMESPACE
```

**Diffuser et filtrer les journaux des pods**
```bash
# Stream Invoice Ninja application logs
kubectl logs -n NAMESPACE \
  -l app=invoiceninja \
  --tail=100 \
  --follow

# Filter for PHP errors
kubectl logs -n NAMESPACE \
  -l app=invoiceninja \
  --tail=200 | grep -iE "error|exception|fatal|warning"

# Filter for PDF generation events
kubectl logs -n NAMESPACE \
  -l app=invoiceninja \
  --tail=200 | grep -iE "pdf|snappdf|chromium|chrome"

# Filter for queue processing events
kubectl logs -n NAMESPACE \
  -l app=invoiceninja \
  --tail=200 | grep -iE "queue|job|dispatch"
```

**Inspecter les jobs d'initialisation**
```bash
# List all jobs in the namespace
kubectl get jobs -n NAMESPACE \
  -o wide \
  --sort-by='.metadata.creationTimestamp'

# Describe the artisan-migrate job
kubectl describe job artisan-migrate -n NAMESPACE

# Get logs from the artisan-migrate pod (useful for debugging migration errors)
MIGRATE_POD=$(kubectl get pods -n NAMESPACE \
  -l job-name=artisan-migrate \
  -o jsonpath='{.items[-1].metadata.name}')
kubectl logs -n NAMESPACE $MIGRATE_POD

# Get logs from db-init
DBINIT_POD=$(kubectl get pods -n NAMESPACE \
  -l job-name=db-init \
  -o jsonpath='{.items[-1].metadata.name}')
kubectl logs -n NAMESPACE $DBINIT_POD
```

**Inspecter les Services et l'Ingress Kubernetes**
```bash
# Get the external IP of the Invoice Ninja LoadBalancer service
kubectl get service -n NAMESPACE invoiceninja \
  -o jsonpath='{.status.loadBalancer.ingress[0].ip}'

# List all services in the namespace
kubectl get services -n NAMESPACE \
  -o wide

# Describe the Ingress (if custom domain is enabled)
kubectl describe ingress -n NAMESPACE

# Check TLS certificate status on the Ingress
kubectl get managedcertificate -n NAMESPACE
```

**Inspecter le Horizontal Pod Autoscaler**
```bash
# Get HPA status for Invoice Ninja
kubectl get hpa -n NAMESPACE

# Describe HPA with current metrics and scaling targets
kubectl describe hpa invoiceninja -n NAMESPACE
```

**Inspecter Cloud SQL**
```bash
# List Cloud SQL instances
gcloud sql instances list \
  --project=PROJECT_ID \
  --format="table(name,databaseVersion,state,ipAddresses[0].ipAddress)"

# Check active connections
gcloud sql instances describe INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="json(name,state,settings.ipConfiguration,serverCaCert)"

# List databases
gcloud sql databases list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID

# List users
gcloud sql users list \
  --instance=INSTANCE_NAME \
  --project=PROJECT_ID \
  --format="table(name,host,passwordPolicy.status)"
```

**Inspecter Secret Manager**
```bash
# List Invoice Ninja secrets
gcloud secrets list \
  --project=PROJECT_ID \
  --filter="name~invoiceninja" \
  --format="table(name,replication.automatic,createTime)"

# Check APP_KEY secret versions
gcloud secrets versions list APP_KEY_SECRET_NAME \
  --project=PROJECT_ID \
  --format="table(name,state,createTime)"

# Verify the secret is accessible (tests IAM permissions)
gcloud secrets versions access latest \
  --secret=APP_KEY_SECRET_NAME \
  --project=PROJECT_ID \
  --format=json | head -c 20
```

**Inspecter Memorystore Redis (si vous utilisez une instance dédiée)**
```bash
# List Redis instances
gcloud redis instances list \
  --region=REGION \
  --project=PROJECT_ID \
  --format="table(name,host,port,state,memorySizeGb,authEnabled)"

# Describe the Redis instance
gcloud redis instances describe REDIS_INSTANCE_NAME \
  --region=REGION \
  --project=PROJECT_ID

# Test Redis connectivity from inside a running pod
kubectl exec -n NAMESPACE \
  $(kubectl get pods -n NAMESPACE -l app=invoiceninja -o jsonpath='{.items[0].metadata.name}') \
  -- nc -zv REDIS_HOST 6379
```

**Inspecter le stockage GCS**
```bash
# List storage buckets for this deployment
gcloud storage ls --project=PROJECT_ID | grep invoiceninja

# List objects in the data bucket
gcloud storage ls gs://BUCKET_NAME/

# Check bucket IAM
gcloud storage buckets get-iam-policy gs://BUCKET_NAME

# View lifecycle rules
gcloud storage buckets describe gs://BUCKET_NAME \
  --format="json(lifecycle)"
```

**Vérifier la surveillance et les alertes**
```bash
# List uptime checks
gcloud monitoring uptime list-configs \
  --project=PROJECT_ID \
  --format="table(displayName,monitoredResource.labels.host,period,timeout)"

# List alert policies
gcloud alpha monitoring policies list \
  --project=PROJECT_ID \
  --format="table(displayName,enabled,conditions[0].conditionThreshold.filter)"
```

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critical** (perte de données, panne totale, faille de sécurité) — **High** (service indisponible ou dégradation importante) — **Medium** (fonctionnement dégradé ou coût accru) — **Low** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critical** | Aucune valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"MYSQL_8_0"` | **Critical** | Invoice Ninja exige exclusivement MySQL. Le définir sur `POSTGRES` fait échouer l'application au démarrage avec une erreur de pilote PDO. Le module GKE câble automatiquement les identifiants MySQL — un type de base de données incohérent casse toute l'injection d'identifiants. |
| `application_database_name` | `"invoiceninja"` | **Critical** | Immuable après le premier déploiement. Sa modification amène Terraform à recréer la base de données, ce qui détruit toutes les données de factures, de clients et de paiements. |
| `application_database_user` | `"invoiceninja"` | **Critical** | Immuable après le premier déploiement. Sa modification recrée l'utilisateur MySQL, invalide les identifiants et rompt la connexion de l'application. |
| `enable_redis` | `true` | **Critical** | Invoice Ninja EXIGE Redis pour le traitement de la file d'attente en arrière-plan. Sans Redis, la génération PDF et l'envoi des e-mails sont synchrones — ils bloquent les requêtes HTTP, provoquent des dépassements de délai côté client et échouent sous charge concurrente. L'envoi des factures devient peu fiable. |
| `redis_host` | `""` | **High** | Se résout automatiquement vers l'IP du serveur NFS. Si NFS est désactivé et qu'aucun `redis_host` explicite n'est défini, Invoice Ninja ne peut pas se connecter à son backend de file d'attente au démarrage. Les pods démarrent, mais les jobs de la file d'attente échouent silencieusement. |
| `enable_nfs` | `true` | **High** | Invoice Ninja écrit les documents téléversés, les logos clients et les données mises en cache dans le système de fichiers du conteneur. Sans NFS, le répertoire `/var/www/app/public/storage` est isolé par pod — le contenu téléversé sur un pod est invisible pour les autres et perdu au redémarrage du pod. |
| `session_affinity` | `"ClientIP"` | **High** | Invoice Ninja utilise des sessions PHP côté serveur stockées dans Redis. Sans `"ClientIP"`, les requêtes d'administration peuvent être acheminées vers un pod sans le contexte de session actif, déconnectant les utilisateurs en cours de session. Conservez toujours `"ClientIP"` pour tout déploiement à plusieurs réplicas. |
| `container_resources.memory_limit` | `"2Gi"` | **High** | En dessous de 1 Gi, Chromium est tué pour manque de mémoire (OOM) pendant la génération PDF et renvoie aux clients des PDF vides ou corrompus. Les environnements de facturation actifs avec des rendus PDF concurrents nécessitent 4 Gi. |
| `invoiceninja_admin_email` | `"admin@example.com"` | **Medium** | La valeur fictive par défaut doit être remplacée par une adresse réelle. L'administrateur ne peut ni recevoir les notifications système ni mener à bien une réinitialisation de mot de passe avec une adresse fictive. |
| `mail_from_address` | `"ninja@example.com"` | **High** | Les e-mails d'envoi de factures provenant d'un domaine non vérifié sont rejetés par les serveurs de messagerie des clients ou classés comme spam. Configurez un domaine d'expédition vérifié avant d'envoyer des factures aux clients. |
| `backup_retention_days` | `7` | **Medium** | Nettement insuffisant pour des données de facturation. De nombreuses juridictions exigent une conservation des factures de 5 à 7 ans. Portez-la à 90 jours minimum ; envisagez 365 jours ou plus pour la conformité. |
| `pdb_min_available` | `"1"` | **Medium** | Avec un seul réplica, le PDB empêche indéfiniment les interruptions volontaires — les mises à niveau de nœuds et la maintenance du cluster sont bloquées. Utilisez au moins 2 réplicas en production pour permettre une maintenance progressive. |
| `startup_probe` initial_delay_seconds | `90` | **High** | Invoice Ninja exécute l'amorçage PHP et d'éventuelles migrations au premier démarrage. Descendre en dessous de 60 amène Kubernetes à redémarrer le pod avant qu'Invoice Ninja soit prêt, créant une boucle de redémarrage avec un délai d'attente croissant. |
| `enable_cloud_armor` | `false` | **Medium** | Sans Cloud Armor, le panneau d'administration d'Invoice Ninja (`/`) n'est protégé que par l'authentification applicative. Le trafic de bots et les attaques par bourrage d'identifiants contre le formulaire de connexion sont fréquents. À activer pour tout déploiement accessible publiquement. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critical** (propre à GKE) | Doivent utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'ils sont définis. Les entiers nus sont interprétés comme des octets, ce qui empêche la planification de tous les pods et provoque une panne complète du déploiement. |
| `enable_topology_spread` | `false` | **Medium** | Sans répartition topologique, tous les réplicas peuvent se retrouver dans la même zone GKE. Une panne de zone met hors service l'ensemble du déploiement Invoice Ninja. À activer pour les déploiements de production avec `min_instance_count > 1`. |
| `APP_URL env var` | _(non défini par défaut)_ | **Medium** | Si Invoice Ninja s'initialise sans `APP_URL` correct, tous les liens des factures envoyées et des e-mails du portail client pointent vers `localhost` ou une URL incorrecte. Définissez `APP_URL` dans `environment_variables` avant le premier démarrage. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : InvoiceNinja sur GKE Autopilot](../labs/InvoiceNinja_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée InvoiceNinja Common](InvoiceNinja_Common.md) — la configuration partagée par les deux cibles de déploiement.
