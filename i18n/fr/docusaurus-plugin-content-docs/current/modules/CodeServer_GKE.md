---
title: "code-server sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de code-server sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CodeServer_GKE.md @ 15fd4c7 sha256:73298292cee5 -->

# code-server sur GKE Autopilot {#code-server-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_GKE.png" alt="code-server sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server est la version open-source (MIT) de Visual Studio Code de Coder qui
s'exécute sur un serveur distant et est entièrement accessible via le navigateur
— un IDE complet avec la marketplace d'extensions VS Code, un terminal intégré
et des serveurs de langage, soutenu par un espace de travail persistant. Ce
module déploie code-server sur **GKE Autopilot** sur la base de
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par code-server et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de base App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

code-server s'exécute comme une charge de travail web autonome unique écoutant
sur le port **8080**. Contrairement aux applications basées sur une base de
données, il relie un ensemble délibérément minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod unique sur le port **8080** ; 1 vCPU / 1 Gio par défaut |
| Espace de travail persistant | Persistent Disk (PVC de bloc) **ou** Cloud Storage (GCS FUSE) | Monté à `/home/coder` ; PVC de bloc par défaut (`stateful_pvc_enabled = true`) |
| Base de données | _Aucune_ | `database_type = NONE` — code-server n'a pas de base de données SQL |
| Cache et file d'attente | _Aucun_ | Redis est explicitement désactivé (`enable_redis = false`) |
| Secrets | Secret Manager | `PASSWORD` de l'éditeur auto-généré (quand `enable_password = true`), livré via SecretSync |
| Ingress | Cloud Load Balancing | **Par défaut `service_type = ClusterIP`** — intra-cluster uniquement ; optez pour une exposition externe |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données et pas de Redis.** code-server est un conteneur
  unique ; tout l'état réside dans le volume de l'espace de travail. `database_type` est
  fixé à `NONE` et Redis est désactivé.
- **Le type de service est `ClusterIP` par défaut.** La charge de travail n'est
  accessible qu'à l'intérieur du cluster. Définissez `service_type = LoadBalancer` (ou activez un
  domaine personnalisé) pour un accès externe via le navigateur.
- **Deux modes de stockage de l'espace de travail.** Par défaut (`stateful_pvc_enabled = true`),
  l'espace de travail est un **PVC de bloc StatefulSet** à `/home/coder`, et le
  wrapper désactive le volume GCS pour éviter un double montage. Gardez-le
  activé : l'installation d'une extension échoue sur GCS FUSE, car code-server
  renomme un répertoire et gcsfuse ne peut pas renommer les répertoires.
- **Un `PASSWORD` d'éditeur aléatoire est généré automatiquement** et stocké dans
  Secret Manager, puis livré dans le pod via SecretSync en tant que variable
  d'environnement `PASSWORD` pour protéger la page de connexion. `PASSWORD` est un
  `targetKey` SecretSync valide (pas de `__`/séparateurs consécutifs).
- **Réplica unique par conception.** `min_instance_count = max_instance_count = 1`. code-server conserve l'état de
  l'éditeur par session en mémoire et possède un volume d'espace de travail.
- **`fsGroup = 3000`** est défini sur le contexte de sécurité du StatefulSet afin que le
  PVC de bloc soit accessible en écriture par le groupe du processus code-server
  (qui s'exécute en tant que UID 1000 / GID 2000).
- **L'image est un wrapper léger sur `codercom/code-server`**, construite et mise en miroir
  dans Artifact Registry via Cloud Build ; `latest` est épinglé à `4.99.1` au moment
  de la construction.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que `PROJECT`,
`REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont
indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail code-server {#a-gke-autopilot--the-code-server-workload}

code-server s'exécute comme un pod unique sur Autopilot (un StatefulSet par
défaut, car `stateful_pvc_enabled = true` ; un Deployment lorsque le PVC est désactivé). Autopilot
facture le CPU/la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail code-server pour voir le pod, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP de ClusterIP / IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et
le type de charge de travail (Deployment vs StatefulSet) sont gérés.

### B. Stockage de l'espace de travail — GCS FUSE ou Persistent Disk {#b-workspace-storage--gcs-fuse-or-persistent-disk}

La ressource unique avec état, montée à `/home/coder` :

- **PVC de bloc (par défaut, `stateful_pvc_enabled = true`).** Un PVC de **Persistent Disk** par pod
  (`standard-rwo` par défaut, `20Gi`) est monté à `/home/coder`, et le volume GCS est désactivé
  pour éviter un double montage.
- **GCS FUSE (`stateful_pvc_enabled = false`).** Un bucket **Cloud Storage** dédié est monté via le
  pilote CSI à `/home/coder` à la place. L'installation d'extensions échoue sur celui-ci.

```bash
# GCS FUSE workspace bucket:
gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
# Block PVC (when enabled):
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE" <pvc-name>
```

Voir [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les détails du PVC
StatefulSet.

### C. Secret Manager — le mot de passe de l'éditeur {#c-secret-manager--the-editor-password}

Lorsque `enable_password = true` (par défaut), un `PASSWORD` aléatoire de 24 caractères est généré et
stocké dans Secret Manager, puis synchronisé dans le pod en tant que variable
d'environnement `PASSWORD` via SecretSync pour protéger la page de connexion. Il n'y
a pas de mot de passe de base de données (pas de base de données).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Confirm the env var reached the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -c PASSWORD
  ```

L'ID du secret est affiché en tant que sortie `codeserver_password_secret_id`. Voir
[App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Le service est par défaut **`ClusterIP`** — intra-cluster uniquement. Pour un accès
externe via le navigateur, définissez `service_type = LoadBalancer`, ou activez un domaine personnalisé
(`enable_custom_domain`, `true` par défaut) avec un certificat géré par Google via l'API Gateway.
Une IP statique est réservée par défaut (`reserve_static_ip = true`) afin que l'adresse survive aux
redéploiements.

> **Problème ouvert connu.** La campagne de vérification GKE à l'échelle de la
> flotte de CLAUDE.md (16/07/2026) a trouvé et corrigé un bogue récurrent de
> copier-coller où `service_type` était par défaut `ClusterIP` sur les applications avec une
> véritable interface utilisateur — la valeur par défaut correcte pour toute
> application avec une interface utilisateur est `LoadBalancer` (`ClusterIP` n'est correct que
> pour les applications véritablement internes comme Qdrant, PhpMyAdmin ou le
> frontend gRPC de Temporal). CodeServer est un IDE de navigateur, pas une de
> ces applications conçues pour être internes, et la mémoire de session
> (`gke-service-type-fleet-wide-copy-paste-bug`) l'enregistre comme étant restée sur la liste en attente/non corrigée
> à partir de cette même campagne — donc traitez la valeur par défaut `ClusterIP` ici
> comme un problème en suspens, pas un choix délibéré de sécurité par défaut. La
> route Gateway par défaut `enable_custom_domain = true` expose toujours l'application en externe même
> avec un service `ClusterIP`, c'est pourquoi cela n'a pas été un bloqueur majeur en
> pratique, mais cela signifie que le service *brut* n'est pas accessible sans
> passer par la Gateway.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE sont acheminées vers Cloud Monitoring. Des vérifications de
disponibilité et des politiques d'alerte optionnelles sont disponibles (une
vérification de disponibilité nécessite un point de terminaison externe
accessible).

- **Console :** Journalisation → Explorateur de journaux ; Surveillance →
  Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application code-server {#3-code-server-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.**
  code-server n'a pas de base de données SQL et pas de job d'initialisation. Le
  pod démarre dès que le conteneur se lie à `0.0.0.0:8080` (défini via `BIND_ADDR`).
- **Pas de migrations.** La mise à niveau de `application_version` déploie un nouveau pod sur
  la nouvelle image ; il n'y a pas de schéma à migrer.
- **L'espace de travail est le seul état durable.** Tout ce qui se trouve sous
  `/home/coder` — dossiers ouverts, `settings.json`, raccourcis clavier et extensions installées
  — persiste sur le bucket GCS FUSE ou le PVC de bloc. Le supprimer efface
  l'espace de travail.
- **La connexion est protégée par le secret `PASSWORD`.** Avec `enable_password = true`, l'éditeur
  demande le mot de passe fourni par SecretSync (§2C). S'il est désactivé,
  toute personne atteignant le service obtient un IDE non authentifié — ne
  l'exécutez ainsi que derrière `ClusterIP`.
- **Chemin de santé.** Les sondes de démarrage/vivacité de la variante GKE sont
  par défaut `/health` ; lorsqu'un mot de passe est activé, remplacez le chemin par
  le chemin non authentifié `/healthz` (qui renvoie `200` sans authentification),
  car `/health` renvoie `401` et ferait échouer la sonde. Inspectez le pod en
  cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep BIND_ADDR
  ```
- **Mise à l'échelle à réplica unique.** Gardez `min = max = 1`. Les sessions de
  l'éditeur sont en mémoire et le volume de l'espace de travail a un seul
  rédacteur. Avec un PVC de bloc, `stateful_pod_management_policy` est par défaut `OrderedReady` pour des
  redémarrages sûrs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
code-server sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `codeserver` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image code-server ; `latest` est épinglé à `4.99.1` au moment de la construction. Épinglez une version en production. |
| `enable_password` | `true` | Génère un `PASSWORD` d'éditeur aléatoire et le demande à la connexion. **Laissez activé pour tout déploiement exposé en externe.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; augmentez pour les serveurs de langage lourds. |
| `memory_limit` | `1Gi` | Mémoire par pod ; dimensionnez en fonction des espaces de travail et des extensions que vous exécutez. |
| `min_instance_count` | `1` | Gardez à 1 — éditeur à instance unique. GKE ne met pas à l'échelle à zéro. |
| `max_instance_count` | `1` | Gardez à 1 — un volume d'espace de travail, session en mémoire. |
| `enable_cloudsql_volume` | `false` | code-server n'a pas de Cloud SQL — gardez false. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image code-server dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Intra-cluster par défaut. Définissez `LoadBalancer` pour un accès externe via le navigateur. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` ; sinon `Deployment`. |
| `session_affinity` | `None` | Le routage persistant est inutile pour un éditeur à réplica unique. |
| `namespace_name` | `""` | Auto-généré à partir de `application_name` + `tenant_id` lorsqu'il est vide. |
| `termination_grace_period_seconds` | `60` | Permet à code-server de vider les écritures en cours avant SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Définissez `true` pour monter un PVC de bloc à `/home/coder` (recommandé pour les grands espaces de travail) ; sélectionne automatiquement StatefulSet et désactive le volume GCS. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; contient tous les fichiers de l'espace de travail plus les frais généraux. |
| `stateful_pvc_mount_path` | `/home/coder` | Chemin de montage de l'espace de travail. |
| `stateful_pvc_storage_class` | `standard-rwo` | Valeur par défaut Balanced PD ; utilisez `premium-rwo` pour des IOPS plus élevées. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` recommandé pour des redémarrages sûrs. |
| `stateful_fs_group` | `3000` | `fsGroup` au niveau du pod afin que le PVC soit accessible en écriture par le groupe (code-server s'exécute en tant que UID 1000 / GID 2000). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 15s de délai | Sonde de démarrage. Remplacez `path` par `/healthz` lorsqu'un mot de passe est activé. |
| `liveness_probe` | HTTP `/health` 30s de délai | Sonde de vivacité. Remplacez `path` par `/healthz` lorsqu'un mot de passe est activé. |
| `uptime_check_config` | `{ enabled = false, path = "/health" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut (nécessite un point de terminaison externe). |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; l'espace de travail utilise GCS FUSE ou un PVC de bloc, pas NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | _(forcé `false`)_ | Non applicable à code-server ; le wrapper remplace la valeur par défaut App_GKE de `true`. |
| `redis_auth` | `""` | Non applicable ; transmis à la fondation pour compatibilité. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `codeserverdb` | Non référencé — code-server n'a pas de base de données SQL ; transmis pour compatibilité. |
| `db_user` | `codeserveruser` | Non référencé — transmis pour compatibilité. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Gateway API Ingress + certificat géré pour les noms d'hôtes personnalisés. |
| `application_domains` | `[]` | Noms d'hôtes à servir (par exemple `codeserver.example.com`). |
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |

Toutes les autres entrées suivent le comportement standard de App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre code-server. |
| `codeserver_password_secret_id` | ID du secret Secret Manager contenant le mot de passe de l'éditeur (vide lorsque `enable_password = false`). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de l'espace de travail). |
| `statefulset_name` | Nom du StatefulSet (lorsqu'un PVC de bloc est activé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de base [App_GKE](App_GKE.md), qui valide les valeurs
> *et les combinaisons* au moment de la planification — `workload_type = "Deployment"` avec `stateful_pvc_enabled = true`,
> IAP sans identités autorisées, une valeur `quota_memory_*` entière brute, une valeur
> `timeout_seconds` hors de portée. Une configuration invalide fait échouer la
> **planification** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_password` | `true` (garder activé pour l'exposition externe) | Critique | La désactivation avec `service_type = LoadBalancer` (ou un domaine personnalisé) expose un IDE entièrement non authentifié — y compris un terminal — à Internet. |
| Volume de l'espace de travail (bucket / PVC) | Ne jamais supprimer | Critique | Le bucket GCS `/home/coder` ou le PVC est le seul état persistant ; sa suppression efface tous les paramètres, extensions et fichiers. |
| Chemin `startup_probe` / `liveness_probe` | `/healthz` lorsqu'un mot de passe est défini | Élevé | La valeur par défaut GKE `/health` renvoie `401` sous un mot de passe ; le pod ne devient jamais prêt et redémarre en boucle. |
| `stateful_pvc_enabled` + `workload_type` | Ne pas définir `Deployment` avec PVC activé | Élevé | La combinaison est rejetée au moment de la planification ; le PVC nécessite un StatefulSet. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 divise les sessions de l'éditeur entre les pods et risque des écritures concurrentes sur un seul volume d'espace de travail. |
| `stateful_fs_group` | `3000` (non nul) | Élevé | La définition de `0` laisse `fsGroup` non défini ; le PVC de bloc peut être détenu par root et code-server (UID 1000) ne peut pas écrire sur `/home/coder`. |
| `service_type` | `ClusterIP` (ou LoadBalancer + mot de passe) | Élevé | `LoadBalancer` sans mot de passe publie un IDE ouvert ; `ClusterIP` bloque tout accès externe via le navigateur. |
| `enable_cloudsql_volume` | `false` | Faible | code-server n'a pas de base de données ; l'activation ajoute un side-car Auth Proxy inutilisé. |
| `memory_limit` | `1Gi`+ | Moyen | Les serveurs/extensions de langage lourds peuvent provoquer des OOM en dessous de 1 Gio. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de base référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à
code-server partagée avec la variante Cloud Run est décrite dans
**[CodeServer_Common](CodeServer_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : code-server sur GKE Autopilot](../labs/CodeServer_GKE.md) —
  déployez-le étape par étape, avec les écrans de la console et les commandes à
  chaque étape.
- [code-server sur Google Cloud Run](CodeServer_CloudRun.md) — la même
  application sur Cloud Run, lorsque vous avez besoin de l'autre cible de
  déploiement.
- [CodeServer Common — Configuration d'application partagée](CodeServer_Common.md)
  — la configuration partagée par les deux cibles de déploiement.
