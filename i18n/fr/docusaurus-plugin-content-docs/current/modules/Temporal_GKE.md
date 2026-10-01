---
title: "Temporal sur GKE Autopilot"
description: "Référence de configuration pour déployer Temporal sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Temporal_GKE.md @ 3055034 sha256:466c23891951 -->

# Temporal sur GKE Autopilot {#temporal-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Temporal_GKE.png" alt="Temporal sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Temporal est un moteur open source d'orchestration de workflows utilisé par des organisations
telles que Stripe, Netflix, Coinbase et HashiCorp pour construire des applications distribuées
fiables. Ce module déploie Temporal sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Temporal et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Temporal s'exécute comme une application Go à l'aide de l'image officielle tout-en-un `temporalio/auto-setup`,
qui démarre les quatre services Temporal — Frontend, History,
Matching et Worker — dans un seul pod et gère automatiquement l'initialisation du schéma PostgreSQL
au premier démarrage. Le déploiement assemble un ensemble ciblé de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod tout-en-un, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL | Deux bases : persistance principale + visibilité ; accès par IP privée, sans sidecar Auth Proxy |
| Secrets | Secret Manager | Mot de passe de base de données généré automatiquement |
| Ingress | Cloud Load Balancing | ClusterIP (interne) par défaut ; LoadBalancer pour les workers SDK externes |
| Visibilité avancée | Elasticsearch (facultatif) | Recherche plein texte des workflows et attributs de recherche personnalisés |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est la seule base de données prise en charge.** L'architecture de Temporal exige
  PostgreSQL ; MySQL n'est pas utilisé. L'image `auto-setup` se connecte directement via
  l'IP privée de Cloud SQL — aucun sidecar Auth Proxy n'est déployé.
- **Les quatre services Temporal s'exécutent dans un seul pod.** Frontend (gRPC sur le port 7233),
  History, Matching et Worker partagent la même allocation de CPU et de mémoire.
- **L'initialisation du schéma est automatique.** `temporalio/auto-setup` crée les deux
  bases de données et exécute les migrations de schéma au premier démarrage. Aucun job d'initialisation distinct n'est
  nécessaire. Une sonde de démarrage TCP généreuse (délai initial de 30 s, seuil de 10 échecs avec
  une période de 30 s — soit une fenêtre de 5 minutes) laisse le temps au provisionnement des nœuds Autopilot et à
  la configuration du schéma.
- **`num_history_shards` est définitivement immuable.** Cette valeur est inscrite dans le
  schéma de la base de données lors du premier déploiement et ne peut pas être modifiée sans effacer et
  réinitialiser toutes les données de workflow. La valeur par défaut est `4` (dev/démo) ; utilisez `512` ou plus
  en production.
- **`service_type` vaut `ClusterIP` par défaut.** Les workers SDK se connectent via le réseau du
  cluster. Passez à `LoadBalancer` uniquement si les workers SDK s'exécutent hors du cluster.
- **Elasticsearch est facultatif.** Sans lui, la recherche standard de workflows s'appuie sur
  la base de visibilité PostgreSQL. Activer Elasticsearch ajoute la recherche plein texte et
  les attributs de recherche personnalisés, mais exige un cluster Elasticsearch 7.x ou 8.x joignable.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Temporal {#a-gke-autopilot--the-temporal-workload}

Les pods Temporal sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods. Le déploiement exécute l'image `temporalio/auto-setup`, qui
lance les quatre services Temporal dans un seul conteneur.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Temporal pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche le
  Service.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de
charge de travail sont gérés.

### B. Cloud SQL for PostgreSQL {#b-cloud-sql-for-postgresql}

Temporal stocke tout l'état d'exécution des workflows dans une instance gérée Cloud SQL for PostgreSQL.
Deux bases de données sont créées :

- **Base de données de persistance principale** — état des workflows, files de tâches, métadonnées des namespaces,
  minuteurs et enregistrements d'activités.
- **Base de données de visibilité** — enregistrements des exécutions de workflows en cours, utilisés pour la recherche et
  le filtrage dans la Temporal Web UI et via `tctl`.

Le serveur Temporal se connecte à Cloud SQL directement via l'**IP privée** (sans sidecar Auth
Proxy). TLS est exigé par Cloud SQL et activé automatiquement dans la configuration
de Temporal.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive session to inspect schemas and data:
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, les noms des bases de données, l'utilisateur et le secret Secret Manager du
mot de passe sont tous exposés dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Le mot de passe de la base de données Temporal est généré automatiquement et stocké sous forme de secret Secret
Manager injecté dans le pod à l'exécution ; il n'est jamais exposé en clair.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret figure dans les [sorties](#5-outputs) sous `temporal_db_password_secret_id`.
Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le service gRPC Frontend de Temporal est un `ClusterIP` et n'est joignable
que depuis l'intérieur du cluster sur le port **7233**. Les workers SDK déployés sur le même cluster
GKE se connectent directement à l'aide de la sortie `temporal_frontend_address`.

Pour exposer Temporal à l'extérieur, définissez `service_type = "LoadBalancer"` et, si vous le souhaitez,
`reserve_static_ip = true` pour une adresse stable. Un domaine personnalisé avec un
certificat géré par Google peut également être activé.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services →
  Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, le CDN et les IP
statiques.

### E. Elasticsearch (facultatif — visibilité avancée) {#e-elasticsearch-optional--advanced-visibility}

Lorsque `enable_elasticsearch = true`, Temporal remplace la base de visibilité PostgreSQL
par Elasticsearch comme magasin de visibilité avancé, ce qui permet la recherche plein texte
des workflows et les attributs de recherche personnalisés. L'image `temporalio/auto-setup`
crée automatiquement l'index de visibilité (`temporal_visibility_v1` par défaut) au premier
démarrage.

- **Console :** si vous utilisez Elasticsearch_GKE, Kubernetes Engine → Workloads.
- **CLI :**
  ```bash
  # Check Elasticsearch cluster health (from within the cluster):
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    curl -s http://<es-host>:9200/_cluster/health | python3 -m json.tool
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL à Cloud
Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Temporal {#3-temporal-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `Temporal_GKE` code en dur `initialization_jobs = []`
  — aucun Job Kubernetes ne s'exécute avant le démarrage du pod du serveur. Le rôle PostgreSQL de Temporal
  et les deux bases de données sont créés directement par les ressources Terraform
  `google_sql_user`/`google_sql_database` de `Temporal_Common`, via la Cloud SQL Admin
  API. L'image `temporalio/auto-setup` exécute ensuite elle-même toutes les migrations de schéma lors de son
  premier démarrage (consultez le §6 de [Temporal_Common](Temporal_Common.md) pour le détail complet,
  y compris les scripts d'initialisation `temporal-db-init.sh` et `schema-init.sh` qui
  sont livrés avec les modules mais ne sont actuellement reliés à aucun Job).
- **Initialisation du schéma à chaque démarrage.** `auto-setup` détecte la version actuelle du schéma
  au démarrage. Si le schéma est déjà à jour, le démarrage se poursuit
  immédiatement. S'il existe des migrations en attente, elles sont appliquées avant que les services Temporal
  ne commencent à accepter des connexions.
- **Mise à niveau de Temporal.** Remplacez `application_version` par le tag cible. L'image
  `auto-setup` applique automatiquement les migrations de schéma en attente au démarrage suivant.
  Pour les déploiements de grande taille, consultez les
  [notes de version de Temporal](https://github.com/temporalio/temporal/releases) pour repérer
  les changements de schéma incompatibles avant la mise à jour.
- **Temporal Web UI.** Déployée automatiquement par défaut. `deploy_temporal_ui`
  vaut `true` par défaut, et `temporal.tf` construit automatiquement un service `temporalio/ui` pointant
  vers le service Frontend sur le port 7233, exposé via un LoadBalancer externe et
  placé avant tout `additional_services` fourni par l'appelant. Définissez
  `deploy_temporal_ui = false` pour la désactiver ; utilisez `additional_services` pour tout
  autre service compagnon.
- **Namespaces Temporal.** Temporal utilise son propre concept interne de namespace (distinct
  des espaces de noms Kubernetes). Le namespace Temporal `default` est créé
  automatiquement par `auto-setup`. Des namespaces supplémentaires peuvent être créés avec :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    temporal operator namespace create my-namespace
  ```
- **Connexion des workers SDK.** Les workers SDK se connectent à l'adresse gRPC du Frontend de
  Temporal. Utilisez directement la sortie `temporal_frontend_address` pour les workers situés dans le
  cluster. Pour les workers hors du cluster, définissez `service_type = "LoadBalancer"` et
  utilisez `service_external_ip:7233`.
- **Sondes de santé.** Des sondes TCP sont utilisées pour les vérifications de démarrage et de vivacité, car
  le Frontend de Temporal expose du gRPC (et non du HTTP/1.1) sur le port 7233. La sonde de démarrage
  accorde jusqu'à 5 minutes (10 tentatives × période de 30 secondes) pour que l'initialisation du schéma
  se termine.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à Temporal ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `temporal` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Temporal` | Nom convivial affiché dans la console. |
| `application_description` | _(défini)_ | Annotation de description de la charge de travail. |
| `application_version` | `1.25.0` | Tag de l'image du serveur Temporal. Épinglez une version précise ; les migrations de schéma doivent être terminées avant toute mise à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner les bases de données et les secrets sans déployer de pods. |
| `cpu_limit` | `2000m` | CPU par pod ; les quatre services Temporal partagent cette allocation. |
| `memory_limit` | `4Gi` | Mémoire par pod ; les quatre services partagent cette allocation. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. Doit être ≥ 1 — Temporal exige au moins un pod en cours d'exécution pour traiter les minuteurs et les nouvelles tentatives. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. |
| `container_port` | `7233` | Port gRPC du Frontend de Temporal (à titre informatif — le port du service est codé en dur à 7233). |
| `container_protocol` | `h2c` | HTTP/2 en clair — obligatoire pour gRPC. Ne le modifiez pas. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Temporal depuis Docker Hub dans Artifact Registry. |
| `enable_vertical_pod_autoscaling` | `false` | Laisse Autopilot ajuster automatiquement les demandes de ressources. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets fusionnés avec la configuration du serveur Temporal. Remplacez les valeurs par défaut intégrées avec prudence. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | Utilisez `ClusterIP` pour les workers SDK internes au cluster (recommandé). Utilisez `LoadBalancer` uniquement si les workers SDK s'exécutent hors du cluster. |
| `workload_type` | `null` (Deployment) | Temporal est sans état — `Deployment` convient. |
| `session_affinity` | `None` | Aucun routage persistant n'est nécessaire pour gRPC. |
| `gke_cluster_name` | `""` | Nom du cluster cible. Laissez vide pour la découverte automatique. |
| `namespace_name` | `""` | Espace de noms Kubernetes. Laissez vide pour une génération automatique. |
| `enable_network_segmentation` | `false` | Crée des ressources NetworkPolicy pour restreindre le trafic. |
| `deployment_timeout` | `600` | Nombre de secondes pendant lesquelles Terraform attend le déploiement progressif. La valeur par défaut couvre le provisionnement des nœuds Autopilot ainsi que l'initialisation du schéma au premier déploiement. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non requis pour Temporal. Tout l'état durable réside dans Cloud SQL PostgreSQL. Définir
`stateful_pvc_enabled = true` n'est pas recommandé — consultez
[App_GKE](App_GKE.md) pour les options de PVC.

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Plafonne le CPU, la mémoire et le nombre d'objets de l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | **Doivent utiliser des unités binaires (`4Gi`, `8192Mi`)** — les entiers nus sont lus comme des octets et bloquent toute planification. |
| `quota_max_pods` | `20` | Nombre maximal de pods dans l'espace de noms. |
| `quota_max_services` | `10` | Nombre maximal de Services dans l'espace de noms. |
| `quota_max_pvcs` | `5` | Nombre maximal de PVC dans l'espace de noms. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds (recommandé en production). |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions. |
| `enable_topology_spread` | `false` | Répartit les pods entre les zones. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP sur le port 7233 | Fenêtre de 10 tentatives (5 minutes avec une période de 30 s) pour l'initialisation du schéma au premier démarrage. |
| `health_check_config` | TCP sur le port 7233 | Sonde de vivacité ; délai initial de 60 s. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte sur métriques facultatives. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Jobs supplémentaires à exécuter avant le pod du serveur. Codé en dur à `[]` par `Temporal_GKE` — aucun Job intégré ne s'exécute ; le rôle de base de données et les bases sont créés directement par les ressources Terraform de `Temporal_Common`. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `deploy_temporal_ui` | `true` | Déploie automatiquement la Temporal Web UI (`temporalio/ui`), reliée au service Frontend et exposée via un LoadBalancer externe. |
| `temporal_ui_version` | `2.34.0` | Tag de l'image de la Temporal Web UI. |
| `additional_services` | `[]` | Services GKE sidecar ou auxiliaires. Fusionnés avec la Temporal Web UI déployée automatiquement (contrôlée par `deploy_temporal_ui`). |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

NFS n'est pas requis pour Temporal. Consultez [App_GKE](App_GKE.md) pour les options NFS
si elles sont nécessaires à des charges de travail compagnes.

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

Temporal ne nécessite aucun bucket Cloud Storage. Artifact Registry est utilisé pour l'image
Temporal mise en miroir. Consultez [App_GKE](App_GKE.md).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Désactivé par défaut — Temporal n'utilise pas GCS. |
| `max_images_to_retain` | `7` | Nombre d'images conservées dans Artifact Registry. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Base de données et paramètres propres à Temporal {#group-15--database--temporal-specific-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `sql_instance_name` | `""` | Nom d'une instance Cloud SQL PostgreSQL existante. Laissez vide pour la découverte automatique depuis Services_GCP. |
| `temporal_database_name` | `""` | Nom de la base de données de persistance principale. Laissez vide pour une génération automatique à partir du préfixe de ressources du déploiement (recommandé). |
| `temporal_visibility_database_name` | `""` | Nom de la base de données de visibilité. Laissez vide pour une génération automatique sous la forme `<prefix>_visibility`. |
| `temporal_db_user` | `""` | Nom d'utilisateur PostgreSQL. Laissez vide pour une génération automatique à partir du préfixe de ressources du déploiement. |
| `num_history_shards` | `4` | **Immuable après le premier déploiement.** Nombre de shards d'historique (puissance de deux). Utilisez `4` pour le dev/la démo, `512` ou plus en production. |
| `enable_elasticsearch` | `false` | Active Elasticsearch pour la visibilité avancée (recherche plein texte, attributs de recherche personnalisés). |
| `elasticsearch_url` | `""` | Point de terminaison Elasticsearch. Obligatoire lorsque `enable_elasticsearch = true`. Format : `host:9200` ou `http://host:9200`. |
| `elasticsearch_version` | `v7` | Doit correspondre à la version réelle du cluster : `v7` pour Elasticsearch 7.x, `v8` pour 8.x. |
| `elasticsearch_index_visibility` | `temporal_visibility_v1` | Nom de l'index Elasticsearch. Créé automatiquement par `auto-setup` au premier démarrage. |

### Groupe 16 — Rotation des secrets {#group-16--secret-rotation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_auto_password_rotation` | `false` | Fait tourner le mot de passe de la base de données selon un calendrier. Le pod doit être redémarré après la rotation pour prendre en compte le nouveau secret. |
| `rotation_propagation_delay_sec` | `90` | Nombre de secondes d'attente après la rotation avant de redémarrer les pods. |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron des sauvegardes automatiques (UTC). |
| `backup_retention_days` | `7` | Rétention ; portez-la à 30–90 en production ou pour la conformité. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

Sans objet pour Temporal. Consultez [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre (utile uniquement avec `LoadBalancer`). |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | IAP n'est pas recommandé pour le gRPC de Temporal — utilisez plutôt `enable_network_segmentation`. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsque IAP est activé (sensibles). |
| `iap_support_email` | `""` | Affiché sur l'écran de consentement OAuth. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |
| `cloud_armor_policy_name` | _(défini)_ | Nom de la règle. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Impose un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | Plages CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes du serveur Temporal. |
| `namespace` | Espace de noms Kubernetes dans lequel Temporal est déployé. |
| `service_url` | URL du service interne au cluster (ClusterIP par défaut). |
| `service_external_ip` | IP externe du LoadBalancer (non nulle uniquement lorsque `service_type = "LoadBalancer"`). |
| `temporal_frontend_address` | Adresse gRPC pour les workers SDK — `<service-url>:7233`. |
| `temporal_db_user` | Nom d'utilisateur PostgreSQL pour les connexions du serveur Temporal. |
| `temporal_db_name` | Nom de la base de données de persistance principale. |
| `temporal_visibility_db_name` | Nom de la base de données de visibilité. |
| `temporal_db_password_secret_id` | ID du secret Secret Manager contenant le mot de passe de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Temporal n'utilise pas GCS). |
| `container_image` | Image de conteneur utilisée pour le déploiement du serveur Temporal. |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si les charges de travail sont déployées. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_registry` | Nom du dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails du dépôt GitHub. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `num_history_shards` | `4` (dev/démo), `512`+ (prod) | Critique | Définitivement immuable après le premier déploiement. Le modifier exige d'effacer toutes les données de workflow et de tout réinitialiser depuis zéro. |
| `container_protocol` | `h2c` | Critique | Temporal utilise gRPC ; passer à `http1` casse toutes les connexions des workers SDK ainsi que la Web UI. |
| `temporal_database_name` / `temporal_visibility_database_name` | définis une seule fois | Critique | Immuables après le premier déploiement. Les modifier après le déploiement rend le schéma orphelin, et Temporal démarre alors avec une base de données non initialisée. |
| `enable_elasticsearch` avec `elasticsearch_url` | définis ensemble | Critique | Un point de terminaison Elasticsearch injoignable lorsque `enable_elasticsearch = true` fait planter Temporal au démarrage — il ne se rabat pas sur la visibilité PostgreSQL. |
| `quota_memory_requests` / `_limits` | unités binaires | Critique | Les entiers nus sont interprétés en octets et bloquent toute planification. |
| `min_instance_count` | `1` | Élevé | La mise à zéro (`0`) entraîne des minuteurs manqués, des nouvelles tentatives d'activités bloquées et une progression des workflows perdue. |
| `cpu_limit` | `2000m` | Élevé | Les quatre services Temporal partagent cette allocation. En dessous de 1000m, la latence de planification augmente fortement et le déclenchement des minuteurs est retardé, ce qui affecte directement les SLA des workflows. |
| `memory_limit` | `4Gi` | Élevé | Temporal conserve l'état des shards en mémoire ; une mémoire insuffisante provoque des arrêts OOM pendant le traitement des workflows. |
| `temporal_db_user` | généré automatiquement | Élevé | Le modifier après le déploiement sans mettre à jour les droits Cloud SQL et Secret Manager fait échouer toutes les connexions du serveur. |
| `elasticsearch_version` | correspondre au cluster réel | Élevé | Une incohérence provoque des mappings d'index incompatibles, des entrées de workflow manquantes et des échecs d'écriture de visibilité. |
| `elasticsearch_url` | `host:port` ou `http://host:port` | Élevé | Obligatoire lorsque `enable_elasticsearch = true` ; une valeur vide provoque un plantage immédiat au démarrage. |
| `service_type` | `ClusterIP` (interne) | Moyen | Exposer le Frontend de Temporal en `LoadBalancer` sans règle réseau permet à n'importe quel hôte externe de soumettre des workflows. |
| `enable_pod_disruption_budget` | `true` | Moyen | Sans PDB, les mises à niveau des nœuds GKE peuvent expulser tous les pods Temporal simultanément, interrompant toutes les exécutions de workflows en cours. |
| `backup_schedule` | `0 2 * * *` | Moyen | Un calendrier vide ou désactivé ne laisse aucun moyen de récupération en cas de défaillance de Cloud SQL. |
| `pdb_min_available` vs `min_instance_count` | laisser de la marge | Moyen | `1`/`1` peut bloquer les mises à niveau des nœuds (le pod unique ne peut pas être expulsé). |
| `stateful_pvc_enabled` | `false` | Moyen | Temporal stocke tout son état dans Cloud SQL ; les PVC n'apportent aucun bénéfice et peuvent provoquer des échecs de planification Autopilot. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. Le provisionnement
de la base de données et des secrets propre à Temporal, partagé entre les déploiements, est décrit dans
**[Temporal_Common](Temporal_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Temporal sur GKE Autopilot](../labs/Temporal_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Temporal Common — Configuration applicative partagée](Temporal_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Kestra sur Google Cloud Run](Kestra_CloudRun.md), [Windmill sur Google Cloud Run](Windmill_CloudRun.md) et [CloudBeaver sur Google Cloud Run](CloudBeaver_CloudRun.md) dans la solution **Data & Workflow Orchestration**.
