---
title: "Gitea sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Gitea sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Gitea_GKE.md @ 15fd4c7 sha256:bdf1ea824405 -->

# Gitea sur GKE Autopilot {#gitea-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gitea_GKE.png" alt="Gitea sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gitea est un service Git léger et auto-hébergé, ainsi qu'une plateforme
d'hébergement de code source (un fork communautaire de Gogs) offrant
l'hébergement de dépôts, le suivi des problèmes, les pull requests, un runner
CI/CD intégré (Actions), la revue de code et un registre de paquets à partir
d'un seul binaire Go. Ce module déploie Gitea sur **GKE Autopilot** en se
basant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Gitea et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gitea s'exécute comme une charge de travail web binaire Go unique (serveur de
dépôt + runner SSH/CI intégré supervisé par `s6`). Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Gitea sur le port 3000, 1 vCPU / 512 Mio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | `database_type` par défaut `POSTGRES_15` ; le job `db-init` est PostgreSQL uniquement |
| Persistance des fichiers | Cloud Filestore (NFS) | Dépôts, objets LFS et pièces jointes persistent sous `/data`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Aucun — `Gitea_Common` ne déclare aucun bucket GCS (`storage_buckets = []`) |
| Secrets | Secret Manager | `SECRET_KEY` et `INTERNAL_TOKEN` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing / Gateway | `service_type = LoadBalancer` par défaut, avec `enable_custom_domain = true` provisionnant une Gateway + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur prévu, et seul Postgres fonctionne réellement.**
  `database_type` par défaut `POSTGRES_15`, mais la validation de la
  variable accepte également `MYSQL`/`MYSQL_8_0`. Le script `db-init`
  fourni (`scripts/gitea/db-init.sh`) est codé en dur pour `psql` — la sélection
  d'un moteur MySQL interrompt l'initialisation de la base de données. Laissez
  `database_type` sur une valeur Postgres.
- **Cloud SQL est atteint via le sidecar Auth Proxy sur la boucle locale par
  défaut.** `enable_cloudsql_volume = true` exécute un sidecar `cloud-sql-proxy` ; le point
  d'entrée de la plateforme (`/platform-entrypoint.sh`) compose `GITEA__database__HOST` à partir
  des `DB_HOST`/`DB_IP` injectés et sélectionne `SSL_MODE=disable` pour le
  chemin du socket/boucle locale ou `SSL_MODE=require` pour un saut TCP IP privée direct.
- **Il s'agit d'une build personnalisée légère, et non de l'image `gitea/gitea`
  standard utilisée telle quelle.** `container_image_source` par défaut `"custom"` :
  Cloud Build produit `FROM gitea/gitea:${APP_VERSION}` plus un point d'entrée de plateforme qui
  compose les valeurs `GITEA__database__*` au moment de l'exécution (Cloud Run
  n'interpole pas les références `$(VAR)` comme Kubernetes le fait, donc le
  même point d'entrée est partagé entre les deux variantes pour la cohérence).
  Le `s6-svscan` `CMD` standard est conservé.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur `/data` via
  `nfs_mount_path`) afin que les dépôts, les objets Git LFS et les pièces jointes
  des problèmes/PR persistent et soient partagés entre les pods (`GITEA__server__APP_DATA_PATH`).
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0`, `max_instance_count = 3`.
  Étant donné que les données du dépôt résident sur un NFS partagé plutôt que
  sur un stockage par pod, l'exécution de plusieurs réplicas est généralement
  sûre pour les requêtes HTTP sans état, mais le verrouillage propre à Git et
  les jobs d'arrière-plan en cours ne sont pas explicitement coordonnés entre
  les réplicas par ce module — gardez `max_instance_count` conservateur sauf
  vérification.
- **Pas d'installeur, pas de compte administrateur automatisé.** `GITEA__security__INSTALL_LOCK =
  "true"`
  saute l'installeur web de première exécution (la configuration est
  entièrement fournie via des variables d'environnement) et `GITEA__service__DISABLE_REGISTRATION = "false"`
  laisse l'auto-enregistrement ouvert. Aucun job géré par Terraform ne crée
  d'utilisateur administrateur — enregistrez le premier compte via l'interface
  utilisateur web, ou promouvez/créez-en un via `kubectl exec ... -- gitea admin
  user create --admin` (vérifiez le
  chemin du binaire dans l'image déployée avant de vous y fier).
- **`SECRET_KEY` et `INTERNAL_TOKEN` sont générés automatiquement** et stockés
  dans Secret Manager ; le mot de passe de la base de données est le secret
  `DB_PASSWORD` géré par la fondation, livré à Gitea en tant que `GITEA__database__PASSWD`.
- **`public_domain`/`public_url` par défaut `localhost`.** Contrairement à
  certains modules, les URL de clonage de Gitea (`GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL`)
  ne sont **pas** auto-remplies à partir de l'adresse LoadBalancer/Gateway
  attribuée — définissez `public_domain` (ou `public_url`) sur votre
  nom d'hôte réel après le déploiement, sinon les liens de clonage et les
  rappels OAuth/webhook feront référence à `localhost`.
- **`enable_redis` n'a aucun effet sur le comportement propre de Gitea.** La
  variable par défaut `true` et la fondation injecte `REDIS_HOST`/`REDIS_PORT`,
  mais `Gitea_Common` ne définit jamais de configuration `GITEA__cache__*`/`GITEA__session__*`/`GITEA__queue__*`
  pour les consommer — Gitea fonctionne avec ses valeurs par défaut intégrées
  en mémoire/sans SQLite, quelle que soit cette configuration.
- **git-over-SSH n'est pas exposé.** Seul le port HTTP (`container_port`, par
  défaut `3000`) est câblé dans le Service Kubernetes. Le `sshd`
  propre à l'image (supervisé par `s6` à côté du serveur web) n'est
  pas publié — clonez via HTTPS, ou ajoutez un Service/mappage de port
  personnalisé si l'accès SSH est requis.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de
noms et les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Gitea {#a-gke-autopilot--the-gitea-workload}

Les pods Gitea sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. La valeur par défaut `workload_type` est `Deployment`.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Gitea pour les pods, les révisions et les événements. Kubernetes Engine
  → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gitea stocke toutes les données de l'application (métadonnées du dépôt,
problèmes, pull requests, utilisateurs, organisations) dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Les pods y accèdent via le sidecar **Cloud SQL
Auth Proxy** ; aucune IP publique n'est exposée. Lors du premier déploiement,
le job `db-init` crée de manière idempotente le rôle et la base de données
de l'application et accorde les privilèges — Gitea lui-même crée et migre son
schéma au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous dans les [Sorties](#5-outputs). Voir
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe.

### C. Stockage NFS — dépôts, LFS et pièces jointes {#c-nfs-storage--repositories-lfs-and-attachments}

Le répertoire racine des documents de Gitea (`GITEA__server__APP_DATA_PATH`) réside sur **NFS
(Cloud Filestore)** monté sur `/data` par défaut, partagé entre les
pods. Aucun bucket GCS n'est provisionné pour ce module.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /data
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Gitea sont générés automatiquement et stockés dans Secret Manager
: `SECRET_KEY` (chiffre les données sensibles telles que les secrets 2FA et
les jetons OAuth) et `INTERNAL_TOKEN` (authentifie les appels API internes de
Gitea). Le mot de passe de la base de données est géré séparément par la
fondation. Sur GKE, les deux secrets sont matérialisés sous des clés Secret
Manager **simples** (`SECRET_KEY` / `INTERNAL_TOKEN`, et non les noms `GITEA__security__*`
utilisés sur Cloud Run) car la CRD SecretSync du pilote CSI Secret Store
interdit les underscores consécutifs dans un secret synchronisé `targetKey` ;
Gitea les lit à partir des fichiers montés par CSI via sa convention native
`GITEA__section__KEY__FILE`.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-key-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing (`service_type = LoadBalancer`, `reserve_static_ip = true`), et `enable_custom_domain = true`
provisionne une Gateway avec un certificat géré (un nom d'hôte `nip.io` est
utilisé automatiquement si `application_domains` est laissé vide).

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Des tests de
disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gitea {#3-gitea-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il attend que Cloud SQL
  accepte les connexions, crée (ou réinitialise le mot de passe) de manière
  idempotente le rôle de l'application avec `CREATEDB`, crée la base de
  données appartenant à ce rôle, accorde des privilèges complets sur la base de
  données et le schéma `public` (PostgreSQL 15+ nécessite des
  privilèges de schéma explicites), puis signale au sidecar Cloud SQL Auth Proxy
  de s'arrêter (`POST /quitquitquit`). Le job peut être réexécuté en toute
  sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **La création du schéma est la responsabilité propre de Gitea.** Il n'existe
  pas de job de migration séparé — Gitea crée et migre son schéma lui-même au
  premier démarrage sur la base de données vide. Aucune extension Postgres n'est
  installée (`db-init.sh` n'en a pas besoin).
- **Composition des variables d'environnement de la base de données au moment de
  l'exécution.** La fondation injecte des `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`
  discrets (+ le secret `DB_PASSWORD`). Le point d'entrée de la plateforme
  compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}` à partir de ceux-ci au démarrage du conteneur — en
  fonction de si `DB_HOST` est un chemin de socket Cloud SQL (`/cloudsql/...`,
  SSL désactivé), la boucle locale du proxy (`127.0.0.1`, SSL désactivé),
  ou une IP privée directe (SSL requis) — puis transmet à l'image `/usr/bin/entrypoint`
  standard de Gitea.
- **Pas d'installeur, auto-enregistrement ouvert.** `GITEA__security__INSTALL_LOCK = "true"`
  saute l'installeur interactif de première exécution ; `GITEA__service__DISABLE_REGISTRATION =
  "false"`
  laisse l'auto-enregistrement de compte activé. Il n'y a pas de bootstrap
  administrateur automatisé — créez/promouvez un administrateur manuellement
  après le premier déploiement.
- **Données du dépôt sur NFS.** `GITEA__server__APP_DATA_PATH` pointe vers le
  `nfs_mount_path` (par défaut `/data`), de sorte que les dépôts, les
  objets Git LFS et les pièces jointes persistent après les redémarrages et les
  redéploiements des pods.
- **Définissez `public_domain`/`public_url` une fois que l'IP ou le domaine
  est connu.** Ils sont par défaut `localhost` / `http://localhost/`.
  Mettez-les à jour via `environment_variables` (ou les variables `public_domain`/`public_url`
  du module) une fois que l'adresse externe est attribuée, afin que les URL de
  clonage, les rappels de webhook et les redirections OAuth se résolvent
  correctement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux
  **HTTP** `GET /api/healthz`, que Gitea sert sans authentification avec HTTP 200
  une fois qu'il a terminé son démarrage.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep GITEA__
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Gitea sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standards.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gitea` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `1` | Tag d'image `gitea/gitea` consommé par l'argument de build `APP_VERSION` du Dockerfile. |
| `container_image_source` | `custom` | Construit le wrapper léger du point d'entrée de la plateforme sur `gitea/gitea`. `prebuilt` déploie `gitea/gitea` directement sans composition `GITEA__database__*` au moment de l'exécution — n'utilisez ceci que si vous câblez vous-même les variables d'environnement de la base de données. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port HTTP de Gitea (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut. |
| `max_instance_count` | `3` | Plafond de coût ; à augmenter avec prudence — la coordination des réplicas pour les opérations Git/CI en arrière-plan n'est pas explicitement gérée par ce module. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (boucle locale) pour la connectivité Cloud SQL. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Gitea. |
| `workload_type` | `Deployment` | Déploiement sans état ; les données persistantes résident sur NFS, pas sur le stockage par pod. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` ; utilisé pour les URL de clonage et les liens. Définissez-le sur votre nom d'hôte réel. |
| `public_url` | `""` → `http://<public_domain>/` | Définit `GITEA__server__ROOT_URL`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les dépôts, les objets LFS et les pièces jointes persistent et soient partagés. |
| `nfs_mount_path` | `/data` | Chemin de montage pour le partage NFS (correspond à la valeur par défaut de `Gitea_Common`). La valeur passée est également celle à laquelle `GITEA__server__APP_DATA_PATH` est défini, de sorte que le répertoire de données effectif corresponde toujours au montage. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Le job `db-init` est PostgreSQL uniquement (`psql`) ; ne pas passer à une valeur MySQL même si elle est acceptée par la validation. |
| `db_name` | `gitea` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `gitea` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 20 — Accès et réseau (IAP) {#group-20--access--networking-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Proxy conscient de l'identité (IAP) devant la Gateway. Nécessite `enable_custom_domain` ou `enable_cdn`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway + un certificat géré ; utilise un nom d'hôte `nip.io` si `application_domains` est vide. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Gitea. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides — Gitea persiste sur NFS). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un `StatefulSet`
> forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*`
> donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée.
> Une configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Le passage à une valeur MySQL réussit la validation de la variable mais interrompt le script `db-init.sh` (PostgreSQL uniquement), laissant la base de données non initialisée. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (auto-généré) | Ne jamais changer | Critique | La modification de ceux-ci après le premier démarrage invalide les secrets 2FA, les jetons OAuth et l'authentification API interne. |
| `enable_nfs` | `true` | Critique | Le désactiver rend les dépôts, les objets LFS et les pièces jointes éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour le chemin de connectivité de base de données par socket/boucle locale par défaut. |
| `public_domain` / `public_url` | Définir sur le nom d'hôte réel | Élevé | Laissé à `localhost`, les URL de clonage, les rappels de webhook et les redirections OAuth sont incorrects pour chaque utilisateur. |
| `max_instance_count` | Rester conservateur (valeur par défaut `3`) | Élevé | La mise à l'échelle sans vérifier la coordination multi-réplicas pour les opérations Git/Actions en arrière-plan est un comportement non vérifié. |
| `memory_limit` / `cpu_limit` | `512Mi` / `1000m` (valeurs par défaut) | Élevé | En dessous des seuils équivalents à la gen2 de Kubernetes, le pod OOM ou est ralenti sous charge ; augmenter pour les dépôts plus grands ou les charges de travail CI. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| Création de compte administrateur | Étape manuelle post-déploiement | Moyen | Aucun compte n'est amorcé automatiquement ; oublier cette étape avec l'auto-enregistrement ouvert signifie que le premier utilisateur enregistré n'est pas garanti d'être un administrateur. |
| `enable_redis` | Inerte pour Gitea | Faible | Le basculement n'a aucun effet — aucun câblage `GITEA__cache__*`/`GITEA__session__*` ne consomme `REDIS_HOST`. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, ce qui interrompt le DNS et `public_url`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Gitea
partagée avec la variante Cloud Run est décrite dans
**[Gitea_Common](Gitea_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gitea sur GKE Autopilot](../labs/Gitea_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Gitea sur Google Cloud Run](Gitea_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gitea Common — Configuration d'application partagée](Gitea_Common.md) — la configuration partagée par les deux cibles de déploiement.
