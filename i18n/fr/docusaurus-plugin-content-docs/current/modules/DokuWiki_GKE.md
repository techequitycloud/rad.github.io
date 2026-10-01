---
title: "DokuWiki sur GKE Autopilot"
description: "Référence de configuration pour déployer DokuWiki sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/DokuWiki_GKE.md @ 3055034 sha256:6fc3ea84f02a -->

# DokuWiki sur GKE Autopilot {#dokuwiki-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_GKE.png" alt="DokuWiki sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki est un **wiki à fichiers plats** (sans base de données) léger et conforme aux
standards, qui stocke l'ensemble de son contenu — pages, médias, plugins, utilisateurs
et configuration — sous forme de fichiers sur disque. Ce module déploie DokuWiki sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise DokuWiki et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

DokuWiki s'exécute comme une charge de travail PHP/Apache sur GKE Autopilot. Comme il
s'agit d'un wiki à fichiers plats avec état, cette variante le déploie sous forme de
**StatefulSet** doté d'un PersistentVolumeClaim bloc durable, et non comme un
Deployment sans état. Le déploiement assemble un ensemble volontairement restreint de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod PHP/Apache sur le port 8080, 500m vCPU / 512 MiB par défaut ; **StatefulSet** |
| Base de données | **Aucune** | DokuWiki est un wiki à fichiers plats — `database_type = "NONE"`, aucun Cloud SQL provisionné |
| Stockage persistant | Persistent Disk (PVC bloc) | Un PVC bloc monté sur `/storage` contient *tout* l'état du wiki |
| Cache et file d'attente | **Aucun** | Pas de Redis ; DokuWiki n'a pas de modèle file d'attente/worker |
| Secrets | **Aucun** | Aucun secret d'exécution — le compte administrateur est créé via `/install.php` |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** DokuWiki stocke tout dans le répertoire à fichiers plats
  `/storage`. `database_type` est fixé à `"NONE"` ; une garde de validation au moment
  du plan rejette toute autre valeur. `enable_cloudsql_volume` vaut également `false`.
- **StatefulSet avec un PVC bloc.** `stateful_pvc_enabled = true` et
  `stateful_pvc_mount_path = "/storage"`, de sorte que `workload_type` sélectionne
  automatiquement `StatefulSet` (laissez `workload_type = null`). Un PVC bloc gère le
  verrouillage des fichiers plats de DokuWiki bien mieux que gcsfuse — c'est la
  variante recommandée pour l'édition concurrente.
- **Tout l'état réside sur le PVC.** La variante GKE supprime le volume/bucket GCS par
  défaut du module Common (`gcs_volumes = []`, `module_storage_buckets = []`) ; la
  persistance repose uniquement sur le PVC bloc `/storage` (`stateful_pvc_size = 10Gi`
  par défaut).
- **Un réplica minimum est maintenu** (GKE ne permet pas la mise à zéro ;
  `min_instance_count = 1`). Gardez peu de réplicas — les PVC par pod d'un
  StatefulSet ne sont pas partagés, donc plusieurs réplicas ne partagent **pas** le
  contenu du wiki.
- **Aucun secret d'exécution.** Le compte administrateur est créé de manière
  interactive lors de la première visite via `/install.php` et stocké sur le PVC.
- **LoadBalancer externe par défaut** (`service_type = LoadBalancer`) afin que le wiki
  soit joignable sur une IP externe. Activez IAP ou un domaine personnalisé selon les
  besoins.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail DokuWiki {#a-gke-autopilot--the-dokuwiki-workload}

Les pods DokuWiki sont planifiés sur Autopilot, qui facture le CPU/la mémoire
effectivement demandés par les pods. Comme DokuWiki est avec état, il s'exécute en
tant que **StatefulSet** avec un PVC bloc par pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  DokuWiki pour voir les pods et les événements. Kubernetes Engine → Services & Ingress
  affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pvc -n "$NAMESPACE"          # PVC bound to the /storage disk
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Base de données — non utilisée {#b-database--not-used}

DokuWiki n'utilise **pas** de base de données. `database_type = "NONE"`, aucune
instance Cloud SQL n'est créée, aucun job `db-init` ne s'exécute et
`enable_cloudsql_volume = false` (pas de sidecar Auth Proxy). La garde du module au
moment du plan rejette tout `database_type` différent de `NONE`.

### C. Stockage persistant — le PVC bloc `/storage` {#c-persistent-storage--the-storage-block-pvc}

L'intégralité de l'état de DokuWiki réside sur un **PersistentVolumeClaim bloc** (un
Persistent Disk Compute Engine) monté sur `/storage`. Il est provisionné par le
`volumeClaimTemplate` du StatefulSet ; il n'y a **aucun** bucket Cloud Storage sur
cette variante.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims ; Compute Engine →
  Disks pour le disque sous-jacent.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE"
  # Browse the wiki data on the running pod:
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- ls -la /storage/data/pages
  ```

Augmentez `stateful_pvc_size` avant le déploiement si vous prévoyez de grandes
médiathèques ; le redimensionnement ultérieur d'un PVC lié dépend de la prise en
charge de l'extension par la StorageClass.

### D. Redis — non utilisé {#d-redis--not-used}

DokuWiki n'a pas de modèle file d'attente ou worker et n'utilise pas Redis.
`enable_redis` est désactivé par défaut et il n'y a aucune raison de l'activer.

### E. Secret Manager — aucun secret applicatif {#e-secret-manager--no-application-secrets}

DokuWiki n'injecte **aucun** secret d'exécution. Le compte administrateur est créé via
l'installateur du premier lancement (`/install.php`) et persisté sur le PVC ; il n'y a
donc aucune clé générée à récupérer. `secret_environment_variables` reste vide par
conception.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

La sortie stdout/stderr des pods (journaux Apache) est envoyée à Cloud Logging ; les
métriques GKE sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application DokuWiki {#3-dokuwiki-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Il n'y a aucun schéma à
  créer et aucun job `db-init`. `initialization_jobs` est vide. Au premier démarrage,
  le PVC `/storage` est amorcé avec le wiki par défaut (géré par l'entrypoint de
  l'image amont) s'il est vide.
- **Configuration initiale via `/install.php`.** Lors de la première visite, ouvrez
  `http://<external-ip>/install.php` pour créer le compte administrateur, définir le
  titre du wiki et choisir la politique d'ACL. Ces éléments sont écrits sur le PVC.
  **Supprimez ou bloquez `install.php` ensuite** — toute personne qui y accède avant
  que vous ayez terminé la configuration peut s'approprier le compte administrateur.
- **Tout l'état est sur le PVC.** Supprimer le PVC (ou le StatefulSet avec son PVC)
  détruit le wiki. Sauvegardez le disque avant la suppression si vous devez conserver
  le contenu.
- **StatefulSet, et non Deployment.** DokuWiki est avec état ;
  `stateful_pvc_enabled = true` sélectionne automatiquement
  `workload_type = "StatefulSet"`. Ne définissez **pas** `workload_type =
  "Deployment"` en parallèle — cette combinaison échoue au moment du plan.
- **Les réplicas ne partagent pas le contenu.** Chaque pod du StatefulSet reçoit son
  propre PVC ; passer au-delà d'un réplica donne donc à chaque pod un wiki *distinct
  et vide*. Gardez `min`/`max` à 1, sauf si vous disposez d'une solution de stockage
  partagé externe ; DokuWiki n'offre aucun clustering intégré.
- **Pas de migrations automatiques.** Mettre à jour `application_version` livre un
  moteur DokuWiki plus récent qui lit les mêmes données `/storage` ; il n'y a aucune
  étape de migration.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  toutes `/` — DokuWiki y sert sa page d'accueil sans authentification, de sorte que la
  sonde réussit dès qu'Apache est démarré. Le premier démarrage se termine en quelques
  secondes (aucune migration de base de données).
- **Inspecter les montages et l'environnement du pod :**
  ```bash
  kubectl get statefulset <service-name> -n "$NAMESPACE" -o \
    jsonpath='{.spec.template.spec.containers[0].volumeMounts}' ; echo
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à DokuWiki ou notables pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DokuWiki ; `latest` est résolu en une version datée épinglée (`2024-02-06b`) au moment du build. Épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; GKE exige ≥ 1. Gardez 1 — les PVC d'un StatefulSet ne sont pas partagés. |
| `max_instance_count` | `3` | Plafond de coût. Ne dépassez pas 1 pour un wiki partagé — chaque pod reçoit son propre PVC vide. |
| `container_port` | `8080` | Apache écoute sur 8080. |
| `container_resources` | `{ cpu_limit = "500m", memory_limit = "512Mi" }` | DokuWiki est léger. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — pas de sidecar Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image DokuWiki dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Expose DokuWiki sur une IP externe. |
| `workload_type` | `null` | Laissez null — `stateful_pvc_enabled = true` sélectionne automatiquement `StatefulSet`. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Adosse `/storage` à un PVC bloc durable. Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `10Gi` | Taille du PVC par pod pour le contenu et les médias du wiki. Dimensionnez dès le départ pour des médias volumineux. |
| `stateful_pvc_mount_path` | `/storage` | Doit être le répertoire de données de DokuWiki pour que le contenu persiste. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass du PVC. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde au moment du plan rejette toute autre valeur. |

_Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md)._

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à DokuWiki. |
| `storage_buckets` | Buckets Cloud Storage créés (vide sur GKE — la persistance repose sur le PVC bloc). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (vide — DokuWiki n'en a aucun). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, `min_instance_count` supérieur à `max`, un workload_type `Deployment` en parallèle de `stateful_pvc_enabled = true`, des valeurs `quota_memory_*` en entiers nus — ainsi que des gardes propres au module pour un `database_type` différent de `NONE`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| PVC bloc `/storage` | Ne jamais le supprimer après le premier déploiement | Critique | Le PVC *est* le wiki — le supprimer (ou supprimer le StatefulSet avec son PVC) fait perdre toutes les pages, tous les médias et tous les utilisateurs. Sauvegardez le disque avant la suppression. |
| `database_type` | `NONE` | Critique | Toute autre valeur fait échouer la garde au moment du plan ; si elle est contournée, elle provisionne une instance Cloud SQL inutilisée et son coût. |
| `install.php` après la configuration | Supprimer / bloquer une fois l'administrateur créé | Élevé | Toute personne qui accède à `/install.php` avant que vous ayez terminé la configuration peut s'approprier le compte administrateur. |
| `workload_type` | `null` (auto → StatefulSet) | Élevé | Définir `Deployment` en parallèle de `stateful_pvc_enabled = true` échoue au moment du plan ; un simple Deployment perdrait des données lors d'un réordonnancement. |
| `min_instance_count` / `max_instance_count` | `1` pour un wiki partagé | Élevé | Chaque pod du StatefulSet reçoit son propre PVC vide — dépasser 1 répartit les utilisateurs entre des wikis distincts et non synchronisés. |
| `stateful_pvc_mount_path` | `/storage` | Élevé | Un autre chemin laisse le répertoire de données de DokuWiki sur le système de fichiers racine éphémère du pod — le contenu est perdu à chaque réordonnancement. |
| `stateful_pvc_size` | Dimensionner dès le départ (`10Gi`+) | Moyen | Les PVC sous-dimensionnés se remplissent de médias ; l'extension en ligne dépend de la StorageClass. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `service_type` | `LoadBalancer` (ou IAP/domaine) | Moyen | `ClusterIP` rend le wiki injoignable depuis l'extérieur du cluster sans entrée supplémentaire. |
| `memory_limit` (`container_resources`) | `512Mi` | Moyen | En dessous de 256 MiB, le processus PHP/Apache peut subir un OOM sous charge. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à DokuWiki, partagée avec
la variante Cloud Run, est décrite dans **[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DokuWiki sur GKE Autopilot](../labs/DokuWiki_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [DokuWiki sur Google Cloud Run](DokuWiki_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [DokuWiki Common — Configuration applicative partagée](DokuWiki_Common.md) — la configuration partagée par les deux cibles de déploiement.
