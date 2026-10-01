---
title: "Woodpecker CI sur GKE Autopilot"
description: "Référence de configuration pour déployer Woodpecker CI sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Woodpecker_GKE.md @ 944fee5 sha256:f02955c4e52d -->

# Woodpecker CI sur GKE Autopilot {#woodpecker-ci-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Woodpecker_GKE.png" alt="Woodpecker CI sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Woodpecker CI est un moteur CI/CD léger et natif des conteneurs — une alternative à Drone, plus simple et auto-hébergeable. Les pipelines sont définis sous forme de fichiers YAML, et chaque étape d'un pipeline s'exécute dans son propre conteneur. Woodpecker prend en charge GitHub, Gitea, Forgejo, GitLab et Bitbucket en tant que « forges » — le terme qu'emploie Woodpecker pour l'hôte git connecté. Ce module déploie Woodpecker sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

**Il n'existe pas de `Woodpecker_CloudRun`, et il n'y en aura pas.** Le backend d'exécution de Woodpecker (`WOODPECKER_BACKEND=kubernetes`) a besoin d'un véritable accès à l'API Kubernetes pour créer dynamiquement un pod pour chaque étape de pipeline — Cloud Run n'accorde aucun privilège pour docker-in-docker et ne fournit aucune API Kubernetes à appeler. Consultez [Woodpecker_Common](Woodpecker_Common.md) pour l'explication complète ; il s'agit de la même catégorie de limite architecturale que les autres modules **Common + GKE uniquement** de ce catalogue (Kopia, RocketChat, Immich, Temporal, Prowlarr, VictoriaMetrics, Plausible, LobeChat, Supabase).

Ce guide se concentre sur les services cloud qu'utilise Woodpecker et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Woodpecker s'exécute sous la forme d'un **pod unique qui co-localise le serveur et l'agent** dans un seul conteneur, adossé à Cloud SQL PostgreSQL :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un pod exécute à la fois le serveur (API HTTP + interface web) et l'agent (exécuteur des étapes de pipeline), 2 vCPU / 4Gi par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Le serveur migre automatiquement son propre schéma au démarrage ; pas de job de migration distinct |
| Exécution des pipelines | GKE Autopilot, via un `Role` RBAC limité à l'espace de noms | L'agent crée dynamiquement un Pod Kubernetes (ainsi que des PVC/Services/Secrets si nécessaire) pour chaque étape de pipeline, dans le MÊME espace de noms que celui où s'exécute l'agent |
| Secrets | Secret Manager | Un seul secret : `WOODPECKER_AGENT_SECRET`, qui authentifie la connexion gRPC serveur↔agent co-localisés |
| Forge (hôte git) | aucune provisionnée — externe | Valeurs Gitea/Forgejo fictives par défaut ; pointez vers une instance réelle après le déploiement |
| Ingress | Cloud Load Balancing | `LoadBalancer` par défaut ; le déploiement de référence a utilisé `ClusterIP` en raison d'un quota d'IP externes épuisé (voir §6) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Le serveur et l'agent sont co-localisés dans un seul pod, et non deux.** Woodpecker amont livre le serveur et l'agent sous forme de deux images distinctes (docker-compose les exécute comme deux conteneurs). Ce module greffe le binaire de l'agent sur l'image du serveur et le lance en tant que processus d'arrière-plan avant d'exécuter le serveur via `exec` — c'est nécessaire, car le backend Kubernetes de l'agent doit s'exécuter sous le MÊME ServiceAccount Kubernetes que celui qui détient le RBAC élevé accordé par ce module, et le mécanisme générique `additional_services` de GKE n'exécute pas les Deployments sidecar sous le propre ServiceAccount de l'application principale (seul le Deployment principal le fait).
- **L'agent a besoin d'un RBAC élevé au sein du cluster.** Le fichier `woodpecker.tf` de `Woodpecker_GKE` provisionne directement un `kubernetes_role_v1` + `kubernetes_role_binding_v1` limités à l'espace de noms (aucune modification du socle `App_GKE` n'a été nécessaire). Consultez le §3 pour tous les détails.
- **Aucun tag `:latest` n'existe en amont, à dessein.** Vérifié en conditions réelles : `docker run woodpeckerci/woodpecker-server:latest` se contente d'afficher un avis sur le schéma des tags puis s'arrête — une mesure délibérée contre les mises à niveau majeures accidentelles. `application_version = "latest"` est résolu en interne vers une version épinglée `v3.16.0`.
- **Les deux images amont sont réellement distroless.** Vérifié via `docker export` : l'ensemble du système de fichiers racine se compose du seul binaire plus `/etc/passwd,group, hosts` — aucun shell. L'image personnalisée greffe un binaire statique `busybox:musl` (le tag par défaut `busybox:stable` est lié dynamiquement et échoue dans ce système de fichiers racine dépourvu de libc) afin que le point d'entrée cloud puisse s'exécuter.
- **Le serveur exige impérativement une forge pour démarrer.** Vérifié en conditions réelles : omettre la configuration de la forge provoque un arrêt fatal (« forge not configured »), et non une page vide dégradée. Ce module utilise par défaut des valeurs Gitea/Forgejo fictives afin de se déployer proprement ; les déclenchements réels de pipelines nécessitent une véritable forge enregistrée après le déploiement (§6).
- **Instance unique, non négociable.** `max_instance_count` est plafonné à `1` par une validation au moment du plan — chaque pod exécute un serveur et un agent co-localisés, et le serveur de Woodpecker ne dispose d'aucune coordination multi-instances documentée ni vérifiée pour son propre état stocké en base de données.
- **Point de terminaison de santé :** `GET /healthz`, dont il a été vérifié en conditions réelles qu'il renvoie `204 No Content`, sans authentification.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Woodpecker {#a-gke-autopilot--the-woodpecker-workload}

Un seul pod exécute à la fois le serveur et l'agent (Deployment par défaut).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Woodpecker pour voir le pod et les événements.
- **CLI :**
  ```bash
  kubectl get deployment,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour le fonctionnement de la planification Autopilot et de Workload Identity.

### B. Cloud SQL — PostgreSQL 15 {#b-cloud-sql--postgresql-15}

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
```

Aucun job de migration distinct ne s'exécute — vérifié en conditions réelles : le serveur de Woodpecker migre automatiquement son propre schéma au démarrage (« Initializing Schema » apparaît automatiquement face à une base de données vide). Seul un job `db-init` (création du rôle et de la base de données) s'exécute au premier déploiement.

### C. Secret Manager — un seul secret {#c-secret-manager--one-secret}

```bash
gcloud secrets list --project "$PROJECT" --filter="name~agent-secret"
gcloud secrets versions access latest --project "$PROJECT" --secret=<secret-name>
```

`WOODPECKER_AGENT_SECRET` authentifie la connexion gRPC interne entre le serveur et l'agent co-localisés. Consultez
[Woodpecker_Common §2](Woodpecker_Common.md#2-woodpecker_agent_secret--the-one-generated-secret)
pour plus de détails.

### D. RBAC — les autorisations d'exécution des pipelines de l'agent {#d-rbac--the-agents-pipeline-execution-permissions}

```bash
kubectl get role,rolebinding -n "$NAMESPACE"
kubectl describe role <resource-prefix> -n "$NAMESPACE"
```

Un `Role` limité à l'espace de noms accorde `{persistentvolumeclaims, services,
secrets: create, delete}`, `{pods: watch, create, delete, get, list}` et
`{pods/log: get}` — repris du modèle RBAC du chart Helm officiel de Woodpecker, et non deviné. Le sujet du `RoleBinding` est le propre ServiceAccount Kubernetes du pod, lié par son nom. Consultez
[Woodpecker_Common §6](Woodpecker_Common.md#6-kubernetes-execution-backend)
et le §3 ci-dessous pour le mécanisme complet.

### E. Réseau et entrée {#e-networking--ingress}

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

`service_type` vaut par défaut `LoadBalancer` (externe), conformément à la valeur par défaut du socle. Les webhooks de la forge doivent pouvoir atteindre ce serveur depuis Internet pour que les pipelines se déclenchent automatiquement — consultez le §6 pour l'écart `ClusterIP` du déploiement de référence et pour savoir quand revenir à la valeur par défaut.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE sont envoyées vers Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

Un `uptime_check_config` est disponible, désactivé par défaut, ciblant `/healthz`.

---

## 3. Comportement de l'application Woodpecker {#3-woodpecker-application-behaviour}

- **Serveur et agent co-localisés, un seul conteneur.** `entrypoint.sh` lance l'agent en tant que processus d'arrière-plan, puis exécute le serveur au premier plan via `exec` :
  ```sh
  if [ "${1:-}" = "/bin/woodpecker-server" ]; then
    /bin/woodpecker-agent &
  fi
  exec "$@"
  ```
  C'est nécessaire, car le mécanisme générique `additional_services` de GKE exécute un Deployment sidecar sous le ServiceAccount par défaut de l'espace de noms, et non sous le propre ServiceAccount Kubernetes de l'application principale — or le backend Kubernetes de l'agent doit s'exécuter sous l'identité à laquelle le `Role`/`RoleBinding` RBAC ci-dessous accorde effectivement les autorisations.
- **RBAC, lié uniquement par le nom du ServiceAccount.** Vérifié en conditions réelles via `kubectl
  get deployment -o jsonpath='{.spec.template.spec.serviceAccountName}'` : `App_GKE` nomme le KSA du pod d'après le préfixe de ressource **propre au tenant** (par ex. `gkee6a1e84d`), bien que le KSA réside dans le namespace **propre à l'application** (par ex. `woodpeckergkee6a1e84d`). Le sujet du `RoleBinding` utilise ce nom propre au tenant. Cela a nécessité un bloc `provider "kubernetes" {}` dédié (`Woodpecker_GKE/provider-auth.tf`) — la configuration interne du fournisseur Kubernetes d'`App_GKE` est privée à ce module et n'est pas héritée par le module d'application appelant.
- **Les pods de pipeline s'exécutent dans le propre espace de noms de l'agent.** `WOODPECKER_BACKEND_K8S_NAMESPACE` est défini sur l'espace de noms réel du pod, propre à l'application, de sorte que l'autorisation RBAC est un `Role` limité à l'espace de noms, et non un `ClusterRole` à l'échelle du cluster.
- **La configuration de la forge est requise pour démarrer, et pas seulement pour se connecter.** Vérifié en conditions réelles : le serveur s'arrête de façon fatale (« forge not configured ») si aucune forge n'est définie — contrairement à certaines autres applications de ce catalogue (par ex. Outline) qui démarrent sans problème sans aucun fournisseur d'authentification et affichent simplement une page de connexion vide. Des valeurs Gitea/Forgejo fictives (`WOODPECKER_GITEA_URL`, `WOODPECKER_GITEA_CLIENT`, `WOODPECKER_GITEA_SECRET` — de simples variables d'environnement, non adossées à Secret Manager) permettent au module de se déployer proprement d'emblée ; un opérateur doit les remplacer, après le déploiement, par une véritable application OAuth enregistrée sur une instance Gitea/Forgejo réelle.
- **Chemin de santé.** Les deux sondes ciblent `GET /healthz`, dont il a été vérifié en conditions réelles qu'il renvoie `204 No Content`, sans authentification.
- **Ports.** `8000` est le véritable port HTTP (vérifié via `docker inspect`) ; `9000` est la connexion gRPC interne de l'agent au serveur, jamais exposée via le Service Kubernetes puisque les deux processus partagent un même pod.
- **Écrivain unique, instance unique.** `max_instance_count` est plafonné à `1` au moment du plan — le serveur de Woodpecker ne dispose d'aucune coordination multi-instances documentée ni vérifiée pour son propre état stocké en base de données.
- **Les mises à jour recréent le pod.** Une montée de version reconstruit l'image personnalisée (serveur + agent + busybox, greffés à nouveau) et recrée le pod unique.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à Woodpecker ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard. Consultez `modules/Woodpecker_GKE/README.md` pour la référence exhaustive des entrées, groupe par groupe.

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

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `woodpecker` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Résolu en interne vers une version épinglée `v3.16.0` — Woodpecker ne publie aucun tag `latest`. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `display_name` / `description` | (obsolètes, voir §7) | Reliquats de la source Immich dont ce module a été cloné — ne vous fiez pas au texte livré ; les valeurs décrivent la gestion de photos/vidéos, et non Woodpecker CI. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | Limite de CPU du conteneur serveur+agent co-localisés. |
| `memory_limit` | `4Gi` | Limite de mémoire du conteneur serveur+agent co-localisés. |
| `container_port` | `8000` | Vérifié via `docker inspect` de la véritable image taguée `v3`. |
| `min_instance_count` | `1` | |
| `max_instance_count` | `1` | **Plafonné par une validation au moment du plan** — voir §3. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy avec socket Unix. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `forge_url` | `http://forgejo.example.internal` | Valeur fictive. Pointez vers une instance Gitea/Forgejo réelle après le déploiement — voir §6. |
| `forge_client_id` / `forge_client_secret` | `placeholder-client-id` / `placeholder-client-secret` | Identifiants fictifs de l'application OAuth. |
| `admin_username` | `admin` | Nom(s) d'utilisateur de la forge auxquels sont accordés les droits d'administration de Woodpecker à la première connexion. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires en texte clair, fusionnés par-dessus les valeurs par défaut de forge/backend du module. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées comme variables d'environnement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Le déploiement de référence a utilisé `ClusterIP` en raison d'un quota épuisé — voir §6. |
| `workload_type` | `null` | Se résout toujours en `Deployment` pour ce module (aucun cas d'usage de `stateful_pvc_enabled`). |
| `termination_grace_period_seconds` | `60` | Nombre de secondes entre SIGTERM et SIGKILL. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé par ce module — l'état de Woodpecker réside entièrement dans Cloud SQL, et il n'existe aucun état de système de fichiers propre à un pod à conserver via un PVC.

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthz` | Vérifié en conditions réelles : `204 No Content`, sans authentification. |
| `uptime_check_config` | désactivé | S'il est activé, cible `/healthz`. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | La valeur par défaut vide se résout vers l'unique job `db-init` de `Woodpecker_Common` — Woodpecker migre son propre schéma au démarrage, il n'existe donc pas de job de migration distinct. |
| `cron_jobs` | `[]` | CronJobs Kubernetes. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut. Woodpecker CI n'a pas de médiathèque et aucun usage fonctionnel de NFS. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `data` par défaut — inutilisé par Woodpecker. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `woodpecker_db` | |
| `db_user` | `woodpecker_user` | |
| `database_type` | fixé à `POSTGRES_15` par `Woodpecker_Common` | Copie inerte sur la propre variable `database_type` de ce module. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway pour un nom d'hôte personnalisé. |
| `reserve_static_ip` | `true` | Le déploiement de référence a utilisé `false` en raison d'un quota épuisé — voir §6. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Nécessite un domaine personnalisé et les deux identifiants OAuth, validés au moment du plan. |

### Groupe 21 — Redis et Cloud Armor {#group-21--redis--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Non confirmé comme fonctionnellement requis** — le point d'entrée de `Woodpecker_Common` ne lit jamais `REDIS_HOST`/`REDIS_PORT`. Voir §7. |

### Groupes 8, 9, 12, 17, 18, 22 {#groups-8-9-12-17-18-22}

Comportement standard d'`App_GKE` — Resource Quota, Reliability Policies, CI/CD et Binary Authorization, sauvegarde et maintenance, Custom SQL (non applicable), VPC Service Controls. Consultez [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP / IP externe du LoadBalancer (lorsqu'elle est réservée). |
| `web_url` | Lit `additional_service_urls["web"]` — **se résout en `null`** sur un déploiement standard, puisqu'aucun service supplémentaire `"web"` n'est câblé par défaut. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` / `database_host` / `database_port` | Identité Cloud SQL et informations de connexion. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `data` par défaut — inutilisé). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (le `db-init` par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs et leurs
> combinaisons au moment du plan. Le fichier `validation.tf` propre à
> `Woodpecker_GKE` rejette en outre `max_instance_count > 1` et
> `enable_iap = true` sans les deux identifiants OAuth.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Configuration de la forge (`forge_url`/`forge_client_id`/`forge_client_secret`) | Remplacez les trois, après le déploiement, par une véritable application OAuth enregistrée sur une instance Gitea/Forgejo réelle | **High** | Le serveur démarre et se déclare en bonne santé avec les valeurs fictives, mais les pipelines ne se déclenchent jamais et la connexion via la forge ne fonctionne jamais — un déploiement qui semble fonctionner mais qui n'est pas réellement utilisable pour la CI. |
| `service_type` / `reserve_static_ip` | `LoadBalancer` / `true` dès que le quota d'IP externes le permet | **High** | Le déploiement de référence a utilisé `ClusterIP` / `false` uniquement parce que le quota `IN_USE_ADDRESSES` du projet de test était épuisé. Les webhooks de la forge (événements push/PR) doivent pouvoir atteindre ce serveur depuis Internet — un déploiement `ClusterIP` ne peut pas les recevoir et les pipelines ne se déclencheront pas automatiquement. |
| `max_instance_count` | `1` (imposé au moment du plan) | **Critical** | Chaque pod exécute un serveur et un agent co-localisés ; plus d'un réplica exécuterait plusieurs serveurs sur la même base de données sans coordination vérifiée. |
| Sondes de santé | Conserver HTTP `/healthz` (valeur par défaut du module) | **Medium** | Il est vérifié que `/healthz` ne requiert pas d'authentification et renvoie `204` ; pointer une sonde vers un point de terminaison authentifié bloquerait le déploiement progressif. |
| `enable_nfs` | Conserver `false` | **Low** | Correct par défaut. Le définir à `true` provisionne dans le pod un montage NFS inutilisé, sans effet fonctionnel, et qui n'est pas gratuit. |
| `enable_redis` | Conserver la valeur par défaut ; non confirmé comme requis | **Low** | La description affirme que Redis est « REQUIRED », mais le point d'entrée de `Woodpecker_Common` ne lit jamais `REDIS_HOST`/`REDIS_PORT` — il semble s'agir d'un reliquat inerte de la source dont le module a été cloné, et non d'un comportement vérifié de Woodpecker CI. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Woodpecker est décrite dans **[Woodpecker_Common](Woodpecker_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Woodpecker CI sur GKE Autopilot](../labs/Woodpecker_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Woodpecker Common — Configuration applicative partagée](Woodpecker_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) et [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Source Control & CI/CD**.
