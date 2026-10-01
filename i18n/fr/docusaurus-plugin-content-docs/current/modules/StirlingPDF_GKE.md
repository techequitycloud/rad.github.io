---
title: "Stirling-PDF sur GKE Autopilot"
description: "Référence de configuration pour déployer Stirling-PDF sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/StirlingPDF_GKE.md @ 3055034 sha256:55fb1f577103 -->

# Stirling-PDF sur GKE Autopilot {#stirling-pdf-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/StirlingPDF_GKE.png" alt="Stirling-PDF sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Stirling-PDF est une boîte à outils PDF web open source (cœur sous licence MIT) et
auto-hébergée — fusion, découpage, conversion, OCR, compression, filigrane,
signature, caviardage et plus de 50 autres opérations PDF, toutes traitées sur votre
propre infrastructure, de sorte que les documents ne transitent jamais par un service
tiers. Ce module déploie Stirling-PDF sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Stirling-PDF et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et en
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Stirling-PDF s'exécute sous la forme d'une charge de travail web Java / Spring Boot
(avec un LibreOffice intégré pour les conversions de documents). Le déploiement
assemble un ensemble volontairement restreint de services Google Cloud —
Stirling-PDF est sans état ; il n'y a donc ni base de données, ni stockage
persistant, ni secrets à gérer :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Java, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Image de conteneur | Artifact Registry | Image officielle `stirlingtools/stirling-pdf`, dupliquée par défaut |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |
| Redis (inerte) | Redis | Désactivé par défaut. `enable_redis` amène seulement le socle à injecter les variables d'environnement `REDIS_*` — Stirling-PDF ne les lit jamais, cela n'apporte donc ni limitation de débit ni détection de bots |
| Observabilité | Cloud Logging / Cloud Monitoring | Journaux des pods, métriques, test de disponibilité et alertes facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Sans état — ni base de données, ni stockage, ni secrets.** `database_type = "NONE"`,
  aucun bucket GCS, pas de NFS, `workload_type = Deployment` et une map de secrets
  vide. Chaque opération PDF s'exécute dans un répertoire de travail éphémère propre
  à la requête, supprimé à la fin du traitement.
- **Image préconstruite.** `container_image_source = "prebuilt"` déploie directement
  l'image officielle `stirlingtools/stirling-pdf` ; `enable_image_mirroring = true`
  la met en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub.
- **La connexion est désactivée par défaut.** `enable_login = false`
  (`SECURITY_ENABLELOGIN=false`) livre une instance ouverte. Activez-la et placez la
  charge de travail derrière IAP ou Cloud Armor pour un déploiement privé.
- **Au moins 1 réplica.** GKE ne prend pas en charge la mise à l'échelle jusqu'à
  zéro ; `min_instance_count = 1` maintient la boîte à outils accessible. Comme il
  n'y a aucun état partagé, passer à `max_instance_count > 1` ne nécessite aucun
  mécanisme de coordination — Redis ou autre.
- **Plancher mémoire de 2 GiB.** La JVM et LibreOffice ont besoin d'au moins `2Gi` ;
  augmentez `container_resources.memory_limit` pour les charges de travail lourdes
  d'OCR / de conversion.
- **LoadBalancer externe avec une adresse IP stable.** `service_type = "LoadBalancer"`,
  `reserve_static_ip = true` et `enable_custom_domain = true` par défaut.
- **Les sondes de santé interrogent `/api/v1/info/status`** — un point de terminaison
  public et non authentifié qui renvoie 200 une fois la JVM et LibreOffice
  initialisés. L'image complète peut mettre 2 à 4 minutes à ouvrir son port sur un
  nœud Autopilot provisionné à froid ; la sonde de démarrage accorde donc une fenêtre
  d'environ 5 minutes (délai initial de 20s, 30 échecs × 10s).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Stirling-PDF {#a-gke-autopilot--the-stirling-pdf-workload}

Les pods Stirling-PDF sont planifiés sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le
déploiement entre les nombres minimal et maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Stirling-PDF pour consulter les pods et les événements. Kubernetes Engine →
  Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image officielle `stirlingtools/stirling-pdf` est mise en miroir dans Artifact Registry
(`enable_image_mirroring = true`) et le cluster la récupère depuis cet emplacement.
Aucune étape Cloud Build n'est exécutée — l'image est préconstruite en amont.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  ```

Consultez [App_GKE](App_GKE.md) pour le mécanisme de duplication et la conservation
des images.

### C. Réseau et entrée {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud Load
Balancing. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une adresse IP statique est réservée par défaut afin que l'adresse survive
aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails relatifs à l'adresse IP statique.

### D. Redis (inerte — enable_redis n'a aucun effet sur l'application) {#d-redis-inert--enable_redis-has-no-application-effect}

Redis est **désactivé par défaut** (`enable_redis = false`). Définir
`enable_redis = true` amène seulement le socle `App_GKE` à injecter les variables
d'environnement `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` dans le pod — Stirling-PDF
**ne les lit jamais**. Le commentaire de `stirlingpdf.tf` lui-même confirme « no DB
or Redis », et ni `StirlingPDF_Common` ni ce module ne font correspondre ces
variables d'environnement à un paramètre reconnu par Stirling-PDF. Activer Redis
n'implémente **pas** de limitation de débit ni de détection de bots pour cette
application. Utilisez `enable_cloud_armor` pour une véritable protection contre les
abus sur une instance publique.

- **CLI (pour confirmer que les variables d'environnement sont présentes mais inutilisées) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i redis
  ```

### E. Identity-Aware Proxy (facultatif) {#e-identity-aware-proxy-optional}

Comme Stirling-PDF traite des documents potentiellement sensibles, un déploiement
privé doit contrôler l'Ingress avec IAP. Activer `enable_iap` exige une identité
Google authentifiée et autorisée avant qu'une requête n'atteigne la charge de travail.

- **Console :** Security → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le câblage OAuth d'IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques de
GKE sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Stirling-PDF {#3-stirling-pdf-application-behaviour}

- **Rien n'est persisté.** Les fichiers envoyés sont écrits dans un répertoire de
  travail éphémère propre à la requête et supprimés au retour de la réponse. Il n'y a
  ni base de données, ni PVC, ni bucket — une mise à jour progressive ou une
  replanification de pod ne fait rien perdre.
- **Premier démarrage lent.** L'image complète intègre LibreOffice et l'OCR, et peut
  mettre 2 à 4 minutes à ouvrir son port sur un nœud Autopilot provisionné à froid.
  La sonde de démarrage cible `/api/v1/info/status` avec un délai initial de 20s et
  30 échecs à intervalles de 10s (environ 5 minutes au total) avant qu'un pod ne soit
  marqué comme non sain ; la sonde de vivacité attend un délai initial de 120s afin
  de ne pas entrer en concurrence avec la sonde de démarrage en plein préchauffage.
- **La connexion est facultative et désactivée par défaut.** `enable_login = false`
  livre une instance ouverte. Définissez `enable_login = true` pour exiger
  l'authentification intégrée de Stirling-PDF ; combinez avec IAP pour une défense en
  profondeur.
- **Mise à l'échelle horizontale sûre.** En l'absence d'état partagé,
  `max_instance_count > 1` ne nécessite aucun mécanisme de coordination.
  `enable_redis` n'a aucun rapport avec cela — il s'agit d'une transmission inerte au
  socle que Stirling-PDF ne lit jamais (voir §2.D). Le HPA ajuste le nombre de
  réplicas en fonction de la charge CPU/mémoire.
- **Les mises à niveau de version se font par changement d'étiquette d'image.**
  Modifier `application_version` déclenche une mise à jour progressive sans étape de
  migration ; la stratégie RollingUpdate par défaut convient, car l'application est
  sans état.
- **Confirmer la configuration en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -iE 'SECURITY_|SYSTEM_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Stirling-PDF ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `stirlingpdf` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Stirling-PDF` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Étiquette de l'image Stirling-PDF ; épinglez une version précise en production. |
| `enable_login` | `false` | Active l'authentification intégrée de Stirling-PDF (`SECURITY_ENABLELOGIN`). |
| `default_locale` | `en-US` | Langue par défaut de l'interface (`SYSTEM_DEFAULTLOCALE`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle (`prebuilt`) ou construit une image personnalisée. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="2Gi" }` | Limites de CPU/mémoire ; **plancher de 2Gi** pour la JVM et LibreOffice. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. Peut être augmenté sans risque — aucun état partagé. |
| `container_port` | `8080` | Stirling-PDF écoute sur le port 8080. |
| `enable_image_mirroring` | `true` | Met en miroir l'image dans Artifact Registry. |
| `timeout_seconds` | `60` | Durée maximale d'une requête ; augmentez-la pour les conversions volumineuses. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres Stirling-PDF supplémentaires (par exemple `SYSTEM_MAXFILESIZE`). La connexion et la langue sont définies via `enable_login` / `default_locale`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Stirling-PDF n'en a besoin d'aucune par défaut. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout automatiquement en un Deployment sans état. Un StatefulSet est inutile. |
| `session_affinity` | `None` | Stirling-PDF est sans état — aucun routage persistant n'est requis. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds/pods. |
| `termination_grace_period_seconds` | `30` | Nombre de secondes d'attente après SIGTERM avant SIGKILL. |
| `enable_network_segmentation` | `false` | Crée des ressources Kubernetes NetworkPolicy. |
| `enable_cloudsql_volume` | `false` | Non utilisé — Stirling-PDF n'a pas de base de données. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | À laisser désactivé — Stirling-PDF ne stocke aucun état. |
| `stateful_pvc_size` / `stateful_pvc_mount_path` / `stateful_pvc_storage_class` | `10Gi` / `/data` / `standard-rwo` | Pertinent uniquement si un StatefulSet est imposé. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles lors des interruptions volontaires. |
| `enable_resource_quota` | `false` | Applique un ResourceQuota à l'espace de noms. |
| `quota_memory_requests` / `quota_memory_limits` | `""` | Doivent utiliser des unités binaires (`4Gi`) — des entiers nus sont des octets et bloquent la planification. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info/status`, délai de 20s, 30 × 10s tentatives | Sonde de démarrage. Fenêtre d'environ 5 minutes au premier démarrage pour la JVM et LibreOffice. |
| `liveness_probe` | HTTP `/api/v1/info/status`, délai de 120s | Sonde de vivacité ; retardée pour laisser passer le premier démarrage lent. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Règles d'alerte facultatives sur les métriques. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun n'est requis — Stirling-PDF est sans état. |
| `cron_jobs` | `[]` | CronJobs Kubernetes planifiés. |
| `additional_services` | `[]` | Services sidecar ou auxiliaires. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut. Activez-le uniquement si vous hébergez Redis sur la VM du serveur NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Stirling-PDF est sans état — aucun bucket par défaut. |
| `storage_buckets` | `[]` | Buckets supplémentaires facultatifs. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse via le pilote CSI. |
| `max_images_to_retain` | `7` | Nombre maximal d'images récentes d'Artifact Registry à conserver. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 15 — Redis (transmission inerte au socle) {#group-15--redis-inert-foundation-passthrough}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Inerte pour Stirling-PDF : amène seulement `App_GKE` à injecter les variables d'environnement `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`, que l'application ne lit jamais. L'activer n'apporte ni limitation de débit ni détection de bots. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'adresse IP interne du serveur NFS. Inutilisé par Stirling-PDF, quelle que soit la valeur. |
| `redis_port` | `6379` | Port Redis. Inutilisé par Stirling-PDF, quelle que soit la valeur. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). Inutilisé par Stirling-PDF, quelle que soit la valeur. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Stirling-PDF n'utilise aucune base de données. |
| `database_password_length` | `32` | Non utilisé. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Remarque :** activer IAP exige une authentification par identité Google pour
> toutes les requêtes entrantes. Recommandé pour les instances privées traitant des
> documents sensibles.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Stirling-PDF. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder. |
| `iap_oauth_client_id` / `iap_oauth_client_secret` | `""` | Obligatoires lorsqu'IAP est activé (sensibles). |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Associe une règle Cloud Armor (WAF) au backend de l'Ingress. Recommandé pour les instances publiques. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour un accès privilégié. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'Ingress GKE. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une adresse IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Stirling-PDF. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Stirling-PDF est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut de la surveillance et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un StatefulSet imposé avec un type de charge de travail `Deployment`, des `quota_memory_*` exprimés dans des unités non binaires, un `redis_port`/`timeout_seconds` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_login` + entrée | `enable_login = true` **ou** IAP pour un usage privé | Élevé | La valeur par défaut `enable_login = false` associée à un LoadBalancer externe laisse une boîte à outils PDF ouverte, utilisable par quiconque connaît l'adresse IP. |
| `enable_iap` | À activer pour les instances traitant des documents sensibles | Élevé | Sans IAP (et avec la connexion désactivée), la charge de travail n'est pas authentifiée ; les utilisateurs peuvent envoyer des documents confidentiels vers un point de terminaison ouvert. |
| `container_resources.memory_limit` | `2Gi` | Élevé | En dessous d'environ 2Gi, la JVM et LibreOffice sont arrêtés pour manque de mémoire (OOM) pendant les conversions. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `timeout_seconds` | `60`, à augmenter pour les gros fichiers | Élevé | Les traitements volumineux d'OCR/de conversion qui dépassent le délai renvoient une erreur 504 en cours d'opération. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette `0`. |
| Fenêtre de `startup_probe` | Conserver la valeur par défaut d'environ 5 minutes | Moyen | La raccourcir marque les pods comme non sains avant que LibreOffice n'ait terminé son préchauffage, ce qui bloque le déploiement progressif. |
| `enable_cloud_armor` | À activer pour les instances publiques | Moyen | Une boîte à outils publique sans WAF est exposée aux abus et aux analyses. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Stirling-PDF, partagée avec la variante Cloud
Run, est décrite dans **[StirlingPDF_Common](StirlingPDF_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Stirling-PDF sur GKE Autopilot](../labs/StirlingPDF_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Stirling-PDF sur Google Cloud Run](StirlingPDF_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Stirling-PDF Common — Configuration applicative partagée](StirlingPDF_Common.md) — la configuration partagée par les deux cibles de déploiement.
