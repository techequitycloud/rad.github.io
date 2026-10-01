---
title: "code-server sur GKE Autopilot"
description: "Référence de configuration pour déployer code-server sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CodeServer_GKE.md @ 3055034 sha256:99e4d4a09a2d -->

# code-server sur GKE Autopilot {#code-server-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_GKE.png" alt="code-server sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server est la version open source (MIT) de Visual Studio Code proposée par Coder,
qui s'exécute sur un serveur distant et s'utilise entièrement depuis le navigateur —
un IDE complet avec la place de marché des extensions VS Code, un terminal intégré et
des serveurs de langage, adossé à un espace de travail persistant. Ce module déploie
code-server sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise code-server et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

code-server s'exécute comme une unique charge de travail web autonome à l'écoute sur
le port **8080**. Contrairement aux applications adossées à une base de données, il
assemble un ensemble volontairement minimal de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod sur le port **8080** ; 1 vCPU / 1 GiB par défaut |
| Espace de travail persistant | Cloud Storage (GCS FUSE) **ou** Persistent Disk (PVC bloc) | Monté sur `/home/coder` ; PVC bloc lorsque `stateful_pvc_enabled = true` |
| Base de données | _Aucune_ | `database_type = NONE` — code-server n'a pas de base SQL |
| Cache et file d'attente | _Aucun_ | Redis est explicitement désactivé (`enable_redis = false`) |
| Secrets | Secret Manager | `PASSWORD` de l'éditeur généré automatiquement (lorsque `enable_password = true`), fourni via SecretSync |
| Entrée | Cloud Load Balancing | **`service_type = ClusterIP` par défaut** — interne au cluster uniquement ; l'exposition externe doit être activée explicitement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données ni de Redis.** code-server est un conteneur unique ; tout
  l'état réside dans le volume de l'espace de travail. `database_type` est fixé à
  `NONE` et Redis est désactivé.
- **Le type de service est `ClusterIP` par défaut.** La charge de travail n'est
  accessible qu'à l'intérieur du cluster dès l'installation. Définissez
  `service_type = LoadBalancer` (ou activez un domaine personnalisé) pour un accès
  externe par navigateur.
- **Deux modes de stockage de l'espace de travail.** Par défaut, l'espace de travail
  est un volume **GCS FUSE** sur `/home/coder`. Définir `stateful_pvc_enabled = true`
  bascule vers un **PVC bloc de StatefulSet** sur `/home/coder` (E/S à plus faible
  latence pour les grands espaces de travail) ; la surcouche désactive alors
  automatiquement le volume GCS pour éviter un double montage.
- **Un `PASSWORD` d'éditeur aléatoire est généré automatiquement** et stocké dans
  Secret Manager, puis fourni au pod via SecretSync comme variable d'environnement
  `PASSWORD`. `PASSWORD` est une `targetKey` SecretSync valide (pas de `__` ni de
  séparateurs consécutifs).
- **Réplica unique par conception.** `min_instance_count = max_instance_count = 1`.
  code-server conserve en mémoire l'état des sessions de l'éditeur et possède un seul
  volume d'espace de travail.
- **`fsGroup = 3000`** est défini dans le contexte de sécurité du StatefulSet afin
  que le PVC bloc soit accessible en écriture au groupe par le processus code-server
  (qui s'exécute en UID 1000 / GID 2000).
- **L'image est une fine surcouche de `codercom/code-server`**, construite et
  répliquée dans Artifact Registry via Cloud Build ; `latest` est épinglé à `4.99.1`
  au moment du build.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail code-server {#a-gke-autopilot--the-code-server-workload}

code-server s'exécute comme un pod unique sur Autopilot (un Deployment par défaut, ou
un StatefulSet lorsque `stateful_pvc_enabled = true` / `workload_type = StatefulSet`).
Autopilot facture le CPU et la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  code-server pour voir le pod, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche la ClusterIP / l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl get statefulset,pvc -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Stockage de l'espace de travail — GCS FUSE ou Persistent Disk {#b-workspace-storage--gcs-fuse-or-persistent-disk}

La seule ressource stateful, montée sur `/home/coder` :

- **GCS FUSE (par défaut).** Un bucket **Cloud Storage** dédié est provisionné et
  monté via le pilote CSI sur `/home/coder`.
- **PVC bloc (`stateful_pvc_enabled = true`).** Un PVC **Persistent Disk** par pod
  (`standard-rwo` par défaut, `20Gi`) est monté sur `/home/coder` à la place, et le
  volume GCS est désactivé pour éviter un double montage.

```bash
# GCS FUSE workspace bucket:
gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
# Block PVC (when enabled):
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE" <pvc-name>
```

Consultez [App_GKE](App_GKE.md) pour les options CMEK, GCS FUSE et les détails du PVC
de StatefulSet.

### C. Secret Manager — le mot de passe de l'éditeur {#c-secret-manager--the-editor-password}

Lorsque `enable_password = true` (valeur par défaut), un `PASSWORD` aléatoire de
24 caractères est généré et stocké dans Secret Manager, puis synchronisé dans le pod
comme variable d'environnement `PASSWORD` via SecretSync pour protéger la page de
connexion. Il n'y a pas de mot de passe de base de données (pas de base de données).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  # Confirm the env var reached the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -c PASSWORD
  ```

L'ID du secret est exposé dans l'output `codeserver_password_secret_id`. Consultez
[App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le Service vaut **`ClusterIP`** par défaut — interne au cluster uniquement. Pour un
accès externe par navigateur, définissez `service_type = LoadBalancer`, ou activez un
domaine personnalisé (`enable_custom_domain`, `true` par défaut) avec un certificat
géré par Google via la Gateway API. Une IP statique est réservée par défaut
(`reserve_static_ip = true`) afin que l'adresse survive aux redéploiements.

> **Point ouvert connu.** La campagne de vérification GKE à l'échelle de la flotte
> menée dans CLAUDE.md (2026-07-16) a détecté et corrigé un bug récurrent de
> copier-coller où `service_type` valait `ClusterIP` par défaut sur des applications
> dotées d'une véritable interface — la bonne valeur par défaut pour toute
> application dotée d'une interface est `LoadBalancer` (`ClusterIP` n'est correct
> que pour des applications réellement internes comme Qdrant, PhpMyAdmin ou le
> frontal gRPC de Temporal). CodeServer est un IDE dans le navigateur, et non l'une
> de ces applications internes par conception, et la mémoire de session
> (`gke-service-type-fleet-wide-copy-paste-bug`) indique qu'il est resté sur la liste
> des éléments en attente/non corrigés à l'issue de cette même campagne — considérez
> donc la valeur par défaut `ClusterIP` ici comme un problème en suspens, et non
> comme un choix délibéré de sécurité par défaut. La route Gateway par défaut
> `enable_custom_domain = true` expose tout de même l'application à l'extérieur, même
> avec un Service `ClusterIP`, ce qui explique pourquoi cela n'a pas été bloquant en
> pratique ; cela signifie toutefois que le Service *brut* n'est pas accessible sans
> passer par la Gateway.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles d'alerte
facultatifs sont disponibles (un test de disponibilité nécessite un point de
terminaison externe accessible).

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application code-server {#3-code-server-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** code-server n'a
  ni base SQL ni job d'initialisation. Le pod est disponible dès que le conteneur se
  lie à `0.0.0.0:8080` (défini via `BIND_ADDR`).
- **Aucune migration.** Mettre à niveau `application_version` déploie un nouveau pod
  sur l'image plus récente ; il n'y a aucun schéma à migrer.
- **L'espace de travail est le seul état durable.** Tout ce qui se trouve sous
  `/home/coder` — dossiers ouverts, `settings.json`, raccourcis clavier et extensions
  installées — est conservé sur le bucket GCS FUSE ou le PVC bloc. Le supprimer efface
  l'espace de travail.
- **La connexion est protégée par le secret `PASSWORD`.** Avec
  `enable_password = true`, l'éditeur demande le mot de passe fourni par SecretSync
  (§2C). S'il est désactivé, quiconque atteint le Service obtient un IDE sans
  authentification — ne l'exécutez ainsi que derrière `ClusterIP`.
- **Chemin de santé.** Les sondes de démarrage/vivacité de la variante GKE ciblent
  `/health` par défaut ; lorsqu'un mot de passe est activé, remplacez le chemin par le
  point de terminaison non authentifié `/healthz` (qui renvoie `200` sans
  authentification), car `/health` renvoie `401` et ferait échouer la sonde.
  Inspectez le pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep BIND_ADDR
  ```
- **Mise à l'échelle à réplica unique.** Conservez `min = max = 1`. Les sessions de
  l'éditeur sont en mémoire et le volume de l'espace de travail n'a qu'un seul
  écrivain. Avec un PVC bloc, `stateful_pod_management_policy`
  vaut `OrderedReady` par défaut pour des redémarrages sûrs.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à code-server ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `codeserver` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image code-server ; `latest` est épinglé à `4.99.1` au moment du build. Épinglez une version en production. |
| `enable_password` | `true` | Génère un `PASSWORD` d'éditeur aléatoire et l'exige à la connexion. **Laissez-le activé pour tout déploiement exposé à l'extérieur.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par pod ; augmentez-le pour des serveurs de langage gourmands. |
| `memory_limit` | `1Gi` | Mémoire par pod ; dimensionnez-la selon les espaces de travail et les extensions que vous utilisez. |
| `min_instance_count` | `1` | Laissez à 1 — éditeur à instance unique. GKE ne descend pas à zéro. |
| `max_instance_count` | `1` | Laissez à 1 — un seul volume d'espace de travail, session en mémoire. |
| `enable_cloudsql_volume` | `false` | code-server n'a pas de Cloud SQL — laissez à false. |
| `enable_image_mirroring` | `true` | Met en miroir l'image code-server dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interne au cluster par défaut. Définissez `LoadBalancer` pour un accès externe par navigateur. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet` lorsque `stateful_pvc_enabled = true` ; sinon en `Deployment`. |
| `session_affinity` | `None` | Le routage persistant (sticky) est inutile pour un éditeur à réplica unique. |
| `namespace_name` | `""` | Généré automatiquement à partir de `application_name` + `tenant_id` lorsqu'il est vide. |
| `termination_grace_period_seconds` | `60` | Laisse à code-server le temps de vider les écritures en cours avant le SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour monter un PVC bloc sur `/home/coder` (recommandé pour les grands espaces de travail) ; sélectionne automatiquement un StatefulSet et désactive le volume GCS. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod ; doit contenir tous les fichiers de l'espace de travail plus une marge. |
| `stateful_pvc_mount_path` | `/home/coder` | Chemin de montage de l'espace de travail. |
| `stateful_pvc_storage_class` | `standard-rwo` | Balanced PD par défaut ; utilisez `premium-rwo` pour davantage d'IOPS. |
| `stateful_pod_management_policy` | `null` | `OrderedReady` recommandé pour des redémarrages sûrs. |
| `stateful_fs_group` | `3000` | `fsGroup` au niveau du pod afin que le PVC soit accessible en écriture au groupe (code-server s'exécute en UID 1000 / GID 2000). |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 15 s | Sonde de démarrage. Remplacez `path` par `/healthz` lorsqu'un mot de passe est activé. |
| `liveness_probe` | HTTP `/health`, délai de 30 s | Sonde de vivacité. Remplacez `path` par `/healthz` lorsqu'un mot de passe est activé. |
| `uptime_check_config` | `{ enabled = false, path = "/health" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut (nécessite un point de terminaison externe). |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; l'espace de travail utilise GCS FUSE ou un PVC bloc, et non NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | _(forcé à `false`)_ | Sans objet pour code-server ; la surcouche remplace la valeur par défaut `true` d'App_GKE. |
| `redis_auth` | `""` | Sans objet ; transmise au socle pour compatibilité. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `codeserverdb` | Non utilisée — code-server n'a pas de base SQL ; transmise pour compatibilité. |
| `db_user` | `codeserveruser` | Non utilisée — transmise pour compatibilité. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une entrée Gateway API + un certificat géré pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte à servir (par ex. `codeserver.example.com`). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre code-server. |
| `codeserver_password_secret_id` | ID du secret Secret Manager contenant le mot de passe de l'éditeur (vide lorsque `enable_password = false`). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de l'espace de travail). |
| `statefulset_name` | Nom du StatefulSet (lorsqu'un PVC bloc est activé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — `workload_type = "Deployment"` avec `stateful_pvc_enabled = true`, IAP sans identité autorisée, une valeur `quota_memory_*` en entier brut, un `timeout_seconds` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_password` | `true` (à conserver en cas d'exposition externe) | Critique | Le désactiver avec `service_type = LoadBalancer` (ou un domaine personnalisé) expose à internet un IDE entièrement non authentifié — terminal compris. |
| Volume de l'espace de travail (bucket / PVC) | Ne jamais le supprimer | Critique | Le bucket GCS ou le PVC de `/home/coder` est le seul état persistant ; le supprimer efface tous les paramètres, extensions et fichiers. |
| Chemin de `startup_probe` / `liveness_probe` | `/healthz` lorsqu'un mot de passe est défini | Élevé | La valeur par défaut GKE `/health` renvoie `401` avec un mot de passe ; le pod ne devient jamais Ready et redémarre en boucle. |
| `stateful_pvc_enabled` + `workload_type` | Ne définissez pas `Deployment` avec le PVC activé | Élevé | La combinaison est rejetée au moment du plan ; le PVC nécessite un StatefulSet. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 répartit les sessions de l'éditeur entre pods et expose à des écritures concurrentes sur un unique volume d'espace de travail. |
| `stateful_fs_group` | `3000` (non nul) | Élevé | La valeur `0` laisse `fsGroup` non défini ; le PVC bloc peut appartenir à root et code-server (UID 1000) ne peut pas écrire dans `/home/coder`. |
| `service_type` | `ClusterIP` (ou LoadBalancer + mot de passe) | Élevé | `LoadBalancer` sans mot de passe publie un IDE ouvert ; `ClusterIP` bloque tout accès externe par navigateur. |
| `enable_cloudsql_volume` | `false` | Faible | code-server n'a pas de base de données ; l'activer ajoute un sidecar Auth Proxy inutile. |
| `memory_limit` | `1Gi`+ | Moyen | Des serveurs de langage ou des extensions gourmands peuvent provoquer un OOM en dessous de 1 GiB. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers bruts sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à code-server et
partagée avec la variante Cloud Run est décrite dans
**[CodeServer_Common](CodeServer_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : code-server sur GKE Autopilot](../labs/CodeServer_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [code-server sur Google Cloud Run](CodeServer_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [CodeServer Common — Configuration applicative partagée](CodeServer_Common.md) — la configuration partagée par les deux cibles de déploiement.
