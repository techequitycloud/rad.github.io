---
title: "Hermes Agent sur GKE Autopilot"
description: "Référence de configuration pour déployer Hermes Agent sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Hermes_GKE.md @ 3055034 sha256:aa6a64f3e923 -->

# Hermes Agent sur GKE Autopilot {#hermes-agent-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Hermes_GKE.png" alt="Hermes Agent sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Hermes Agent est l'agent d'IA personnel open source (sous licence MIT),
auto-hébergé et auto-améliorant de Nous Research : il apprend des compétences par
l'expérience, conserve une mémoire d'une session à l'autre, et se connecte à des
plateformes de messagerie ainsi qu'à une API compatible OpenAI depuis un unique
processus de passerelle
([documentation](https://hermes-agent.nousresearch.com/docs/)). Ce module déploie
l'image officielle `nousresearch/hermes-agent` sur **GKE Autopilot** au-dessus du
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Hermes et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Hermes s'exécute sous la forme d'un pod de passerelle à réplica unique sur GKE
Autopilot. Le déploiement assemble un ensemble délibérément restreint de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod de passerelle, 2 vCPU / 2 GiB par défaut, réplicas `min=1` / `max=1` |
| État de l'agent | NFS autogéré (Services_GCP) | Monté sur `/opt/data` — configuration SQLite, sessions, compétences, mémoires. **Pas de Cloud SQL** |
| Secrets | Secret Manager (+ SecretSync) | `ANTHROPIC_API_KEY`, `API_SERVER_KEY` et mot de passe du tableau de bord générés automatiquement, `OPENAI_API_KEY` / `TELEGRAM_BOT_TOKEN` facultatifs |
| Image de conteneur | Artifact Registry (miroir) | Image préconstruite officielle mise en miroir ; aucun build personnalisé, aucune étape Cloud Build |
| Réseau | VPC + Cloud Load Balancing | Service LoadBalancer externe avec adresse IP statique réservée par défaut |
| Base de données / cache | — | **Ni Cloud SQL, ni Redis** — Hermes repose entièrement sur SQLite sur NFS |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Tout l'état de l'agent se trouve dans `/opt/data`, et ce chemin est fixé dans
  l'image.** Le NFS partagé de la plateforme est monté directement par-dessus
  (`enable_nfs = true`, `nfs_mount_path = "/opt/data"`, tous deux par défaut et
  **imposés par une validation au moment du plan**). Sans ce montage, chaque
  redémarrage de pod ou redéploiement efface silencieusement l'identité accumulée
  par l'agent.
- **`max_instance_count` est validé à 1.** L'état de Hermes est en SQLite, qui
  suit un modèle à écrivain unique — un second réplica simultané corrompt la base
  de données. Le socle déploie en outre les applications adossées à NFS avec
  la stratégie `Recreate`, afin que les mises à jour ne fassent jamais tourner
  brièvement deux pods sur le volume.
- **Le serveur d'API compatible OpenAI écoute sur le port 8642** et exige
  l'`API_SERVER_KEY` générée automatiquement comme jeton bearer.
- **Les sondes sont par défaut des sondes TCP d'écoute de port** — le serveur
  d'API exige une authentification, si bien qu'une sonde HTTP recevrait un 401 et
  bloquerait le déploiement.
- **Le tableau de bord web (port 9119, authentification basique) n'est pas exposé
  par le Service** — accédez-y avec `kubectl port-forward`.
- **`API_SERVER_KEY` est injectée sous forme de Secret Kubernetes explicite**
  plutôt que via SecretSync, qui peut matérialiser une valeur vide au premier
  déploiement avant la fin de la réplication de Secret Manager. Tous les autres
  secrets sont adossés à SecretSync.
- **Au moins une clé de fournisseur de modèles est requise lors du déploiement
  initial** (`anthropic_api_key`, ou `enable_openai` + `openai_api_key`) ; un
  contrôle au moment du plan avertit lorsqu'aucune n'est fournie.
- **Aucun job d'initialisation, aucun amorçage de base de données** — le premier
  démarrage se contente d'initialiser `/opt/data` sur le partage NFS.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Hermes {#a-gke-autopilot--the-hermes-workload}

Le pod de passerelle Hermes est planifié sur Autopilot, qui facture le CPU et la
mémoire réellement demandés par le pod. Les réplicas sont fixés à un ; les signaux
intéressants sont la disponibilité du pod, les redémarrages et le montage du
volume NFS.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Hermes pour voir les pods et les événements ; Services & Ingress affiche
  l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl describe pod -n "$NAMESPACE" <pod>            # events: probes, mounts
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour Autopilot, les types de charges de travail et
le cycle de vie du déploiement.

### B. Stockage partagé NFS — l'identité de l'agent {#b-nfs-shared-storage--the-agents-identity}

L'intégralité de l'état de l'agent (base de configuration SQLite, clés d'API,
sessions, compétences apprises, mémoires) réside sur le serveur NFS autogéré
partagé provisionné par `Services_GCP` (`create_network_filesystem = true`), monté
sur `/opt/data` dans le pod. La VM NFS doit être à l'état `RUNNING` avant le
déploiement de ce module — la découverte la trouve par son libellé.

- **Console :** Compute Engine → VM instances (la VM du serveur NFS).
- **CLI :**
  ```bash
  gcloud compute instances list --project "$PROJECT" \
    --filter="name~nfs" --format="table(name,zone,status)"
  # Confirm the mount inside the pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /opt/data
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls /opt/data
  ```

Le partage et ses données **appartiennent à Services_GCP** — détruire le
déploiement Hermes ne supprime pas l'état de l'agent sur l'export NFS.

### C. Secret Manager {#c-secret-manager}

Cinq secrets peuvent exister par déploiement : `ANTHROPIC_API_KEY` (fourni par
l'opérateur), `API_SERVER_KEY` (hexadécimal de 64 caractères généré
automatiquement — le jeton bearer de l'API de la passerelle),
`HERMES_DASHBOARD_BASIC_AUTH_PASSWORD` (généré automatiquement) et, en option,
`OPENAI_API_KEY` et `TELEGRAM_BOT_TOKEN`. Ils apparaissent dans l'espace de noms sous
forme de Secrets Kubernetes (SecretSync pour la plupart ; un Secret explicite pour
`API_SERVER_KEY`).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~hermes"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  kubectl get secrets -n "$NAMESPACE"
  ```

Des variables d'identifiants laissées vides lors d'un déploiement de mise à jour
conservent la version `latest` stockée. Consultez [App_GKE](App_GKE.md) pour
l'intégration de SecretSync.

### D. Artifact Registry — l'image mise en miroir {#d-artifact-registry--the-mirrored-image}

L'image officielle `nousresearch/hermes-agent:<version>` est mise en miroir dans
Artifact Registry avant le déploiement (`enable_image_mirroring = true`) afin que
les nœuds ne tirent jamais depuis Docker Hub. Il n'y a **aucune étape Cloud
Build** — il s'agit d'un module préconstruit. Les images mises en miroir sont
tirées avec `imagePullPolicy: Always`.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list \
    "$REGION-docker.pkg.dev/$PROJECT/<repo>" --filter="package~hermes"
  ```

### E. Réseau et entrée {#e-networking--ingress}

La passerelle est exposée par défaut via un Service LoadBalancer externe, avec une
adresse IP statique réservée afin que l'adresse survive aux redéploiements. Le
serveur d'API applique sa propre authentification par jeton bearer ; le caractère
public du point de terminaison est donc voulu. Un domaine personnalisé avec un
certificat géré peut être ajouté via la Gateway API.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
adresses IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les
métriques GKE vers Cloud Monitoring. Le test de disponibilité est **désactivé par
défaut** — le serveur d'API exige une authentification, si bien qu'un test de
disponibilité non authentifié échouerait toujours.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Hermes {#3-hermes-application-behaviour}

- **Initialisation du répertoire de données au premier démarrage.** L'ENTRYPOINT
  de l'image est `/init` de s6-overlay, qui démarre en tant que root, applique
  `chown` au volume `/opt/data` (le nouveau répertoire NFS) au profit de
  l'utilisateur non root `hermes`, puis abandonne ses privilèges et démarre la
  passerelle (`container_args = ["gateway", "run"]` — le CMD par défaut de l'image
  est la CLI interactive, la passerelle doit donc être démarrée explicitement).
- **Aucun job d'initialisation de base de données.** Hermes crée sa propre base de
  configuration SQLite sous `/opt/data` au premier démarrage ; il n'y a rien à
  amorcer et `initialization_jobs` est vide. `database_type = "NONE"` et
  `enable_redis = false` sont codés en dur dans l'appel au socle.
- **L'accès à l'API exige l'`API_SERVER_KEY`.** Le point de terminaison compatible
  OpenAI sur le port 8642 s'authentifie avec un jeton bearer :
  ```bash
  KEY=$(gcloud secrets versions access latest --secret=<api-server-key-secret> --project "$PROJECT")
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" \
    -o jsonpath='{.items[?(@.spec.type=="LoadBalancer")].status.loadBalancer.ingress[0].ip}')
  curl -s -H "Authorization: Bearer $KEY" "http://${EXTERNAL_IP}:8642/v1/models"
  ```
  (Le Service associe son port au port du conteneur ; vérifiez le port exposé avec
  `kubectl get svc`.)
- **Tableau de bord via port-forward.** Le tableau de bord web intégré au
  processus (gestion des clés d'API, configuration des profils) s'exécute sur le
  port 9119 derrière une authentification basique et n'est pas exposé par le
  Service. Accédez-y en local :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 9119:9119
  # then open http://localhost:9119 — user `admin`, password from Secret Manager
  ```
- **Configuration des connecteurs (Telegram).** Définissez
  `enable_telegram = true` et fournissez `telegram_bot_token` (obtenu auprès de
  @BotFather). Le connecteur Telegram de Hermes **interroge en long polling
  sortant** — aucun webhook, routeur ou URL de rappel publique n'est nécessaire.
  Une validation au moment du plan rejette `enable_telegram = true` avec un jeton
  vide. Les autres connecteurs (Discord, Slack, WhatsApp, Signal) se configurent
  via la map `environment_variables` de l'opérateur.
- **Les mises à jour de version utilisent `Recreate`.** Comme l'application est
  adossée à NFS, le socle remplace le pod en l'arrêtant puis en le
  redémarrant, au lieu d'une mise à jour progressive — une brève interruption de
  disponibilité pendant les mises à jour est attendue et protège la base SQLite
  d'un chevauchement à deux écrivains.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Hermes ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet, identité et identifiants {#group-1--project-identity--credentials}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `anthropic_api_key` | `""` | Clé du fournisseur de modèles principal, injectée en tant que `ANTHROPIC_API_KEY`. Obligatoire lors du déploiement initial (ou utilisez OpenAI) ; omettez-la lors des mises à jour pour conserver la version stockée. |
| `api_server_key` | `""` (auto) | Jeton bearer du serveur d'API compatible OpenAI. Hexadécimal de 64 caractères généré automatiquement s'il est vide. |
| `enable_openai` / `openai_api_key` | `false` / `""` | Fournisseur secondaire facultatif, injecté en tant que `OPENAI_API_KEY`. |
| `enable_dashboard` | `true` | Exécute le tableau de bord sur le port 9119 dans le processus ; accessible via `kubectl port-forward`. |
| `dashboard_username` / `dashboard_password` | `admin` / `""` (auto) | Authentification basique du tableau de bord ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `hermes` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `nousresearch/hermes-agent` ; épinglez un tag de version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_resources` | `2000m` / `2Gi` | Limites de CPU et de mémoire du conteneur de passerelle. |
| `min_instance_count` | `1` | Conservez 1 pour éviter les démarrages à froid des sessions de l'agent. |
| `max_instance_count` | `1` | **Validé à 1** — SQLite à écrivain unique sur le NFS partagé. |
| `container_port` | `8642` | Port du serveur d'API compatible OpenAI de la passerelle. |
| `timeout_seconds` | `3600` | Les sessions de l'agent peuvent être de longue durée. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle sans étape de build. |
| `enable_image_mirroring` | `true` | Met l'image en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configuration supplémentaire ; les variables gérées par le module (`API_SERVER_*`, `HERMES_DASHBOARD*`) sont prioritaires. À utiliser pour les identifiants des connecteurs Discord/Slack/WhatsApp/Signal ou les points de terminaison de fournisseurs (par exemple OpenRouter). |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom d'un secret Secret Manager existant. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Adresse IP externe par défaut ; le serveur d'API applique une authentification par jeton bearer. |
| `session_affinity` | `ClientIP` | Routage persistant (réplica unique, donc sans grande portée). |
| `termination_grace_period_seconds` | `60` | Délai laissé aux sessions actives de l'agent pour se terminer à l'arrêt. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 10s, 36 tentatives | Écoute de port TCP — sûre quelle que soit l'authentification du serveur d'API ; marge pour le montage NFS et l'initialisation au premier démarrage. |
| `liveness_probe` | TCP, délai de 30s | Écoute de port TCP. |
| `uptime_check_config` | désactivé | Un test de disponibilité non authentifié échouerait toujours face au serveur d'API authentifié. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Obligatoire — validé.** Toute l'identité de l'agent réside sous `/opt/data`. |
| `nfs_mount_path` | `/opt/data` | Répertoire de données fixe de l'image ; le partage NFS est monté directement par-dessus. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Montages GCSFuse auxiliaires uniquement — ne pointez jamais l'un d'eux vers `/opt/data` (SQLite n'est pas sûr sur GCSFuse). |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 15 — Connecteurs Hermes {#group-15--hermes-connectors}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_telegram` | `false` | Provisionne le secret du jeton du bot Telegram et injecte `TELEGRAM_BOT_TOKEN`. |
| `telegram_bot_token` | `""` | Jeton du bot obtenu auprès de @BotFather ; obligatoire (validé) lorsque `enable_telegram = true`. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Configuration de domaine personnalisé via la Gateway API avec SSL géré (nécessite `application_domains`). |
| `reserve_static_ip` | `true` | Adresse IP externe stable d'un redéploiement à l'autre. |

Variables inertes conservées par convention : les variables de base de données
(groupe 16), Redis (miroirs du groupe 15), SQL personnalisé (groupe 18) et
`enable_cloudsql_volume` sont déclarées par souci de cohérence avec la convention,
mais codées en dur à off dans `main.tf` — Hermes n'a ni base de données ni Redis.

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
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `api_url` | URL permettant d'atteindre le serveur d'API de la passerelle. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `cron_jobs` | Noms des jobs d'initialisation et planifiés (vides par défaut). |
| `statefulset_name` | Nom du StatefulSet (lorsqu'une charge de travail StatefulSet est sélectionnée). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Dépôt et déclencheur de build. |
| `kubernetes_ready` | Indique si le point de terminaison du cluster était lisible et si les charges de travail Kubernetes ont été déployées (false lors du premier apply d'un nouveau cluster inline — relancez l'apply). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan.** Le fichier `validation.tf` de ce module et le
> moteur du socle [App_GKE](App_GKE.md) valident les valeurs *et leurs
> combinaisons* au moment du plan — `max_instance_count > 1`, `enable_nfs = false`,
> un connecteur Telegram sans son jeton, ou OpenAI activé sans clé font tous
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (validé) | Critique | Un second réplica simultané écrit dans la même base SQLite sur NFS — la violation du modèle à écrivain unique corrompt tout l'état de l'agent. |
| `enable_nfs` | `true` (validé) | Critique | Sans le montage NFS, `/opt/data` est un disque de pod éphémère — chaque redémarrage / redéploiement efface silencieusement l'identité de l'agent (configuration, sessions, compétences, mémoires). |
| `gcs_volumes` sur `/opt/data` | jamais | Critique | GCSFuse ne fournit ni verrouillage POSIX ni renommages atomiques ; SQLite sur GCSFuse se corrompt. Conservez l'état sur NFS. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `anthropic_api_key` (ou la paire OpenAI) | définie au premier déploiement | Élevé | Sans aucune clé de fournisseur, l'agent ne peut pas exécuter un seul tour. |
| VM NFS pas à l'état `RUNNING` | attendre avant de déployer | Élevé | La découverte ne trouve aucun serveur → le module crée un NFS inline ou le montage échoue ; le pod reste bloqué en `ContainerCreating`. |
| `startup_probe` / `liveness_probe` | TCP (par défaut) | Moyen | Une sonde HTTP contre le serveur d'API authentifié renvoie 401/403 indéfiniment — le pod ne devient jamais Ready et le déploiement reste bloqué. |
| `min_instance_count` | `1` | Moyen | GKE n'a pas de mise à l'échelle à zéro, mais une réduction manuelle met les connecteurs hors ligne. |
| `application_version` | épingler un tag de version | Moyen | `latest` est résolu à nouveau à chaque mise en miroir ; le comportement peut changer à votre insu lors d'un redéploiement. |
| `enable_telegram` sans jeton | bloqué | Faible | La validation au moment du plan le rejette ; le connecteur ne peut pas démarrer sans le jeton du bot. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Hermes, partagée
avec la variante Cloud Run, est décrite dans **[Hermes_Common](Hermes_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Hermes Agent sur GKE Autopilot](../labs/Hermes_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Hermes Agent sur Google Cloud Run](Hermes_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Hermes Common — Configuration applicative partagée](Hermes_Common.md) — la configuration partagée par les deux cibles de déploiement.
