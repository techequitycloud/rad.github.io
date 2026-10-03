---
title: "DokuWiki sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de DokuWiki sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/DokuWiki_GKE.md @ 15fd4c7 sha256:04fe63462627 -->

# DokuWiki sur GKE Autopilot {#dokuwiki-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_GKE.png" alt="DokuWiki sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki est un **wiki léger, conforme aux standards et basé sur des fichiers plats** (sans base de données) qui stocke tout son contenu — pages, médias, plugins, utilisateurs et configuration — sous forme de fichiers sur le disque. Ce module déploie DokuWiki sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par DokuWiki et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

DokuWiki s'exécute comme une charge de travail PHP/Apache sur GKE Autopilot. Comme il s'agit d'un wiki à fichiers plats avec état, cette variante le déploie en tant que **StatefulSet** avec un PersistentVolumeClaim de bloc durable, et non en tant que Deployment sans état. Le déploiement connecte un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Apache sur le port 8080, 500m vCPU / 512 MiB par défaut ; **StatefulSet** |
| Base de données | **Aucune** | DokuWiki est un wiki à fichiers plats — `database_type = "NONE"`, aucune instance Cloud SQL provisionnée |
| Stockage persistant | Persistent Disk (PVC de bloc) | Un PVC de bloc monté à `/storage` contient *tout* l'état du wiki |
| Cache & file d'attente | **Aucun** | Pas de Redis ; DokuWiki n'a pas de modèle de file d'attente/worker |
| Secrets | **Aucun** | Pas de secrets d'exécution — le compte administrateur est créé via `/install.php` |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** DokuWiki stocke tout dans le répertoire de fichiers plats `/storage`. `database_type` est fixé à `"NONE"` ; une garde de validation au moment de la planification rejette toute autre valeur. `enable_cloudsql_volume` est également `false`.
- **StatefulSet avec un PVC de bloc.** `stateful_pvc_enabled = true` et `stateful_pvc_mount_path = "/storage"`, donc `workload_type` sélectionne automatiquement `StatefulSet` (laissez `workload_type = null`). Un PVC de bloc gère le verrouillage des fichiers plats de DokuWiki bien mieux que gcsfuse — c'est la variante recommandée pour l'édition concurrente.
- **Tout l'état réside sur le PVC.** La variante GKE supprime le volume/bucket GCS par défaut du module Common (`gcs_volumes = []`, `module_storage_buckets = []`) ; la persistance est le PVC de bloc `/storage` seul (`stateful_pvc_size = 10Gi` par défaut).
- **Minimum 1 réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle à zéro ; `min_instance_count = 1`). Gardez un nombre de réplicas faible — les PVC par pod d'un StatefulSet ne sont pas partagés, donc plusieurs réplicas ne partagent **pas** le contenu du wiki.
- **Pas de secrets d'exécution.** Le compte administrateur est créé de manière interactive lors de la première visite via `/install.php` et stocké sur le PVC.
- **LoadBalancer externe par défaut** (`service_type = LoadBalancer`) afin que le wiki soit accessible à une adresse IP externe. Activez IAP ou un domaine personnalisé si nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail DokuWiki {#a-gke-autopilot--the-dokuwiki-workload}

Les pods DokuWiki sont planifiés sur Autopilot, qui facture le CPU/la mémoire réellement demandés par les pods. Comme DokuWiki est avec état, il s'exécute en tant que **StatefulSet** avec un PVC de bloc par pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail DokuWiki pour voir les pods et les événements. Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC bound to the /storage disk
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Base de données — non utilisée {#b-database--not-used}

DokuWiki n'utilise **pas** de base de données. `database_type = "NONE"`, aucune instance Cloud SQL n'est créée, aucun job `db-init` ne s'exécute, et `enable_cloudsql_volume = false` (pas de sidecar Auth Proxy). La garde au moment de la planification dans le module rejette toute valeur `database_type` non-`NONE`.

### C. Stockage persistant — le PVC de bloc `/storage` {#c-persistent-storage--the-storage-block-pvc}

L'état entier de DokuWiki réside sur un **PersistentVolumeClaim de bloc** (un Persistent Disk de Compute Engine) monté à `/storage`. Ceci est provisionné par le `volumeClaimTemplate` du StatefulSet ; il n'y a **pas** de bucket Cloud Storage sur cette variante.

- **Console :** Kubernetes Engine → Stockage → Persistent Volume Claims ; Compute Engine → Disques pour le disque de sauvegarde.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Browse the wiki data on the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /storage/data/pages
  ```

Augmentez `stateful_pvc_size` avant le déploiement si vous prévoyez de grandes bibliothèques de médias ; le redimensionnement d'un PVC lié par la suite dépend du support d'expansion de la StorageClass.

### D. Redis — non utilisée {#d-redis--not-used}

DokuWiki n'a pas de modèle de file d'attente ou de worker et n'utilise pas Redis. `enable_redis` est désactivé par défaut et il n'y a aucune raison de l'activer.

### E. Secret Manager — pas de secrets d'application {#e-secret-manager--no-application-secrets}

DokuWiki n'injecte **aucun** secret d'exécution. Le compte administrateur est créé via l'installateur de première exécution (`/install.php`) et persisté sur le PVC, il n'y a donc pas de clé générée à récupérer. `secret_environment_variables` reste vide par conception.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs stdout/stderr des pods (logs Apache) sont envoyés à Cloud Logging ; les métriques GKE sont envoyées à Cloud Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application DokuWiki {#3-dokuwiki-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Il n'y a pas de schéma à créer et pas de job `db-init`. `initialization_jobs` est vide. Le premier démarrage initialise le PVC `/storage` avec le wiki par défaut (géré par le point d'entrée de l'image amont) s'il est vide.
- **Configuration initiale via `/install.php`.** Lors de la première visite, ouvrez `http://<external-ip>/install.php` pour créer le compte administrateur, définir le titre du wiki et choisir la politique ACL. Ceci est écrit sur le PVC. **Supprimez ou bloquez `install.php` après** — toute personne y accédant avant que vous n'ayez terminé la configuration peut revendiquer le compte administrateur.
- **Tout l'état est sur le PVC.** La suppression du PVC (ou du StatefulSet avec son PVC) détruit le wiki. Sauvegardez le disque avant de le démonter si vous avez besoin de conserver le contenu.
- **StatefulSet, pas Deployment.** DokuWiki est avec état ; `stateful_pvc_enabled = true` sélectionne automatiquement `workload_type = "StatefulSet"`. Ne définissez **pas** `workload_type =
  "Deployment"` en même temps — cette combinaison échoue au moment de la planification.
- **Les réplicas ne partagent pas le contenu.** Chaque pod StatefulSet obtient son propre PVC, donc la mise à l'échelle au-delà d'un réplica donne à chaque pod un wiki *séparé et vide*. Gardez `min`/`max` à 1, sauf si vous avez un plan de stockage partagé externe ; DokuWiki n'a pas de clustering intégré.
- **Pas de migrations automatiques.** La mise à niveau de `application_version` livre un moteur DokuWiki plus récent qui lit les mêmes données `/storage` ; il n'y a pas d'étape de migration.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent toutes `/` — DokuWiki y sert sa page de démarrage sans authentification, de sorte que la sonde passe dès qu'Apache est opérationnel. Le premier démarrage se termine en quelques secondes (pas de migrations de base de données).
- **Inspectez les montages et l'environnement du pod :**
  ```bash
  kubectl get statefulset <service-name> -n "$NAMESPACE" -o \
    jsonpath='{.spec.template.spec.containers[0].volumeMounts}' ; echo
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour DokuWiki sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DokuWiki ; `latest` se résout en une version datée épinglée (`2024-02-06b`) au moment de la build. Épinglez une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1. Gardez à 1 — les PVC des StatefulSet ne sont pas partagés. |
| `max_instance_count` | `1` | Plafond de coût. Ne pas dépasser 1 pour un wiki partagé — chaque pod obtient son propre PVC vide. |
| `container_port` | `8080` | Apache écoute sur le port 8080. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | DokuWiki est léger. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — pas de sidecar Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image DokuWiki dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose DokuWiki à une adresse IP externe. |
| `workload_type` | `null` | Laissez null — `stateful_pvc_enabled = true` sélectionne automatiquement `StatefulSet`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Sauvegarde `/storage` avec un PVC de bloc durable. Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod pour le contenu/média du wiki. Dimensionnez à l'avance pour les grands médias. |
| `stateful_pvc_mount_path` | `/storage` | Doit être le répertoire de données de DokuWiki pour que le contenu persiste. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour le PVC. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde au moment de la planification rejette toute autre valeur. |

_Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md)._

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre DokuWiki. |
| `storage_buckets` | Buckets Cloud Storage créés (vides sur GKE — la persistance est le PVC de bloc). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (vide — DokuWiki n'en a pas). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, `min_instance_count` au-dessus de `max`, un type de charge de travail `Deployment` avec `stateful_pvc_enabled = true`, des valeurs `quota_memory_*` entières brutes — ainsi que des gardes spécifiques au module pour un `database_type` non-`NONE`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC de bloc `/storage` | Ne jamais supprimer après le premier déploiement | Critique | Le PVC *est* le wiki — le supprimer (ou le StatefulSet avec son PVC) entraîne la perte de toutes les pages, médias et utilisateurs. Sauvegardez le disque avant le démontage. |
| `database_type` | `NONE` | Critique | Toute autre valeur fait échouer la garde au moment de la planification ; si elle est contournée, elle provisionne une instance Cloud SQL inutilisée et un coût. |
| `install.php` après la configuration | Supprimer / bloquer une fois l'administrateur créé | Élevé | Toute personne qui atteint `/install.php` avant que vous n'ayez terminé la configuration peut revendiquer le compte administrateur. |
| `workload_type` | `null` (auto → StatefulSet) | Élevé | Définir `Deployment` avec `stateful_pvc_enabled = true` échoue au moment de la planification ; un simple Deployment perdrait des données lors de la replanification. |
| `min_instance_count` / `max_instance_count` | `1` pour un wiki partagé | Élevé | Chaque pod StatefulSet obtient son propre PVC vide — la mise à l'échelle au-delà de 1 divise les utilisateurs entre des wikis séparés et non synchronisés. |
| `stateful_pvc_mount_path` | `/storage` | Élevé | Un chemin différent laisse le répertoire de données de DokuWiki sur le système de fichiers racine éphémère du pod — le contenu est perdu à chaque replanification. |
| `stateful_pvc_size` | Dimensionner à l'avance (`10Gi`+) | Moyen | Les PVC sous-dimensionnés se remplissent de médias ; l'expansion en ligne dépend de la StorageClass. |
| `quota_memory_requests` / `_limits` | Unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `service_type` | `LoadBalancer` (ou IAP/domaine) | Moyen | `ClusterIP` rend le wiki inaccessible depuis l'extérieur du cluster sans ingress supplémentaire. |
| `memory_limit` (`container_resources`) | `512Mi` | Moyen | En dessous de 256 MiB, le processus PHP/Apache peut manquer de mémoire (OOM) sous charge. |

---

Pour le comportement du socle référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à DokuWiki partagée avec la variante Cloud Run est décrite dans
**[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DokuWiki sur GKE Autopilot](../labs/DokuWiki_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [DokuWiki sur Google Cloud Run](DokuWiki_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [DokuWiki Common — Configuration d'application partagée](DokuWiki_Common.md) — la configuration partagée par les deux cibles de déploiement.
