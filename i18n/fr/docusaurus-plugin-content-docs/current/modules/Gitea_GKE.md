---
title: "Gitea sur GKE Autopilot"
description: "Référence de configuration pour déployer Gitea sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gitea_GKE.md @ 3055034 sha256:20b1f3bf7392 -->

# Gitea sur GKE Autopilot {#gitea-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gitea_GKE.png" alt="Gitea sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gitea est un service Git léger et auto-hébergé ainsi qu'une plateforme d'hébergement
de code source (un fork communautaire de Gogs) qui fournit l'hébergement de dépôts, le
suivi des tickets, les pull requests, un exécuteur CI/CD intégré (Actions), la revue
de code et un registre de paquets, le tout à partir d'un seul binaire Go. Ce module
déploie Gitea sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Gitea et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gitea s'exécute comme une charge de travail web à binaire Go unique (serveur de dépôts +
SSH/exécuteur CI intégrés, supervisés par `s6`). Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Gitea sur le port 3000, 1 vCPU / 512Mi par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | `database_type` vaut `POSTGRES_15` par défaut ; le job `db-init` ne prend en charge que PostgreSQL |
| Persistance des fichiers | Cloud Filestore (NFS) | Dépôts, objets LFS et pièces jointes persistés sous `/data`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Aucun — `Gitea_Common` ne déclare aucun bucket GCS (`storage_buckets = []`) |
| Secrets | Secret Manager | `SECRET_KEY` et `INTERNAL_TOKEN` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing / Gateway | `service_type = LoadBalancer` par défaut, avec `enable_custom_domain = true` qui provisionne une Gateway + un certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le moteur prévu, et seul Postgres fonctionne réellement.**
  `database_type` vaut `POSTGRES_15` par défaut, mais la validation de la variable
  accepte aussi `MYSQL`/`MYSQL_8_0`. Le script `db-init` fourni (`scripts/gitea/db-init.sh`)
  est codé en dur pour `psql` — choisir un moteur MySQL casse l'initialisation de la
  base de données. Laissez `database_type` sur une valeur Postgres.
- **Cloud SQL est joint par défaut via le sidecar Auth Proxy en loopback.**
  `enable_cloudsql_volume = true` exécute un sidecar `cloud-sql-proxy` ; le point
  d'entrée de plateforme (`/platform-entrypoint.sh`) compose `GITEA__database__HOST`
  à partir des `DB_HOST`/`DB_IP` injectés et choisit `SSL_MODE=disable` pour le chemin
  socket/loopback ou `SSL_MODE=require` pour un saut TCP direct vers l'IP privée.
- **Il s'agit d'un build personnalisé léger, et non de l'image standard `gitea/gitea` utilisée telle quelle.**
  `container_image_source` vaut `"custom"` par défaut : Cloud Build produit
  `FROM gitea/gitea:${APP_VERSION}` plus un point d'entrée de plateforme qui compose
  les valeurs `GITEA__database__*` à l'exécution (Cloud Run n'interpole pas les
  références `$(VAR)` comme le fait Kubernetes ; le même point d'entrée est donc
  partagé par les deux variantes par souci de cohérence). Le `CMD` standard
  `s6-svscan` est conservé.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur `/data` via
  `nfs_mount_path`) afin que les dépôts, les objets Git LFS et les pièces jointes des
  tickets/PR persistent et soient partagés entre les pods (`GITEA__server__APP_DATA_PATH`).
- **Mise à l'échelle jusqu'à zéro par défaut.** `min_instance_count = 0`,
  `max_instance_count = 3`. Comme les données des dépôts résident sur un NFS partagé
  plutôt que sur un stockage par pod, exécuter plus d'un réplica est généralement
  sûr pour les requêtes HTTP sans état, mais le verrouillage propre à Git et les
  éventuels jobs d'arrière-plan en cours ne sont pas explicitement coordonnés entre
  les réplicas par ce module — gardez `max_instance_count` prudent tant que cela n'a
  pas été vérifié.
- **Pas d'installateur, pas de compte administrateur automatisé.**
  `GITEA__security__INSTALL_LOCK =
  "true"` ignore l'installateur web du premier
  lancement (la configuration est entièrement fournie par des variables
  d'environnement) et `GITEA__service__DISABLE_REGISTRATION = "false"` laisse
  l'auto-inscription ouverte. Aucun job géré par Terraform ne crée d'utilisateur
  administrateur — inscrivez le premier compte via l'interface web, ou promouvez/créez
  un administrateur via `kubectl exec ... -- gitea admin
  user create --admin`
  (vérifiez le chemin du binaire dans l'image déployée avant de vous y fier).
- **`SECRET_KEY` et `INTERNAL_TOKEN` sont générés automatiquement** et stockés dans
  Secret Manager ; le mot de passe de la base de données est le secret `DB_PASSWORD`
  géré par le socle, transmis à Gitea comme `GITEA__database__PASSWD`.
- **`public_domain`/`public_url` valent `localhost` par défaut.** Contrairement à
  certains modules, les URL de clonage de Gitea (`GITEA__server__DOMAIN` /
  `GITEA__server__ROOT_URL`) ne sont **pas** renseignées automatiquement à partir de
  l'adresse attribuée au LoadBalancer/à la Gateway — définissez `public_domain` (ou
  `public_url`) sur votre nom d'hôte réel après le déploiement, sinon les liens de
  clonage et les callbacks OAuth/webhook feront référence à `localhost`.
- **`enable_redis` n'a aucun effet sur le comportement de Gitea.** La variable vaut
  `true` par défaut et le socle injecte `REDIS_HOST`/`REDIS_PORT`, mais `Gitea_Common`
  ne définit jamais de configuration `GITEA__cache__*`/`GITEA__session__*`/`GITEA__queue__*`
  pour les exploiter — Gitea fonctionne avec ses valeurs par défaut intégrées (en
  mémoire, sans SQLite) quel que soit ce paramètre.
- **Le git sur SSH n'est pas exposé.** Seul le port HTTP (`container_port`, `3000`
  par défaut) est câblé dans le Service Kubernetes. Le `sshd` propre à l'image
  (supervisé par `s6` aux côtés du serveur web) n'est pas publié — clonez en HTTPS,
  ou ajoutez un Service/mappage de port personnalisé si un accès SSH est nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gitea {#a-gke-autopilot--the-gitea-workload}

Les pods Gitea sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les
pods demandent réellement. Le `workload_type` par défaut est `Deployment`.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Gitea pour les pods, les révisions et les événements. Kubernetes Engine → Services
  & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Gitea stocke toutes les données applicatives (métadonnées des dépôts, tickets, pull
requests, utilisateurs, organisations) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods la joignent via le sidecar **Cloud SQL Auth Proxy** ; aucune
IP publique n'est exposée. Au premier déploiement, le job `db-init` crée de façon
idempotente le rôle et la base de données de l'application et accorde les
privilèges — Gitea crée et migre lui-même son schéma au premier démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base, l'utilisateur et le secret Secret Manager contenant le
mot de passe figurent tous dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la
rotation des mots de passe.

### C. Stockage NFS — dépôts, LFS et pièces jointes {#c-nfs-storage--repositories-lfs-and-attachments}

La racine documentaire de Gitea (`GITEA__server__APP_DATA_PATH`) réside sur **NFS
(Cloud Filestore)**, monté par défaut sur `/data` et partagé entre les pods. Aucun
bucket GCS n'est provisionné pour ce module.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /data
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Gitea sont générés automatiquement et stockés dans Secret Manager :
`SECRET_KEY` (chiffre les données sensibles comme les secrets 2FA et les jetons OAuth)
et `INTERNAL_TOKEN` (authentifie les appels internes à l'API de Gitea). Le mot de passe
de la base de données est géré séparément par le socle. Sur GKE, les deux secrets sont
matérialisés sous des clés Secret Manager **simples** (`SECRET_KEY` / `INTERNAL_TOKEN`,
et non les noms `GITEA__security__*` utilisés sur Cloud Run), car la CRD SecretSync du
pilote Secret Store CSI interdit les tirets bas consécutifs dans le `targetKey` d'un
secret synchronisé ; Gitea les lit depuis les fichiers montés par CSI via sa convention
native `GITEA__section__KEY__FILE`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~gitea"
  gcloud secrets versions access latest --secret=<secret-key-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true`), et
`enable_custom_domain = true` provisionne une Gateway avec un certificat géré (un nom
d'hôte `nip.io` est utilisé automatiquement si `application_domains` reste vide).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont transmis à Cloud Logging ; les métriques de GKE
et de Cloud SQL sont transmises à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gitea {#3-gitea-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` avec `postgres:15-alpine`. Il attend que Cloud SQL accepte les
  connexions, crée de façon idempotente (ou réinitialise le mot de passe du) rôle
  applicatif avec `CREATEDB`, crée la base dont ce rôle est propriétaire, accorde
  l'ensemble des privilèges sur la base et sur le schéma `public` (PostgreSQL 15+
  exige des droits explicites sur le schéma), puis signale au sidecar Cloud SQL Auth
  Proxy de s'arrêter (`POST /quitquitquit`). Le job peut être relancé sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **La création du schéma relève de Gitea lui-même.** Il n'existe aucun job de
  migration distinct — Gitea crée et migre lui-même son schéma au premier démarrage
  sur la base vide. Aucune extension Postgres n'est installée (`db-init.sh` n'en
  nécessite aucune).
- **Composition des variables d'environnement de la base à l'exécution.** Le socle
  injecte des `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER` distincts (+ le secret
  `DB_PASSWORD`). Le point d'entrée de plateforme compose
  `GITEA__database__{HOST,NAME,USER,SSL_MODE}` à partir de ceux-ci au démarrage du
  conteneur — selon que `DB_HOST` est un chemin de socket Cloud SQL (`/cloudsql/...`,
  SSL désactivé), le loopback du proxy local (`127.0.0.1`, SSL désactivé) ou une IP
  privée directe (SSL requis) — puis passe la main au `/usr/bin/entrypoint` standard
  de Gitea.
- **Pas d'installateur, auto-inscription ouverte.** `GITEA__security__INSTALL_LOCK = "true"`
  ignore l'installateur interactif du premier lancement ;
  `GITEA__service__DISABLE_REGISTRATION =
  "false"` laisse l'auto-inscription des
  comptes activée. Il n'y a pas d'amorçage administrateur automatisé — créez/promouvez
  un administrateur manuellement après le premier déploiement.
- **Données des dépôts sur NFS.** `GITEA__server__APP_DATA_PATH` pointe vers le
  `nfs_mount_path` (`/data` par défaut), de sorte que les dépôts, les objets Git LFS
  et les pièces jointes persistent entre les redémarrages de pods et les
  redéploiements.
- **Définissez `public_domain`/`public_url` une fois l'IP ou le domaine connu.** Ils
  valent par défaut `localhost` / `http://localhost/`. Corrigez-les via
  `environment_variables` (ou les variables `public_domain`/`public_url` du module)
  une fois l'adresse externe attribuée, afin que les URL de clonage, les callbacks de
  webhook et les redirections OAuth se résolvent correctement.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont toutes deux des
  requêtes **HTTP** `GET /api/healthz`, que Gitea sert sans authentification avec un
  HTTP 200 une fois son démarrage terminé.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep GITEA__
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gitea ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `gitea` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `1` | Tag de l'image `gitea/gitea` utilisé par l'argument de build `APP_VERSION` du Dockerfile. |
| `container_image_source` | `custom` | Construit l'enveloppe légère avec point d'entrée de plateforme au-dessus de `gitea/gitea`. `prebuilt` déploie directement `gitea/gitea` sans composition des `GITEA__database__*` à l'exécution — ne l'utilisez que si vous câblez vous-même les variables d'environnement de la base. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port HTTP de Gitea (`GITEA__server__HTTP_PORT`). |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro par défaut. |
| `max_instance_count` | `3` | Plafond de coût ; augmentez-le avec prudence — la coordination des réplicas pour les opérations Git/CI d'arrière-plan n'est pas explicitement gérée par ce module. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) pour la connectivité Cloud SQL. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface Gitea. |
| `workload_type` | `Deployment` | Deployment sans état ; les données persistantes résident sur NFS, pas sur un stockage par pod. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne toujours le même pod. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` ; utilisé pour les URL de clonage et les liens. Indiquez votre nom d'hôte réel. |
| `public_url` | `""` → `http://<public_domain>/` | Définit `GITEA__server__ROOT_URL`. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les dépôts, objets LFS et pièces jointes persistent et soient partagés. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage par défaut de la variante GKE. Notez qu'il diffère de la valeur par défaut interne de `Gitea_Common`, `/data` — c'est la valeur transmise qui l'emporte, et c'est aussi elle qui est affectée à `GITEA__server__APP_DATA_PATH`, de sorte que le répertoire de données effectif correspond toujours au montage. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Le job `db-init` ne prend en charge que PostgreSQL (`psql`) ; ne passez pas à une valeur MySQL bien qu'elle soit acceptée par la validation. |
| `db_name` | `gitea` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `gitea` | Utilisateur de la base de l'application ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 20 — Accès et réseau (IAP) {#group-20--access--networking-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Identity-Aware Proxy devant la Gateway. Nécessite `enable_custom_domain` ou `enable_cdn`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway + un certificat géré ; se rabat sur un nom d'hôte `nip.io` si `application_domains` est vide. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour joindre Gitea. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Gitea persiste sur NFS). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans état, IAP sans identité autorisée, des `quota_memory_*` donnés en entiers nus, un `container_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Passer à une valeur MySQL franchit la validation de la variable mais casse le script `db-init.sh`, qui ne gère que PostgreSQL, laissant la base non initialisée. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (générés automatiquement) | Ne jamais les modifier | Critique | Les modifier après le premier démarrage invalide les secrets 2FA, les jetons OAuth et l'authentification de l'API interne. |
| `enable_nfs` | `true` | Critique | Le désactiver rend éphémères les dépôts, objets LFS et pièces jointes — perdus à la recréation du pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour le chemin de connectivité par défaut à la base (socket/loopback). |
| `public_domain` / `public_url` | Définir sur le nom d'hôte réel | Élevé | Laissés sur `localhost`, les URL de clonage, les callbacks de webhook et les redirections OAuth sont erronés pour tous les utilisateurs. |
| `max_instance_count` | Rester prudent (`3` par défaut) | Élevé | Aller au-delà sans vérifier la coordination multi-réplicas du travail Git/Actions en arrière-plan relève d'un comportement non vérifié. |
| `memory_limit` / `cpu_limit` | `512Mi` / `1000m` (valeurs par défaut) | Élevé | En dessous des seuils équivalents gen2 de Kubernetes, le pod subit des OOM ou un bridage sous charge ; augmentez-les pour des dépôts plus volumineux ou des charges CI. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent tout ordonnancement de pod dans l'espace de noms. |
| Création du compte administrateur | Étape manuelle après le déploiement | Moyen | Aucun compte n'est amorcé automatiquement ; oublier cette étape alors que l'auto-inscription est ouverte signifie que le premier utilisateur inscrit n'est pas garanti d'être administrateur. |
| `enable_redis` | Inopérant pour Gitea | Faible | Le basculer n'a aucun effet — aucun câblage `GITEA__cache__*`/`GITEA__session__*` n'exploite `REDIS_HOST`. |
| `reserve_static_ip` | `true` | Moyen | Sans lui, l'IP externe peut changer d'un redéploiement à l'autre, cassant le DNS et `public_url`. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une conservation réglementaire. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Gitea, partagée avec
la variante Cloud Run, est décrite dans **[Gitea_Common](Gitea_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gitea sur GKE Autopilot](../labs/Gitea_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gitea sur Google Cloud Run](Gitea_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gitea Common — Configuration applicative partagée](Gitea_Common.md) — la configuration partagée par les deux cibles de déploiement.
