---
title: "Appsmith sur GKE Autopilot"
description: "Référence de configuration pour déployer Appsmith sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Appsmith_GKE.md @ 3055034 sha256:1cdd540047ef -->

# Appsmith sur GKE Autopilot {#appsmith-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Appsmith_GKE.png" alt="Appsmith sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Appsmith est une plateforme low-code open source pour créer des outils internes,
des panneaux d'administration et des tableaux de bord — une alternative
auto-hébergée à Retool. La Community Edition est livrée sous la forme d'un
unique conteneur « fat » qui embarque une MongoDB, un Redis, le backend Java et
le client React derrière nginx, et conserve tout l'état de l'application sous
`/appsmith-stacks`. Ce module déploie Appsmith sur **GKE Autopilot** au-dessus
du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Appsmith et sur la
façon de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Appsmith s'exécute comme une charge de travail à conteneur « fat » unique, avec
tout son état — la MongoDB embarquée, Redis, les ressources téléversées et la
configuration — sur un seul volume persistant. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod de StatefulSet à conteneur unique sur le port 80, 2 vCPU / 2Gi par défaut |
| État persistant | PersistentVolumeClaim (`stateful_pvc_enabled`) | PVC de 20Gi monté sur `/appsmith-stacks`, qui porte la MongoDB embarquée, Redis, les téléversements et la configuration |
| Image de conteneur | Docker Hub (préconstruite) | `appsmith/appsmith-ce`, mise en miroir dans Artifact Registry par défaut |
| Secrets | Secret Manager | `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT`, `APPSMITH_SUPERVISOR_PASSWORD` générés automatiquement |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé avec certificat géré par Google activé par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données externe.** Appsmith CE exécute sa propre MongoDB
  embarquée dans le conteneur « fat » ; `database_type` est fixé à `NONE` et
  `enable_cloudsql_volume` vaut `false` par défaut. Il n'y a pas de sidecar
  Cloud SQL Auth Proxy pour ce module — tout est conservé sur le propre PVC du
  pod.
- **La persistance repose sur un PVC par pod, pas sur NFS.**
  `stateful_pvc_enabled = true` par défaut, ce qui résout automatiquement
  `workload_type` en `StatefulSet` et monte un PVC de 20Gi sur
  `/appsmith-stacks`. `enable_nfs` vaut `false` par défaut — NFS n'est proposé
  qu'aux appelants qui préfèrent un volume Filestore partagé au PVC bloc, mais
  la MongoDB embarquée gère son propre verrouillage de fichiers, si bien que le
  PVC est le choix naturel (et NFS est plus sujet aux problèmes de verrouillage
  en écriture pour les bases de données embarquées ; voir les recommandations
  générales du dépôt sur NFS/SQLite).
- **Réplica unique, contrainte stricte.** `min_instance_count = 1`,
  `max_instance_count = 1`. Plusieurs réplicas recevraient chacun un PVC
  **vide** (les PVC de StatefulSet sont par pod, non partagés) et exécuteraient
  des instances MongoDB embarquées indépendantes et divergentes — il n'y a pas
  de mise en cluster. `max_instance_count` n'est pas bloqué au-dessus de 1 au
  moment du plan (seul `min ≤ max` est imposé), si bien que l'augmenter est un
  véritable piège.
- **L'image « fat » est récupérée préconstruite depuis Docker Hub.**
  `container_image_source` vaut `"prebuilt"` par défaut
  (`appsmith/appsmith-ce`), correctement transmis au socle App_GKE — il
  n'y a ni Dockerfile ni build personnalisé pour ce module.
  `enable_image_mirroring = true` copie l'image dans Artifact Registry pour
  éviter les limites de débit de Docker Hub.
- **Trois secrets sont générés automatiquement et nécessaires à la continuité
  des données.** `APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT`
  sécurisent le chiffrement AES-256 au repos des identifiants des sources de
  données et des clés SSH Git — modifier l'un ou l'autre après le premier
  démarrage rend les données déjà chiffrées illisibles.
  `APPSMITH_SUPERVISOR_PASSWORD` protège le panneau interne de contrôle des
  processus `/supervisor` du conteneur.
- **`enable_redis` et `database_type` sont des leurres pour cette application.**
  Appsmith CE embarque en interne son propre Redis et sa propre Mongo ; il ne
  lit pas les variables d'environnement génériques `REDIS_HOST`/`REDIS_URL` que
  le socle App_GKE injecterait si `enable_redis` était activé, et
  `database_type` est fixé à `NONE`. Laissez les deux à leurs valeurs par
  défaut.
- **Le routage par domaine personnalisé est activé par défaut.** Contrairement à
  la plupart des modules, `enable_custom_domain = true` d'emblée (bien que
  `application_domains` reste vide tant que vous n'ajoutez pas de nom d'hôte).
- **L'installation au premier démarrage est autonome.** L'image « fat »
  initialise sa propre MongoDB et son propre Redis embarqués au premier
  lancement ; il n'y a pas de job `db-init` ou de migration distinct pour ce
  module (`initialization_jobs` vaut `[]` par défaut).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Appsmith {#a-gke-autopilot--the-appsmith-workload}

Appsmith s'exécute comme un `StatefulSet` (sélectionné automatiquement parce que `stateful_pvc_enabled
= true`), ce qui donne au pod unique une identité stable
et son propre PVC d'une replanification à l'autre. Le conteneur « fat » démarre
lentement (Mongo + Redis + backend Java embarqués) ; prévoyez plusieurs minutes
avant qu'il ne passe à l'état Ready.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Appsmith pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name~appsmith" 2>/dev/null || \
    kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à
l'échelle et du type de charge de travail StatefulSet ou Deployment.

### B. Stockage persistant — PersistentVolumeClaim {#b-persistent-storage--persistentvolumeclaim}

Tout l'état d'Appsmith — les fichiers de données de la MongoDB embarquée, le
dump Redis, les ressources téléversées, les données des plugins et la
configuration des applications connectées à Git — réside sur un unique PVC
bloc de 20Gi monté sur `/appsmith-stacks`. Comme il s'agit d'un PVC de
StatefulSet par pod (et non d'un montage NFS partagé), il survit aux
redémarrages et replanifications du pod mais n'est **pas** partagé entre les
réplicas.

- **Console :** Kubernetes Engine → Storage → PersistentVolumeClaims /
  PersistentVolumes.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" -l app=<service-name>
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- du -sh /appsmith-stacks
  ```

Consultez le groupe 7 d'[App_GKE](App_GKE.md) pour le choix de la StorageClass
(SSD `standard-rwo` par défaut ; remplacez par le HDD `standard` si le quota
SSD régional est serré).

### C. Image de conteneur et Artifact Registry {#c-container-image--artifact-registry}

L'image déployée est l'image « fat » officielle `appsmith/appsmith-ce` de
Docker Hub — aucun Dockerfile ni aucune étape Cloud Build ne la construit. Avec
`enable_image_mirroring = true` (par défaut), elle est d'abord copiée dans
Artifact Registry afin que le cluster la récupère depuis le réseau de Google
plutôt que directement depuis Docker Hub.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --filter="name~appsmith"
  gcloud artifacts docker images list "$REGION-docker.pkg.dev/$PROJECT/<repo-name>" --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Trois secrets Appsmith sont générés automatiquement et stockés dans Secret
Manager : `APPSMITH_ENCRYPTION_PASSWORD`, `APPSMITH_ENCRYPTION_SALT` (qui
sécurisent tous deux le chiffrement au repos des identifiants des sources de
données et des clés SSH Git) et `APPSMITH_SUPERVISOR_PASSWORD` (qui protège le
panneau superviseur interne du conteneur). Sur GKE, les secrets sont projetés
dans le pod via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~appsmith"
  gcloud secrets versions access latest --secret=<encryption-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et le
renouvellement.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true` pour que
l'adresse survive aux redéploiements). `enable_custom_domain = true` par
défaut — ajoutez un nom d'hôte à `application_domains` pour provisionner un
certificat géré par Google.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines
personnalisés, Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés vers Cloud Logging ; les métriques
GKE vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles (`uptime_check_config`, `alert_policies`).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Appsmith {#3-appsmith-application-behaviour}

- **Premier démarrage autonome — pas de job d'initialisation.** L'image « fat »
  initialise sa MongoDB et son Redis embarqués et crée les données initiales de
  l'application au premier lancement. `initialization_jobs` vaut `[]` par
  défaut ; seuls les jobs fournis par l'appelant sont pris en compte.
- **L'état persistant réside entièrement sur le PVC.** `/appsmith-stacks`
  contient le répertoire de données Mongo, le dump Redis, les ressources
  téléversées et des plugins, ainsi que les données des applications connectées
  à Git. Perdre le PVC, c'est tout perdre — il n'y a pas de base de données
  distincte sur laquelle se rabattre.
- **Les clés de chiffrement ne doivent pas changer après le premier
  démarrage.** `APPSMITH_ENCRYPTION_PASSWORD` et `APPSMITH_ENCRYPTION_SALT` sont
  générés une seule fois et stockés dans Secret Manager ; les renouveler
  indépendamment d'une réinitialisation complète des données rend
  indéchiffrables les identifiants de sources de données et les clés SSH Git
  déjà enregistrés. `APPSMITH_DISABLE_TELEMETRY = "true"` est défini par défaut
  pour désactiver la télémétrie d'utilisation anonyme.
- **Ne définissez pas `APPSMITH_DB_URL` / `APPSMITH_REDIS_URL`.** La
  configuration du module Common évite délibérément de les injecter — la Mongo
  et le Redis internes du conteneur « fat » utilisent `localhost` par défaut, et
  les faire pointer vers un magasin de données externe empêche le démarrage.
- **Chemin de contrôle d'état.** La sonde de démarrage est une requête **HTTP**
  `GET /api/v1/health` sur le port 80, avec une fenêtre généreuse
  (~10 minutes : `initial_delay_seconds = 120`, `period_seconds = 15`,
  `failure_threshold = 40`) pour tenir compte du démarrage lent de la pile
  MongoDB + Redis + backend Java embarquée. La sonde de vivacité utilise le même
  chemin avec des seuils plus stricts (`initial_delay_seconds = 60`,
  `period_seconds = 30`, `failure_threshold = 3`) une fois l'application
  démarrée.
- **StatefulSet à réplica unique, stratégie `RollingUpdate`.** Avec
  `max_instance_count = 1`, il n'y a jamais qu'un seul pod ; la stratégie par
  défaut `stateful_update_strategy = "RollingUpdate"` se contente donc de
  recréer ce pod lors des modifications du modèle — il n'y a aucun risque de
  surge ou d'interblocage avec un seul réplica, mais porter
  `max_instance_count` au-dessus de 1 n'est pas pris en charge (voir la vue
  d'ensemble).
- **Inspectez le pod en cours d'exécution et ses données persistées :**
  ```bash
  kubectl get statefulset -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=200
  kubectl exec -n "$NAMESPACE" statefulset/<service-name> -- env | grep APPSMITH
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées selon leur balise `{{UIMeta group=N}}` telle que
déclarée dans le `variables.tf` de ce module (c'est ce qui détermine la
disposition du formulaire dans l'interface de la plateforme de déploiement).
Seuls les paramètres propres à Appsmith ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `appsmith` | Nom de base de la charge de travail Kubernetes, du dépôt Artifact Registry et des secrets Secret Manager. |
| `application_version` | `latest` | Tag appliqué à l'image `appsmith/appsmith-ce` récupérée ; comme l'image est préconstruite (et non issue d'un build de Dockerfile personnalisé), `latest` correspond directement au tag `latest` de Docker Hub — le piège de l'ARG d'épinglage de version ne s'applique pas ici. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Récupère l'image « fat » officielle `appsmith/appsmith-ce` depuis Docker Hub. Correctement transmis au socle App_GKE. |
| `container_port` | `80` | Appsmith CE sert sur le port 80 via son nginx interne. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=2Gi` | L'image « fat » embarque MongoDB, Redis et un backend Java dans un seul conteneur ; 2Gi ou plus sont donc recommandés. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Laissez les deux à 1.** La MongoDB embarquée et le PVC par pod ne supportent pas plusieurs réplicas ; `max_instance_count` n'est pas bloqué au-dessus de 1 au moment du plan. |
| `enable_cloudsql_volume` | `false` | Toujours false — Appsmith CE n'a pas de base de données Cloud SQL externe. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Docker Hub dans Artifact Registry avant le déploiement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface Appsmith. |
| `workload_type` | `null` → `StatefulSet` | Résolu automatiquement en StatefulSet parce que `stateful_pvc_enabled = true`. |
| `session_affinity` | `None` | Routage round-robin ; sans effet avec un seul réplica, mais à laisser inchangé puisque `max_instance_count` doit rester à 1. |

### Groupe 13 — Système de fichiers (NFS) et tâches planifiées {#group-13--filesystem-nfs--scheduled-jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — la persistance utilise plutôt le PVC du StatefulSet. À activer uniquement si un volume Filestore partagé est préféré au PVC par pod. |
| `nfs_mount_path` | `/appsmith-stacks` | Chemin de montage utilisé si NFS est activé à la place du PVC. |
| `initialization_jobs` / `cron_jobs` | `[]` | Aucun job par défaut — Appsmith CE s'initialise lui-même. |

### Groupe 15 — Backend de base de données {#group-15--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé — Appsmith CE utilise une MongoDB embarquée ; aucune instance Cloud SQL n'est provisionnée. |
| `application_database_name` / `application_database_user` | `appsmith` | Non utilisés par Appsmith CE ; conservés uniquement pour la compatibilité des wrappers. |

### Groupe 16 — Charge de travail avec état (PVC) {#group-16--stateful-workload-pvc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Provisionne le PVC par pod qui porte `/appsmith-stacks` (Mongo embarquée, Redis, téléversements, configuration). Sélectionne automatiquement `StatefulSet`. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC. À augmenter pour des bibliothèques de sources de données/d'applications plus volumineuses. |
| `stateful_pvc_mount_path` | `/appsmith-stacks` | Emplacement où tout l'état d'Appsmith est conservé. |
| `stateful_pvc_storage_class` | `""` → valeur par défaut du cluster (SSD `standard-rwo`) | Remplacez par `standard` (HDD) si le quota SSD régional est limité. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Activé par défaut (contrairement à la plupart des modules) — ajoutez un nom d'hôte à `application_domains` pour le router. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

### Groupe 21 — Cloud Armor et Redis {#group-21--cloud-armor--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | À laisser désactivé — Appsmith CE embarque son propre Redis en interne et ne lit pas les variables d'environnement génériques `REDIS_HOST`/`REDIS_URL` que ce paramètre injecterait. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsque le déploiement réussit et constituent le
moyen le plus rapide de localiser et d'explorer les ressources en cours
d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Appsmith. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Vides/sans objet — Appsmith CE n'a pas de base de données Cloud SQL externe (`database_type = NONE`). |
| `storage_buckets` | Buckets Cloud Storage créés (vide sauf si `storage_buckets` est renseigné par l'appelant). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des éventuels jobs de configuration/d'import fournis par l'appelant (vides par défaut). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa
> configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide
> les valeurs *et leurs combinaisons* au moment du plan — un `container_port`
> invalide, un conflit `StatefulSet`/`Deployment`, IAP activé sans identifiants
> OAuth, des `quota_memory_*` donnés sous forme d'entiers nus. Ce module déclare
> aussi son propre garde-fou (`validation.tf`) :
> `min_instance_count ≤ max_instance_count`, IAP exigeant les deux identifiants
> OAuth, `enable_cloudsql_volume` refusé lorsque `database_type = "NONE"`, et
> `enable_redis` exigeant un `redis_host` non vide. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource — mais notez que `max_instance_count > 1` ne fait **pas**
> partie des combinaisons contrôlées (voir ci-dessous).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | Pas bloqué au moment du plan au-dessus de 1, mais chaque pod du StatefulSet reçoit son propre PVC **vide** — un second réplica exécute une MongoDB embarquée divergente et non synchronisée, sans mise en cluster, ce qui rompt l'hypothèse d'une source de vérité unique. |
| `stateful_pvc_enabled` | `true` | Critique | Le désactiver supprime le PVC — tout l'état (Mongo embarquée, Redis, téléversements, configuration des applications connectées à Git) devient éphémère et est perdu au redémarrage/à la replanification du pod. |
| `APPSMITH_ENCRYPTION_PASSWORD` / `APPSMITH_ENCRYPTION_SALT` (générés automatiquement) | Ne jamais modifier après le premier démarrage | Critique | Renouveler l'un ou l'autre indépendamment d'une réinitialisation complète des données rend définitivement illisibles les identifiants de sources de données et les clés SSH Git déjà chiffrés. |
| `database_type` | `NONE` | Critique | Appsmith CE n'a pas d'intégration de base de données externe ; définir un moteur Cloud SQL provisionne une instance inutilisée et n'apporte rien à l'application. |
| `enable_cloudsql_volume` | `false` | Élevé | Bloqué au moment du plan lorsque `database_type = "NONE"` — il n'y a pas d'instance Cloud SQL vers laquelle servir de proxy. |
| `enable_redis` | `false` | Moyen | Appsmith CE embarque Redis en interne et ne lit pas les variables d'environnement génériques `REDIS_HOST`/`REDIS_URL` que ce paramètre injecte — l'activer ajoute des variables d'environnement inertes et, si on le prend à tort pour une vraie dépendance, une fausse confiance dans un cache externe qui n'est pas utilisé. |
| `stateful_pvc_size` | `20Gi` (à augmenter si nécessaire) | Moyen | Un sous-dimensionnement impose plus tard une extension manuelle du PVC ; la Mongo embarquée et les ressources téléversées partagent ce même volume. |
| Délais de `startup_probe_config` | `initial_delay_seconds=120`, `failure_threshold=40` | Moyen | Le conteneur « fat » (Mongo + Redis + Java) démarre lentement ; une fenêtre plus courte peut signaler comme défaillant un pod sain encore en démarrage et déclencher une boucle de redémarrage. |
| `reserve_static_ip` | `true` | Moyen | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et tout domaine personnalisé configuré. |
| `stateful_pvc_storage_class` | `""` (SSD) ou `standard` (HDD) | Faible–Moyen | Le SSD (`standard-rwo`) puise dans le quota régional `SSD_TOTAL_GB`, plus restreint ; remplacez par le HDD `standard` sur les projets limités en quota — une application à pod unique n'a aucun besoin d'IOPS qui exige du SSD. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation réglementaire. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Appsmith (secrets, valeurs d'environnement par défaut, raccordement des
sondes) partagée avec la variante Cloud Run se trouve dans le module
`Appsmith_Common`.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Appsmith sur GKE Autopilot](../labs/Appsmith_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Appsmith Common — Configuration applicative partagée](Appsmith_Common.md) — la configuration partagée par les deux cibles de déploiement.
