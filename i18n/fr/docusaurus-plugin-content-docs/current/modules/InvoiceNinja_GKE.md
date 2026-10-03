---
title: "Module Invoice Ninja GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement d'InvoiceNinja sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/InvoiceNinja_GKE.md @ 15fd4c7 sha256:02fae268c595 -->

# Module Invoice Ninja GKE — Guide de configuration {#invoice-ninja-gke-module--configuration-guide}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/InvoiceNinja_GKE.png" alt="Module Invoice Ninja GKE — Guide de configuration" style={{maxWidth: "100%", borderRadius: "8px"}} />

Ce guide décrit toutes les variables de configuration disponibles dans le module `InvoiceNinja_GKE`. `InvoiceNinja_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique `App_GKE` avec la configuration d'application partagée `InvoiceNinja_Common` pour déployer [Invoice Ninja](https://invoiceninja.com/) — la plateforme de facturation open source — sur Google Kubernetes Engine (GKE) Autopilot.

Invoice Ninja offre une suite complète de facturation auto-hébergée : devis, factures, reçus, paiements clients, facturation récurrente, suivi des dépenses, suivi du temps, gestion de projet et un portail client en libre-service. C'est une alternative auto-hébergée à FreshBooks ou QuickBooks.

La plupart des options de configuration dans `InvoiceNinja GKE` correspondent directement aux mêmes options dans `App GKE`. Lorsqu'une variable a un comportement identique, ce guide renvoie au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Invoice Ninja** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`.

| Zone de configuration | Notes spécifiques à Ghost |
|---|---|
| Projet et identité | Identique à `App_GKE`. |
| Identité de l'application | Valeurs par défaut spécifiques à Invoice Ninja pour `application_name`, `application_display_name` et `application_version` ; voir [Groupe 3 : Identité de l'application](#group-3-application-identity). |
| Exécution et mise à l'échelle | Valeurs par défaut spécifiques à Invoice Ninja pour `container_port`, `cpu_limit`, `memory_limit` et `container_resources` ; voir [Groupe 4 : Exécution et mise à l'échelle](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | Variables `DB_CONNECTION=mysql`, `TRUSTED_PROXIES=*` et snappdf injectées automatiquement ; voir [Groupe 5 : Variables d'environnement et secrets](#group-5-environment-variables--secrets). |
| Réseau et politiques réseau | Identique à `App_GKE`. |
| Jobs d'initialisation et CronJobs | Job MySQL `db-init` et `artisan-migrate` fournis automatiquement par `InvoiceNinja Common` ; voir [Groupe 11 : Jobs et tâches planifiées](#group-11-jobs--scheduled-tasks). |
| Stockage — NFS | `enable_nfs` par défaut à `true` ; voir [Groupe 16 : Stockage — NFS](#group-16-storage--nfs). |
| Stockage — GCS | Bucket GCS `data` provisionné automatiquement ; voir [Groupe 17 : Stockage — GCS](#group-17-storage--gcs). |
| Configuration de la base de données | **MySQL 8.0 requis** ; voir [Groupe 18 : Configuration de la base de données](#group-18-database-configuration). |
| Plan de sauvegarde et rétention | Identique à `App_GKE`. |
| Scripts SQL personnalisés | Identique à `App_GKE`. |
| Observabilité et santé | Réglage de la sonde Invoice Ninja ; voir [Groupe 19 : Observabilité et santé](#group-19-observability--health). |
| Cloud Armor WAF | Identique à `App_GKE`. |
| Proxy conscient de l'identité (IAP) | Identique à `App_GKE`. |
| Autorisation binaire | Identique à `App_GKE`. |
| Contrôles de services VPC | Identique à `App_GKE`. |
| Cache Redis | Invoice Ninja **nécessite** Redis ; `enable_redis = true` par défaut ; voir [Groupe : Cache Redis](#redis-cache). |

---

## Comment InvoiceNinja GKE est lié à App GKE {#how-invoiceninja-gke-relates-to-app-gke}

`InvoiceNinja GKE` transmet toutes les variables à `App GKE` et ajoute un sous-module `InvoiceNinja Common` qui fournit les valeurs par défaut et la configuration d'application spécifiques à Invoice Ninja. Les principaux effets sont les suivants :

1.  **MySQL 8.0 est requis.** L'application Laravel d'Invoice Ninja ne prend en charge que MySQL. La valeur par défaut de `database_type` est `"MYSQL_8_0"`.
2.  **`DB_CONNECTION=mysql` est injecté automatiquement.** Laravel nécessite cette variable d'environnement pour sélectionner le pilote MySQL PDO.
3.  **`TRUSTED_PROXIES=*` est injecté automatiquement.** Sans cela, Laravel génère des liens `http://` derrière l'équilibreur de charge GKE même lorsque les clients accèdent via HTTPS, ce qui rompt les liens de facture.
4.  **Les variables de génération de PDF snappdf sont injectées.** `PDF_GENERATOR=snappdf` et `SNAPPDF_EXECUTABLE_PATH=/usr/local/bin/chrome` sont définis automatiquement. Le conteneur `invoiceninja/invoiceninja:5` embarque Chromium à ce chemin.
5.  **`APP_KEY` est auto-généré et stocké dans Secret Manager.** `InvoiceNinja Common` crée la clé de chiffrement Laravel lors du premier apply et l'injecte au moment de l'exécution. Elle n'est jamais écrite en clair dans l'état.
6.  **Un bucket GCS `data` est provisionné automatiquement.** `InvoiceNinja Common` fournit une définition de bucket `data` pour le stockage de documents.
7.  **Deux jobs d'initialisation s'exécutent lors du premier déploiement.** `db-init` crée le schéma et l'utilisateur MySQL ; `artisan-migrate` exécute les migrations Laravel, y compris les données de départ initiales. Les deux s'exécutent à chaque apply (`execute_on_apply = true`) afin que les mises à niveau de version appliquent automatiquement les modifications de schéma.
8.  **Les valeurs par défaut des ressources sont dimensionnées pour Invoice Ninja.** Les valeurs par défaut `cpu_limit` (2 vCPU) et `memory_limit` (2 Gi) tiennent compte de la génération de PDF par Chromium. 4 Gi sont recommandés pour les déploiements à fort volume.
9.  **Redis est requis et activé par défaut.** Invoice Ninja utilise Redis pour `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. Sans Redis, la génération de PDF en arrière-plan et la livraison d'e-mails bloquent le cycle de requête HTTP et échouent sous une charge concurrente.
10. **L'affinité de session est par défaut `"ClientIP"`.** Invoice Ninja utilise des sessions PHP côté serveur. Sans routage persistant, les utilisateurs administrateurs sont déconnectés lors des requêtes qui sont acheminées vers un pod différent.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | — | ID du projet GCP. **Obligatoire.** |
| `region` | `"us-central1"` | Région GCP. Utilisé comme solution de repli lorsque la découverte de réseau ne peut pas déterminer la région à partir des sous-réseaux VPC existants. |

---

## Groupe 2 : Identité de déploiement {#group-2-deployment-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `"demo"` | Court suffixe ajouté à tous les noms de ressources. |
| `support_users` | `[]` | Adresses e-mail pour les alertes de surveillance et l'accès IAM. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources provisionnées. |

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

**Valeurs par défaut spécifiques à Invoice Ninja :**

| Variable | Valeur par défaut InvoiceNinja GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"invoiceninja"` | `"gkeapp"` | Nom de base pour les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Invoice Ninja"` | `"App GKE Application"` | Affiché dans l'interface utilisateur et les tableaux de bord de la plateforme. |
| `application_description` | `"Invoice Ninja Invoicing on GKE Autopilot"` | `"App GKE Custom Application…"` | Étiquette descriptive. |
| `application_version` | `"5"` | `"1.0.0"` | La version d'Invoice Ninja à déployer. |
| `display_name` | `"Invoice Ninja"` | *(pas dans App GKE)* | Alias lisible par l'homme. |
| `description` | `"Invoice Ninja - Open-source invoicing platform on GKE Autopilot"` | *(pas dans App GKE)* | Description transmise à `InvoiceNinja Common` pour les métadonnées du job d'initialisation. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

**Valeurs par défaut et comportement spécifiques à Invoice Ninja :**

| Variable | Valeur par défaut InvoiceNinja GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `container_port` | `80` | `8080` | Invoice Ninja utilise nginx sur le port 80. Ne pas modifier sauf si votre Dockerfile personnalisé lie nginx à un port différent. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "2Gi" }` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Invoice Ninja nécessite un minimum de 2 vCPU / 2 Gi pour la génération de PDF par Chromium. |
| `cpu_limit` | `"2000m"` | — | Alias abrégé pour `container_resources.cpu_limit`. Transmis à `InvoiceNinja Common`. |
| `memory_limit` | `"2Gi"` | — | Alias abrégé pour `container_resources.memory_limit`. Minimum 2 Gi pour Chromium. |
| `min_instance_count` | `1` | `1` | Identique à la valeur par défaut de `App_GKE` — Invoice Ninja est maintenu chaud. Les démarrages à froid impliquent PHP-FPM + le démarrage de Laravel + une migration facultative. |
| `max_instance_count` | `5` | `3` | Plafond plus élevé pour les pics de traitement des factures. |
| `container_image_source` | `"prebuilt"` | `"custom"` | L'image officielle `invoiceninja/invoiceninja:5` est prête pour la production sans personnalisation. |
| `enable_cloudsql_volume` | `true` | `true` | Sidecar Cloud SQL Auth Proxy requis pour la connexion au socket Unix MySQL. |
| `session_affinity` | `"ClientIP"` | `"None"` | **Important pour Invoice Ninja.** Sans `"ClientIP"`, les utilisateurs administrateurs sont déconnectés lors des requêtes acheminées vers un pod différent car les sessions PHP ne sont pas partagées entre les réplicas. |
| `timeout_seconds` | `300` | `300` | Augmenter à `600` pour les déploiements à fort volume où la génération de PDF ou les exportations de rapports par lots peuvent prendre plus de temps. |

Les variables `deploy_application`, `container_image`, `container_build_config`, `enable_image_mirroring`, `enable_vertical_pod_autoscaling`, `container_protocol`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels` et `enable_cloudsql_volume` se comportent comme décrit dans la documentation App_GKE.

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

**Variables d'environnement auto-injectées spécifiques à Invoice Ninja :**

Les variables suivantes sont injectées automatiquement par `InvoiceNinja Common` et n'ont pas besoin d'être définies manuellement dans `environment_variables` :

| Variable | Valeur auto-injectée | Objectif |
|---|---|---|
| `APP_ENV` | `"production"` | Mode d'environnement Laravel. |
| `APP_DEBUG` | `"false"` | Désactive la sortie de débogage de Laravel. |
| `DB_CONNECTION` | `"mysql"` | Pilote de base de données Laravel. |
| `TRUSTED_PROXIES` | `"*"` | Gestion correcte de X-Forwarded-For et X-Forwarded-Proto derrière l'équilibreur de charge GKE. |
| `PDF_GENERATOR` | `"snappdf"` | Sélection du moteur de rendu PDF d'Invoice Ninja. |
| `SNAPPDF_EXECUTABLE_PATH` | `"/usr/local/bin/chrome"` | Chemin vers Chromium intégré dans le conteneur. |
| `MAIL_FROM_NAME` | `var.mail_from_name` | Nom d'affichage de l'expéditeur de l'e-mail. |
| `MAIL_FROM_ADDRESS` | `var.mail_from_address` | Adresse e-mail de l'expéditeur. |

**Le `APP_KEY` est injecté en tant que référence Secret Manager** via `secret_environment_variables`, et non en tant que variable d'environnement en clair. Il est résolu au démarrage du pod et n'est jamais écrit dans l'état Terraform.

**Variables configurables par l'utilisateur :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en texte clair injectées dans le pod. À utiliser pour la configuration SMTP : `MAIL_MAILER`, `MAIL_HOST`, `MAIL_PORT`, `MAIL_USERNAME`. Les variables principales sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager. À utiliser pour `MAIL_PASSWORD` et d'autres valeurs sensibles. |
| `secret_rotation_period` | `"2592000s"` | Fréquence de notification de rotation des secrets. Par défaut : 30 jours. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant le démarrage du pod. Augmenter si les déploiements échouent avec des erreurs de secret introuvable. |

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

**Valeurs par défaut spécifiques à Invoice Ninja :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `backup_schedule` | `"0 2 * * *"` | Quotidiennement à 02:00 UTC. Ajuster pour correspondre à votre objectif de point de récupération. |
| `backup_retention_days` | `7` | Rétention de 7 jours. Augmenter significativement pour les données de facturation — de nombreuses juridictions exigent une rétention de 5 à 7 ans des enregistrements de factures. Minimum recommandé : 90 jours. |

**Importation de sauvegarde :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_backup_import` | `false` | Lorsque `true`, exécute un job Kubernetes d'importation unique pendant le déploiement pour restaurer la sauvegarde spécifiée. |
| `backup_source` | `"gcs"` | `"gcs"` importe à partir d'un URI Cloud Storage ; `"gdrive"` importe à partir d'un ID de fichier Google Drive. |
| `backup_uri` | `""` | URI GCS complet (par exemple, `"gs://my-bucket/invoiceninja.sql"`) ou ID de fichier Google Drive. |
| `backup_file` | `"backup.sql"` | Nom de fichier d'une sauvegarde dans le bucket de sauvegardes GCS géré par le module. Alternative à `backup_uri`. |
| `backup_format` | `"sql"` | Format du fichier de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz`, `zip`, `auto`. |

---

## Groupe 7 : CI/CD et intégration GitHub {#group-7-cicd--github-integration}

Identique à `App_GKE`. Variables disponibles : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`.

**Cas d'utilisation typique :** `container_image_source = "prebuilt"` est la valeur par défaut, donc les déclencheurs CI/CD sont plus utiles lors du passage à `"custom"` pour construire une image Invoice Ninja avec une configuration spécifique à l'entreprise, des actifs de marque ou des plugins étendus intégrés dans l'image.

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

Identique à `App_GKE`.

Variables disponibles : `enable_pod_disruption_budget` (par défaut `true`), `pdb_min_available` (par défaut `"1"`), `enable_topology_spread` (par défaut `false`), `topology_spread_strict` (par défaut `false`).

> **Note :** Avec `pdb_min_available = "1"` et un seul réplica, le PDB empêche les interruptions volontaires indéfiniment. Utilisez au moins 2 réplicas en production pour permettre une maintenance continue.

---

## Groupe 10 : Configuration du backend GKE {#group-10-gke-backend-configuration}

**Valeurs par défaut et comportement spécifiques à Invoice Ninja :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `service_type` | `"LoadBalancer"` | Expose Invoice Ninja via un équilibreur de charge externe GKE. |
| `workload_type` | `null` | Par défaut à `Deployment`. La définition de `stateful_pvc_enabled = true` se résout automatiquement en `StatefulSet`. |
| `session_affinity` | `"ClientIP"` | **Requis pour Invoice Ninja.** Les sessions PHP sont stockées par pod. Sans `"ClientIP"`, les utilisateurs administrateurs sont déconnectés lors des requêtes acheminées vers un réplica différent. |
| `namespace_name` | `""` | Auto-généré à partir de `application_name` et `tenant_id` si vide. |
| `gke_cluster_name` | `""` | Laisser vide pour découvrir automatiquement un cluster géré par Services_GCP. |
| `deployment_timeout` | `1800` | Délai d'expiration de déploiement de 30 minutes. Invoice Ninja peut nécessiter un temps prolongé pour les migrations initiales de grandes bases de données. |
| `enable_network_segmentation` | `false` | Définir `true` pour créer des ressources Kubernetes NetworkPolicy limitant le trafic inter-pod. |
| `termination_grace_period_seconds` | `30` | Kubernetes attend 30 secondes après SIGTERM avant de forcer SIGKILL. Augmenter à `60` si Invoice Ninja a besoin de temps pour vider les requêtes de génération de PDF en cours. |

---

## Groupe 11 : Jobs et tâches planifiées {#group-11-jobs--scheduled-tasks}

**Jobs d'initialisation par défaut d'Invoice Ninja :**

Lorsque `initialization_jobs` est laissé par défaut (liste vide `[]`), `InvoiceNinja Common` fournit deux jobs automatiquement :

| Job | Image | Objectif | S'exécute à chaque apply |
|---|---|---|---|
| `db-init` | `mysql:8.0-debian` | Crée la base de données et l'utilisateur MySQL avec le jeu de caractères et les privilèges corrects | Oui |
| `artisan-migrate` | `invoiceninja/invoiceninja:5` | Exécute `php artisan migrate --seed --force` pour appliquer le schéma et les données de départ | Oui |

`artisan-migrate` dépend de `db-init` et s'exécute après sa complétion. L'exécution à chaque apply est intentionnelle — les mises à niveau de version d'Invoice Ninja incluent des migrations de base de données qui doivent être appliquées lorsque `application_version` est incrémenté.

Remplacez `initialization_jobs` par une liste non vide pour remplacer les deux jobs par défaut par des jobs personnalisés.

Les **CronJobs** sont disponibles et se comportent comme décrit dans la documentation App_GKE. Les champs CronJob utilisent la sémantique CronJob de Kubernetes (`restart_policy`, `concurrency_policy`, `failed_jobs_history_limit`, `successful_jobs_history_limit`, `starting_deadline_seconds`, `suspend`) plutôt que les champs de style Cloud Run.

Des **services supplémentaires** (conteneurs sidecar) sont également disponibles via `additional_services`.

---

## Groupe 13 : Observabilité et santé {#group-13-observability--health}

**Valeurs par défaut des sondes spécifiques à Invoice Ninja :**

L'initialisation de PHP-FPM d'Invoice Ninja, le démarrage de Laravel et la migration de base de données au premier démarrage en font une application à démarrage lent. Les valeurs par défaut des sondes de santé sont ajustées pour s'adapter à cela.

`InvoiceNinja_GKE` déclare **deux** ensembles de variables de sonde, mais une seule atteint réellement la spécification du pod Kubernetes :

-   **`startup_probe` / `liveness_probe`** — ce sont ELLES qui contrôlent la vraie sonde K8s. `main.tf` fusionne inconditionnellement un objet codé en dur dans `application_config`, remplaçant tout ce que `Invoice Ninja Common` fournit :

    | Variable | Valeur |
    |---|---|
    | `startup_probe` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` |
    | `liveness_probe` | `{ enabled=true, type="HTTP", path="/", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` |

    Invoice Ninja n'a pas de point de terminaison de santé dédié ; le chemin racine `/` renvoyant HTTP 200 (une fois que PHP-FPM/nginx sont en service) est le signal de disponibilité. 20 × 15s = 300s de tolérance supplémentaire après le délai initial de 90s pour les migrations au premier démarrage.

-   **`startup_probe_config` / `health_check_config`** — déclarées avec des valeurs par défaut **TCP** (leur propre description explique pourquoi : le `/` d'Invoice Ninja redirige parfois en 302 vers `https://<app_url>/`, et une sonde kubelet HTTP qui suit la redirection atteint `https://<pod-ip>:443` sans rien écouter, provoquant un faux échec). **Cependant, le traçage du câblage montre que ces deux variables ne sont jamais lues par le chemin de sonde K8s réel de `App_GKE` pour ce module** — la surcharge `startup_probe`/`liveness_probe` codée en dur ci-dessus l'emporte toujours. Considérez-les comme actuellement inertes pour GKE ; ne comptez pas sur leur modification pour altérer le type de sonde déployé.

| Variable | Valeur par défaut |
|---|---|
| `startup_probe_config` | `{ enabled=true, type="TCP", path="/", initial_delay_seconds=90, timeout_seconds=10, period_seconds=15, failure_threshold=20 }` |
| `health_check_config` | `{ enabled=true, type="TCP", path="/", initial_delay_seconds=120, timeout_seconds=10, period_seconds=30, failure_threshold=3 }` |

**`uptime_check_config` :** Par défaut à `{ enabled = false, path = "/" }` — les tests de disponibilité sont **désactivés par défaut** dans la variante GKE. Activez-les explicitement pour la surveillance de production.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring à partir des emplacements de sonde globaux. Activer pour la production. |
| `alert_policies` | `[]` | Politiques d'alerte de métriques Cloud Monitoring personnalisées. |

---

## Groupe 14 : Quota de ressources {#group-14-resource-quota}

Identique à `App_GKE`.

Variables disponibles : `enable_resource_quota`, `quota_cpu_requests`, `quota_cpu_limits`, `quota_memory_requests`, `quota_memory_limits`, `quota_max_pods`, `quota_max_services`, `quota_max_pvcs`.

> **Critique :** `quota_memory_requests` et `quota_memory_limits` doivent utiliser des suffixes d'unité binaire (`Gi`, `Mi`) lorsqu'ils sont définis. Les entiers nus sont traités comme des octets par Kubernetes et empêchent la planification de tous les pods.

---

## Groupe 16 : Stockage — NFS {#group-16-storage--nfs}

**Valeurs par défaut spécifiques à Invoice Ninja :**

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut. Invoice Ninja écrit les documents téléchargés, les logos clients et les PDF générés dans le système de fichiers du conteneur. Sans NFS, les fichiers sont isolés par pod et perdus lors du redémarrage ou de la replanification du pod. |
| `nfs_mount_path` | `"/var/www/app/public/storage"` | Chemin du conteneur où le volume NFS est monté. |
| `nfs_volume_name` | `"nfs-data-volume"` | Nom du volume Kubernetes pour le montage NFS. |
| `nfs_instance_name` | `""` | Nom d'une VM NFS GCE existante. Laisser vide pour la découverte automatique. |
| `nfs_instance_base_name` | `"app-nfs"` | Nom de base pour la VM NFS intégrée. L'ID de déploiement est ajouté. |

---

## Groupe 17 : Stockage — GCS {#group-17-storage--gcs}

`InvoiceNinja Common` provisionne automatiquement un bucket GCS `data` en plus de tous les buckets définis dans `storage_buckets`. Vous n'avez pas besoin de le définir manuellement.

| Bucket | `name_suffix` | Objectif |
|---|---|---|
| Auto-provisionné | `data` | Stockage de documents Invoice Ninja (fichiers téléchargés, logos, PDF générés) |

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Définir `false` pour ignorer la création du bucket GCS. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |
| `gcs_volumes` | `[]` | Buckets GCS à monter via le pilote CSI GCS Fuse. |
| `manage_storage_kms_iam` | `false` | Crée une clé CMEK KMS et active CMEK sur tous les buckets de stockage. |
| `enable_artifact_registry_cmek` | `false` | Crée une clé KMS Artifact Registry pour le chiffrement des images au repos. |

---

## Groupe 18 : Configuration de la base de données {#group-18-database-configuration}

**Valeurs par défaut et restrictions spécifiques à Invoice Ninja :**

| Variable | Valeur par défaut InvoiceNinja GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `database_type` | `"MYSQL_8_0"` | `"POSTGRES"` | **Invoice Ninja nécessite MySQL 8.0.** Ne pas modifier — le pilote PDO d'Invoice Ninja est uniquement MySQL. |
| `application_database_name` | `"invoiceninja"` | `"gkeappdb"` | Nom de la base de données MySQL. **Immuable après le premier déploiement** — toute modification recrée la base de données et détruit toutes les données de facture et de facturation. |
| `application_database_user` | `"invoiceninja"` | `"gkeappuser"` | Utilisateur de l'application MySQL. **Immuable après le premier déploiement.** |
| `db_name` | `"invoiceninja"` | *(pas dans App GKE)* | Raccourci transmis à `InvoiceNinja Common` pour les jobs `db-init` et `artisan-migrate`. Doit correspondre à `application_database_name`. |
| `db_user` | `"invoiceninja"` | *(pas dans App GKE)* | Raccourci transmis à `InvoiceNinja Common`. Doit correspondre à `application_database_user`. |
| `database_password_length` | `32` | `32` | Plage : 16–64 caractères. |

**Découverte d'instances Cloud SQL :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL existante. Laisser vide pour la découverte automatique. |
| `sql_instance_base_name` | `"app-sql"` | Nom de base pour l'instance Cloud SQL intégrée. L'ID de déploiement est ajouté. |

**Rotation automatique des mots de passe :**

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Déploie un CronJob et un déclencheur Eventarc pour la rotation automatisée des mots de passe. |
| `rotation_propagation_delay_sec` | `90` | Secondes à attendre après la rotation avant de redémarrer les pods. |

---

## Groupe 19 : Domaine personnalisé et IP statique {#group-19-custom-domain--static-ip}

Identique à `App_GKE`.

> **Note de configuration d'URL Invoice Ninja :** Invoice Ninja stocke son URL d'application dans la base de données lors de la configuration initiale. Lors de l'utilisation d'un domaine personnalisé, la variable d'environnement `APP_URL` doit être définie sur l'URL du domaine avant le premier démarrage. Définissez-la via `environment_variables` :
>
> ```hcl
> environment_variables = {
>   APP_URL = "https://invoices.example.com"
> }
> ```
>
> Invoice Ninja utilise `APP_URL` pour générer des liens dans les factures envoyées et les e-mails du portail client. Une configuration d'URL incorrecte entraîne des liens brisés dans les documents destinés aux clients.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une ressource Kubernetes Ingress pour les noms d'hôtes dans `application_domains`. Activé par défaut. |
| `application_domains` | `[]` | Noms de domaine personnalisés. Le DNS doit pointer vers l'IP de l'équilibreur de charge après le déploiement. |
| `reserve_static_ip` | `true` | Provisionne une IP externe statique globale pour un mappage DNS stable. |
| `static_ip_name` | `""` | Nom de l'IP réservée. Auto-généré si vide. |
| `network_tags` | `["nfsserver"]` | Balises réseau appliquées aux nœuds GKE. La balise `nfsserver` est requise pour les règles de pare-feu NFS lorsque `enable_nfs = true`. |

---

## Groupe 20 : Proxy conscient de l'identité (IAP) {#group-20-identity-aware-proxy-iap}

Lorsque `enable_iap = true`, IAP nécessite une authentification Google Identity avant que les utilisateurs puissent accéder à Invoice Ninja. Utile pour restreindre le système de facturation aux employés authentifiés.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Active IAP sur l'équilibreur de charge. |
| `iap_authorized_users` | `[]` | Utilisateurs individuels ou comptes de service. Format : `'user:email@example.com'`. |
| `iap_authorized_groups` | `[]` | Groupes Google. Format : `'group:name@example.com'`. |
| `iap_oauth_client_id` | `""` | ID client OAuth 2.0. Requis lorsque `enable_iap = true`. |
| `iap_oauth_client_secret` | `""` | Secret client OAuth 2.0. Sensible. |
| `iap_support_email` | `""` | E-mail de support affiché sur l'écran de consentement OAuth. |

---

## Groupe 21 : Cloud Armor WAF et CDN {#group-21-cloud-armor-waf--cdn}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_cloud_armor` | `false` | Attache une politique Cloud Armor WAF au backend Ingress GKE. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées par les règles Cloud Armor WAF. |
| `cloud_armor_policy_name` | `"default-waf-policy"` | Nom de la politique de sécurité Cloud Armor à attacher. |
| `enable_cdn` | `false` | Acheminer le trafic via l'API Gateway pour la préparation de Cloud CDN. Remarque : après le déploiement, le CDN doit être activé sur le service backend hors bande via `gcloud compute backend-services update --enable-cdn`. Cloud CDN et IAP sont mutuellement exclusifs sur la même passerelle. Nécessite `enable_custom_domain = true`. |

---

## Cache Redis {#redis-cache}

Redis est **requis pour les déploiements de production d'Invoice Ninja** et est activé par défaut. Invoice Ninja utilise Redis pour trois rôles critiques :

-   **`QUEUE_CONNECTION=redis`** — Génération de PDF en arrière-plan, livraison d'e-mails et traitement des webhooks. Sans Redis, ceux-ci bloquent le cycle de requête HTTP et provoquent des délais d'attente sous une charge concurrente.
-   **`CACHE_DRIVER=redis`** — Mise en cache au niveau de l'application pour les paramètres de l'entreprise, les données clients et les calculs fiscaux.
-   **`SESSION_DRIVER=redis`** — Stockage de session. Combiné avec `session_affinity = "ClientIP"`, cela permet aux sessions administrateur de survivre aux redémarrages de pods (car les données de session résident dans Redis, et non sur le pod).

> **Note :** Dans `InvoiceNinja GKE`, les variables Redis se trouvent dans le **groupe 15**.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Active Redis pour la file d'attente, le cache et la session. **Requis pour la production.** Désactiver uniquement dans les environnements de développement où le traitement des jobs en arrière-plan n'est pas nécessaire. |
| `redis_host` | `""` (par défaut à l'IP du serveur NFS) | Nom d'hôte ou IP du serveur Redis. Laisser vide pour utiliser l'IP du serveur NFS découverte automatiquement. Remplacer par une instance Memorystore for Redis pour une fiabilité de production. Exemple : `"10.128.0.10"`. |
| `redis_port` | `"6379"` | Chaîne de port TCP Redis. |
| `redis_auth` | `""` | Mot de passe Redis AUTH. Sensible — jamais stocké en clair dans l'état. Définir pour les instances Memorystore avec AUTH activé. |

**Validation de la connectivité Redis :**

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

## Groupe 22 : Contrôles de services VPC {#group-22-vpc-service-controls}

Identique à `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC autour des appels d'API GCP. Nécessite un périmètre existant. |
| `vpc_cidr_ranges` | `[]` | Plages CIDR du sous-réseau VPC pour le niveau d'accès VPC-SC. Auto-découvert si vide. |
| `vpc_sc_dry_run` | `true` | Enregistre les violations sans bloquer. Définir `false` pour appliquer. |
| `organization_id` | `""` | ID de l'organisation GCP. Auto-découvert à partir du projet. Requis pour les projets imbriqués dans des dossiers. |
| `enable_audit_logging` | `false` | Active les journaux d'audit Cloud détaillés DATA_READ, DATA_WRITE et ADMIN_READ. |

---

## Groupe 23 : Paramètres d'application Invoice Ninja {#group-23-invoice-ninja-application-settings}

Ces variables sont spécifiques à Invoice Ninja et ne sont pas présentes dans `App_GKE`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `invoiceninja_admin_email` | `"admin@example.com"` | Adresse e-mail de l'administrateur. Utilisée pour la connexion et les notifications système. Changer pour une adresse réelle avant la mise en production. |
| `mail_from_name` | `"Invoice Ninja"` | Nom d'affichage montré comme expéditeur sur les e-mails sortants d'Invoice Ninja (livraison de facture, confirmations de paiement, devis). |
| `mail_from_address` | `"ninja@example.com"` | Adresse e-mail utilisée comme expéditeur. Doit correspondre à un domaine d'envoi vérifié pour la délivrabilité. |

---

## Charges de travail avec état {#stateful-workloads}

Pour les déploiements où un stockage persistant par pod est requis en plus de NFS (par exemple, chaque pod met en cache les PDF générés localement avant de les télécharger), Invoice Ninja GKE prend en charge le mode StatefulSet.

La définition de `stateful_pvc_enabled = true` résout automatiquement `workload_type` en `"StatefulSet"`. Ne pas définir `workload_type = "Deployment"` en même temps que `stateful_pvc_enabled = true` — cela échoue au moment de la planification.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Active les modèles PVC dans le StatefulSet. Sélectionne automatiquement StatefulSet lorsque `true`. |
| `stateful_pvc_size` | `"10Gi"` | Stockage par réplica de pod. Le stockage temporaire de PDF d'Invoice Ninja peut augmenter rapidement — provisionner 20–50 Gi pour les déploiements actifs. La taille du PVC peut être étendue mais pas réduite. |
| `stateful_pvc_mount_path` | `"/data"` | Chemin du conteneur pour le PVC par pod. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | Kubernetes StorageClass. `"standard-rwo"` (PD équilibré, ReadWriteOnce) est la valeur par défaut de GKE Autopilot. |
| `stateful_headless_service` | `null` | Crée un service sans tête pour un DNS de pod stable. Définir lorsque les pods Invoice Ninja nécessitent une découverte de pairs. |
| `stateful_pod_management_policy` | `null` | `"OrderedReady"` ou `"Parallel"`. Par défaut à `"OrderedReady"`. |
| `stateful_update_strategy` | `null` | `"RollingUpdate"` ou `"OnDelete"`. Par défaut à `"RollingUpdate"`. |

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
| `database_password_secret` | Nom du secret Secret Manager pour le mot de passe de la base de données. |
| `storage_buckets` | Buckets de stockage GCS créés. |
| `container_image` | Image de conteneur utilisée pour le déploiement. |
| `cicd_enabled` | Indique si le pipeline CI/CD est activé. |
| `github_repository_url` | URL du dépôt GitHub connecté pour le CI/CD. |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster GKE est accessible et que toutes les ressources Kubernetes sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — réexécuter apply pour terminer le déploiement. |

---

## Exploration avec la console GCP {#exploring-with-the-gcp-console}

**Charges de travail GKE**
- Accédez à **Kubernetes Engine** → **Charges de travail**.
- Filtrez par l'espace de noms Invoice Ninja (auto-généré comme `invoiceninja-<deployment-id>` lorsque `namespace_name` est vide).
- Le déploiement ou le StatefulSet pour `invoiceninja` affiche le nombre actuel de pods en cours d'exécution, l'état du déploiement et l'image du conteneur.
- Cliquez sur le nom de la charge de travail pour voir les conditions des pods, les événements et l'utilisation des ressources. Surveillez les événements `OOMKilled` sous 2 Gi de mémoire — ils indiquent que la génération de PDF par Chromium atteint les limites de mémoire.

**Services et Ingress GKE**
- Accédez à **Kubernetes Engine** → **Services et Ingress**.
- Trouvez le service `invoiceninja` (type `LoadBalancer` par défaut). Notez l'adresse IP externe — c'est le point de terminaison public d'Invoice Ninja.
- Si `enable_custom_domain = true`, trouvez la ressource Ingress et vérifiez que l'état du certificat SSL affiche `ACTIVE`.

**Pods de charge de travail GKE**
- Accédez à **Kubernetes Engine** → **Charges de travail** → sélectionnez la charge de travail `invoiceninja` → **Pods gérés**.
- Cliquez sur n'importe quel pod pour afficher ses journaux, ses variables d'environnement (non secrètes), ses montages de volume et ses limites de ressources.
- L'onglet **Journaux** diffuse les journaux d'accès PHP-FPM, les journaux d'application Laravel et les journaux d'accès nginx. Recherchez les erreurs fatales PHP, les échecs de connexion à la file d'attente et les rapports de plantage de Chromium.

**Jobs Kubernetes (Initialisation)**
- Accédez à **Kubernetes Engine** → **Jobs** (ou **Charges de travail** filtrées sur Jobs).
- Filtrez par l'espace de noms Invoice Ninja.
- Trouvez les jobs `db-init` et `artisan-migrate`. Leur statut affiche `Complete` après un déploiement réussi ou `Failed` si l'initialisation a rencontré une erreur.
- Cliquez sur un Job pour voir son historique d'exécution, les journaux des pods et les codes de sortie. La sortie de migration Artisan est la plus utile pour déboguer les problèmes liés au schéma après les mises à niveau de version.

**Cloud SQL**
- Accédez à **SQL** → sélectionnez l'instance MySQL 8.0.
- **Vue d'ensemble** : surveillez l'utilisation du CPU, de la mémoire et du stockage. Les fonctionnalités de reporting d'Invoice Ninja sont gourmandes en lecture — surveillez les IOPS de lecture sous une charge d'exportation par lots.
- **Onglet Connexions** : affichez les connexions actives. Chaque pod GKE avec `enable_cloudsql_volume = true` maintient des connexions via le sidecar Auth Proxy.
- **Bases de données** : vérifiez que la base de données `invoiceninja` existe.
- **Opérations** : affichez les opérations CREATE, ALTER et DROP récentes du job `artisan-migrate`.

**Secret Manager**
- Accédez à **Sécurité** → **Secret Manager**.
- Trouvez les secrets Invoice Ninja (préfixés par le préfixe de ressource de déploiement) :
  - Secret du mot de passe de la base de données
  - Secret du mot de passe root de la base de données
  - Secret `APP_KEY` (clé de chiffrement Laravel)
- Vérifiez que tous les secrets ont une dernière version `ENABLED`. Une version `DISABLED` ou `DESTROYED` entraîne l'échec du démarrage des pods Invoice Ninja avec une erreur Kubernetes `CreateContainerConfigError`.

**Surveillance**
- Accédez à **Surveillance** → **Explorateur de métriques**.
- Sélectionnez la métrique `kubernetes.io/container/memory/used_bytes` filtrée sur l'espace de noms Invoice Ninja. Surveillez la pression mémoire pendant la génération de PDF.
- Accédez à **Surveillance** → **Tests de disponibilité** pour voir l'état de disponibilité (si `uptime_check_config.enabled = true`).
- Accédez à **Surveillance** → **Alertes** pour les politiques d'alerte configurées.

---

## Explorer avec gcloud {#exploring-with-gcloud}

Utilisez ces commandes pour inspecter et dépanner le déploiement d'Invoice Ninja sur GKE. Remplacez `PROJECT_ID`, `CLUSTER_NAME`, `REGION`, `NAMESPACE` et `DEPLOYMENT_ID` par vos valeurs réelles.

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

**Diffuser et filtrer les logs des pods**
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

**Inspecter les services et l'Ingress Kubernetes**
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

> Niveaux de risque : **Critique** (perte de données, panne totale, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| `database_type` | `"MYSQL_8_0"` | **Critique** | Invoice Ninja requiert exclusivement MySQL. La définition de `POSTGRES` entraîne l'échec de l'application au démarrage avec une erreur de pilote PDO. Le module GKE connecte automatiquement les identifiants MySQL — un type de base de données incompatible interrompt toute injection d'identifiants. |
| `application_database_name` | `"invoiceninja"` | **Critique** | Immuable après le premier déploiement. La modification de cette valeur entraîne la recréation de la base de données par Terraform, détruisant toutes les données de facture, de client et de paiement. |
| `application_database_user` | `"invoiceninja"` | **Critique** | Immuable après le premier déploiement. La modification de cette valeur recrée l'utilisateur MySQL, invalide les identifiants et interrompt la connexion de l'application. |
| `enable_redis` | `true` | **Critique** | Invoice Ninja REQUIERT Redis pour le traitement des files d'attente en arrière-plan. Sans Redis, la génération de PDF et la livraison d'e-mails sont synchrones — elles bloquent les requêtes HTTP, provoquent des délais d'attente côté client et échouent sous une charge concurrente. La livraison des factures devient peu fiable. |
| `redis_host` | `""` | **Élevé** | Se résout automatiquement à l'adresse IP du serveur NFS. Si NFS est désactivé et qu'aucun `redis_host` explicite n'est défini, Invoice Ninja ne peut pas se connecter à son backend de file d'attente au démarrage. Les pods démarrent mais les jobs de file d'attente échouent silencieusement. |
| `enable_nfs` | `true` | **Élevé** | Invoice Ninja écrit les documents téléchargés, les logos des clients et les données mises en cache dans le système de fichiers du conteneur. Sans NFS, le répertoire `/var/www/app/public/storage` est isolé par pod — le contenu téléchargé vers un pod est invisible pour les autres et perdu lors du redémarrage du pod. |
| `session_affinity` | `"ClientIP"` | **Élevé** | Invoice Ninja utilise des sessions PHP côté serveur stockées dans Redis. Sans `"ClientIP"`, les requêtes d'administration peuvent être acheminées vers un pod sans le contexte de session actif, déconnectant les utilisateurs en cours de session. Gardez toujours `"ClientIP"` pour tout déploiement multi-réplica. |
| `container_resources.memory_limit` | `"2Gi"` | **Élevé** | En dessous de 1 Gi, Chromium tue les processus OOM pendant la génération de PDF, renvoyant des PDF vierges ou corrompus aux clients. Les environnements de facturation actifs avec des rendus PDF concurrents nécessitent 4 Gi. |
| `invoiceninja_admin_email` | `"admin@example.com"` | **Moyen** | L'espace réservé par défaut doit être remplacé par une adresse réelle. L'administrateur ne peut pas recevoir de notifications système ni effectuer de réinitialisations de mot de passe avec un e-mail d'espace réservé. |
| `mail_from_address` | `"ninja@example.com"` | **Élevé** | Les e-mails de livraison de factures provenant d'un domaine non vérifié sont rejetés par les serveurs de messagerie des clients ou marqués comme spam. Configurez un domaine d'expéditeur vérifié avant d'envoyer des factures aux clients. |
| `backup_retention_days` | `7` | **Moyen** | Gravement insuffisant pour les données de facturation. De nombreuses juridictions exigent une conservation de 5 à 7 ans des enregistrements de factures. Augmentez à un minimum de 90 jours ; envisagez 365 jours ou plus pour la conformité. |
| `pdb_min_available` | `"1"` | **Moyen** | Avec un seul réplica, le PDB empêche indéfiniment les interruptions volontaires — les mises à niveau de nœuds et la maintenance du cluster sont bloquées. Utilisez au moins 2 réplicas en production pour permettre une maintenance progressive. |
| `startup_probe` initial_delay_seconds | `90` | **Élevé** | Invoice Ninja exécute le bootstrap PHP + des migrations optionnelles au premier démarrage. Une réduction en dessous de 60 secondes entraîne le redémarrage du pod par Kubernetes avant qu'Invoice Ninja ne soit prêt, créant une boucle de redémarrage avec un backoff croissant. |
| `enable_cloud_armor` | `false` | **Moyen** | Sans Cloud Armor, le panneau d'administration d'Invoice Ninja (`/`) est protégé uniquement par une authentification au niveau de l'application. Le trafic de bots et les attaques par bourrage d'identifiants contre le formulaire de connexion sont courants. Activez-le pour tout déploiement accessible publiquement. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Critique** (spécifique à GKE) | Doit utiliser des suffixes binaires (`Gi`, `Mi`) lorsqu'il est défini. Les entiers bruts sont traités comme des octets, empêchant la planification de tous les pods et provoquant une panne complète du déploiement. |
| `enable_topology_spread` | `false` | **Moyen** | Sans répartition topologique, tous les réplicas peuvent se retrouver dans la même zone GKE. Une défaillance de zone entraîne la panne de l'ensemble du déploiement d'Invoice Ninja. Activez-le pour les déploiements de production avec `min_instance_count > 1`. |
| `APP_URL env var` | _(non défini par défaut)_ | **Moyen** | Si Invoice Ninja s'initialise sans un `APP_URL` correct, tous les liens dans les factures envoyées et les e-mails du portail client feront référence à `localhost` ou à une URL incorrecte. Définissez `APP_URL` dans `environment_variables` avant le premier démarrage. |

## Guides associés {#related-guides}

- [Lab pratique : InvoiceNinja sur GKE Autopilot](../labs/InvoiceNinja_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Module de configuration partagée commune InvoiceNinja](InvoiceNinja_Common.md) — la configuration partagée par les deux cibles de déploiement.
