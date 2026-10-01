---
title: "Tolgee sur GKE Autopilot"
description: "Référence de configuration pour déployer Tolgee sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Tolgee_GKE.md @ 3055034 sha256:0b3ffbae5b46 -->

# Tolgee sur GKE Autopilot {#tolgee-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Tolgee_GKE.png" alt="Tolgee sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Tolgee est une plateforme open source de **localisation (i18n) et de gestion des traductions**,
pensée pour les développeurs et construite sur Spring Boot. Ce module déploie Tolgee sur **GKE
Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Tolgee et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Tolgee s'exécute comme une charge de travail web Java / Spring Boot. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Spring Boot, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Tolgee ne prend en charge ni MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket pour le stockage de fichiers facultatif (captures d'écran/imports) |
| Secrets | Secret Manager | Mot de passe administrateur initial et secret de signature JWT générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche applicative
  partagée ; choisir un autre moteur empêche le démarrage.
- **Tolgee se connecte à Cloud SQL en TCP via la boucle locale de l'Auth Proxy.** Son pilote JDBC
  PostgreSQL intégré ne peut pas utiliser de socket Unix ; sur GKE, le point d'entrée se connecte donc au
  sidecar Cloud SQL Auth Proxy sur `127.0.0.1` (TCP simple, sans SSL — le proxy
  termine le TLS). `enable_cloudsql_volume` vaut par conséquent **`true`** par défaut.
- **Le secret JWT est généré automatiquement** et stocké dans Secret Manager. Il ne doit
  jamais faire l'objet d'une rotation après le premier démarrage sans fenêtre de maintenance — sa rotation
  invalide immédiatement toutes les sessions utilisateur actives.
- **`SERVER_PORT`, et non `PORT`.** Tolgee lit `SERVER_PORT = 8080` ; le module le définit
  explicitement sur le conteneur.
- **L'affinité de session vaut `ClientIP` par défaut**, afin que les sessions d'interface d'un même client
  reviennent vers le même pod.
- **Pas de Redis.** Tolgee stocke tout l'état des traductions dans PostgreSQL ; `enable_redis`
  vaut `false` par défaut.
- **Au moins 1 réplica est maintenu** (GKE ne prend pas en charge la mise à zéro) ; `max_instance_count`
  vaut `5` par défaut, mais conservez-le à `1` pour un déploiement avec état à écrivain unique, sauf si vous
  avez validé la sûreté des écritures concurrentes.
- **Le schéma est créé par Liquibase au premier démarrage** — pas de job de migration distinct.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Tolgee {#a-gke-autopilot--the-tolgee-workload}

Les pods Tolgee sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement demandés
par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et maximal
de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Tolgee pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail (Deployment
ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Tolgee stocke toutes les données applicatives (projets, langues, clés, traductions, utilisateurs) dans une
instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1` en TCP (le pilote JDBC de Tolgee ne peut pas utiliser de socket Unix) ;
aucune IP publique n'est exposée. Lors du premier déploiement, l'étape `create-db-and-user.sh` du socle
crée la base de données et le rôle, et Tolgee exécute ses propres migrations Liquibase au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous exposés dans les [sorties](#5-outputs). Pour le modèle de connexion,
les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** (`name_suffix = "storage"`) est provisionné pour le stockage de fichiers
facultatif — Tolgee conserve les traductions dans PostgreSQL ; ce bucket ne contient donc que les
captures d'écran téléversées ou les artefacts d'import si vous le montez via `gcs_volumes` ou si vous configurez le
stockage de fichiers compatible S3 de Tolgee. Le compte de service de la charge de travail se voit accorder l'accès.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket>/            # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : le **mot de passe administrateur
initial** (`TOLGEE_AUTHENTICATION_INITIAL_PASSWORD`), utilisé pour la première connexion,
et le **secret de signature JWT** (`TOLGEE_AUTHENTICATION_JWT_SECRET`), utilisé pour signer tous les jetons
de session utilisateur. Le mot de passe de la base de données est géré séparément par le socle. Sur GKE, la
couche Common expose également les valeurs brutes des secrets, afin que la charge de travail puisse contourner la cohérence
lecture-après-écriture de Secret Manager (le modèle Keycloak/Directus).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~admin-password OR name~jwt-secret"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être
activé, et `reserve_static_ip` vaut **`true`** par défaut — il s'agit d'une valeur par défaut nécessaire, et non
d'un simple confort facultatif : `App_GKE` calcule le `GKE_SERVICE_URL` injecté dans le conteneur
à partir de l'IP statique *réservée*, mais se rabat sur le nom d'hôte interne au cluster, injoignable,
`*.svc.cluster.local` lorsqu'aucune IP statique n'est réservée et que l'IP éphémère du
LoadBalancer n'est pas encore connue au moment où Terraform génère les variables d'environnement du Deployment.
Tolgee fait partie des modules corrigés par cette valeur par défaut lors de la campagne de vérification GKE
menée sur l'ensemble du parc (consultez [Variables de configuration → Groupe 19](#group-19--custom-domain-static-ip--networking)).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et Cloud SQL à Cloud
Monitoring. Des tests de disponibilité (sur `/actuator/health`) et des règles d'alerte facultatifs sont
disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Tolgee {#3-tolgee-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Aucun job d'initialisation dédié ne s'exécute — l'étape
  `create-db-and-user.sh` du socle App_GKE crée le rôle et la base de données PostgreSQL et accorde la propriété
  du schéma. Tolgee crée ensuite et migre automatiquement l'intégralité de son schéma avec **Liquibase**
  au premier démarrage.
- **Migrations au démarrage.** Tolgee applique ses changesets Liquibase à chaque démarrage ; ainsi,
  la mise à niveau de `application_version` applique les changements de schéma sans étape distincte.
- **Le secret JWT est immuable après le premier démarrage.** Il est généré une seule fois, écrit dans
  Secret Manager et maintenu stable entre les redémarrages et les réplicas. La rotation de
  `TOLGEE_AUTHENTICATION_JWT_SECRET` invalide immédiatement toutes les sessions utilisateur actives —
  n'effectuez cette rotation que pendant une fenêtre de maintenance planifiée.
- **Connexion au premier lancement.** Après le déploiement, connectez-vous en tant que propriétaire initial :
  `TOLGEE_AUTHENTICATION_INITIAL_USERNAME` (par défaut `admin@techequity.cloud`) avec le
  mot de passe généré stocké dans Secret Manager. Modifiez le mot de passe et configurez des fournisseurs
  d'authentification supplémentaires (Google/OAuth2/SSO) depuis l'interface de Tolgee avant la mise en service.
- **Chemin de santé.** Les sondes de disponibilité, de démarrage et de vivacité ciblent **`/actuator/health`**,
  qui ne renvoie un `200` non authentifié qu'une fois les migrations Liquibase terminées. Prévoyez
  plusieurs minutes au premier démarrage (délai initial de 60 secondes plus une large fenêtre d'échecs) —
  Spring Boot et les migrations du premier lancement démarrent plus lentement qu'une application Node typique.
- **Écrivain unique par conception.** Tolgee ne dispose d'aucune couche de file d'attente ou de coordination ; passer à plus d'un
  pod fait tourner des écrivains concurrents sur la même base de données et le même volume NFS de pièces jointes. Conservez un
  seul réplica, sauf si vous avez validé la sûreté des écritures concurrentes pour votre charge de travail.
- **Inspectez le câblage de la base de données injecté dans le pod en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'SPRING_DATASOURCE|SERVER_PORT'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Tolgee ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `tolgee` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Tolgee utilisé comme `FROM tolgee/tolgee:<tag>` pour le build du wrapper personnalisé léger. Épinglez une version (par ex. `v3.130.4`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_resources` | `cpu_limit=2000m`, `memory_limit=4Gi` | Tolgee nécessite **au moins 2 GiB** de mémoire pour fonctionner de manière fiable. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1 (pas de mise à zéro). |
| `max_instance_count` | `5` | Nombre maximal de réplicas. Conservez `1` sauf si la sûreté des écritures concurrentes a été validée. |
| `container_port` | `8080` | `SERVER_PORT` Spring Boot de Tolgee. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — obligatoire ; Tolgee se connecte au proxy sur `127.0.0.1` en TCP. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `session_affinity` | `ClientIP` | Routage persistant afin que les sessions d'interface reviennent vers le même pod. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (Deployment) | Tolgee stocke tout son état dans PostgreSQL/NFS ; un StatefulSet avec des PVC par pod n'est donc pas nécessaire. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un NFS Cloud Filestore pour le stockage facultatif des pièces jointes de Tolgee. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour le bucket de stockage de fichiers facultatif. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Laissez désactivé — Tolgee stocke tout son état dans PostgreSQL et n'a pas besoin de Redis. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `tolgee` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `tolgee` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress Kubernetes avec un certificat géré par Google pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Noms d'hôte servis par l'Ingress. |
| `reserve_static_ip` | `true` | **Valeur par défaut structurante, et pas simplement « peut être réservée ».** `App_GKE` calcule le `GKE_SERVICE_URL` injecté (ainsi que toute URL auto-référencée que Tolgee intègre à sa configuration au démarrage) à partir de l'IP statique *réservée* ; avec `reserve_static_ip = false`, Terraform se rabat sur le nom d'hôte interne au cluster `*.svc.cluster.local` si l'IP éphémère du LoadBalancer n'est pas encore connue lorsque les variables d'environnement du Deployment sont générées — une situation de concurrence réelle et reproductible, et non un cas limite théorique. Tolgee fait partie des modules corrigés en passant cette valeur à `true` lors de la campagne de vérification GKE menée sur l'ensemble du parc ; la laisser à `false` risque de faire pointer le service vers une adresse injoignable depuis l'extérieur du cluster. |
| `static_ip_name` | `""` | Nom de l'IP statique réservée. Laissez vide pour une génération automatique. |
| `network_tags` | `["nfsserver"]` | Tags réseau des nœuds et des pods ; `nfsserver` est obligatoire lorsque `enable_nfs = true`. |
| `gateway_backend_stage` | `"dev"` | Étape Cloud Deploy dont le Service est ciblé par la HTTPRoute de la Gateway (ignoré lorsque `enable_cloud_deploy = false`). |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL d'accès à Tolgee. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `redis_port`/`backup_retention_days` hors plage, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, une mémoire de ResourceQuota sans suffixe d'unité binaire. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `TOLGEE_AUTHENTICATION_JWT_SECRET` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions utilisateur actives et oblige tout le monde à se reconnecter immédiatement. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Critique | Le sidecar Auth Proxy est nécessaire à la connexion JDBC TCP de Tolgee ; le désactiver supprime le point de terminaison `127.0.0.1` et casse la connexion à la base de données. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous d'environ 2 GiB, la JVM Spring Boot tombe en OOM pendant les migrations Liquibase du premier démarrage. |
| `max_instance_count` | `1` sauf validation | Élevé | Tolgee n'a pas de couche de coordination ; plusieurs écrivains concurrents sur une même base de données ou un même volume NFS peuvent entrer en conflit. |
| `session_affinity` | `ClientIP` | Élevé | Sans affinité, les sessions d'interface passent d'un pod à l'autre et les utilisateurs sont déconnectés de façon inattendue. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; le garde-fou de validation rejette `0`. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `application_version` | Épinglée en production | Élevé | `latest` peut récupérer une nouvelle version majeure avec des migrations incompatibles lors d'un redéploiement. |
| `startup_probe` (`/actuator/health`) | Conserver la large fenêtre du premier démarrage | Moyen | Une fenêtre trop étroite fait échouer le pod alors que les migrations Liquibase sont encore en cours sur une base neuve. |
| `enable_redis` | `false` | Moyen | Redis n'est pas utilisé ; l'activer ajoute un coût sans bénéfice. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Tolgee, partagée avec la variante Cloud Run, est décrite dans
**[Tolgee_Common](Tolgee_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Tolgee sur GKE Autopilot](../labs/Tolgee_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Tolgee sur Google Cloud Run](Tolgee_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Tolgee Common — Configuration applicative partagée](Tolgee_Common.md) — la configuration partagée par les deux cibles de déploiement.
