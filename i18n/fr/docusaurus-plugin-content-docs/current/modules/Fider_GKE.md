---
title: "Fider sur GKE Autopilot"
description: "Référence de configuration pour déployer Fider sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Fider_GKE.md @ 3055034 sha256:b9d84366049a -->

# Fider sur GKE Autopilot {#fider-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_GKE.png" alt="Fider sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider est un tableau open source et auto-hébergé de retours et de vote sur les
fonctionnalités — les clients publient des idées, votent et commentent, et vous
priorisez selon la demande. Ce module déploie Fider sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Fider et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Fider s'exécute sous forme d'une unique charge de travail web en Go. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Fider ne prend pas en charge MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Stockage de fichiers | Cloud Filestore (NFS) | Activé par défaut pour le stockage des pièces jointes |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par
  la couche applicative partagée (`database_type = POSTGRES_15`) ; choisir un autre
  moteur empêche le démarrage.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il
  signe tous les jetons d'authentification et de session (y compris les liens de
  connexion magiques envoyés par e-mail) et **ne doit jamais faire l'objet d'une
  rotation après le premier démarrage** — cela invaliderait toutes les sessions
  actives et les liens de connexion en attente.
- **Fider est un binaire Go unique sans worker en arrière-plan.** Tout l'état réside
  dans PostgreSQL ; il n'y a aucun processus de file d'attente. Un minimum de
  1 réplica est conservé (GKE ne prend pas en charge la mise à l'échelle à zéro).
- **Pas de Redis.** Fider utilise une file d'attente et un cache adossés à
  PostgreSQL (`VALKEY_URL` vide) ; `enable_redis` vaut donc `false` par défaut.
- **NFS est activé par défaut** (`enable_nfs = true`) afin de fournir un montage
  Cloud Filestore pour le stockage des pièces jointes. Comme le pod s'appuie sur NFS,
  App_GKE le déploie avec la stratégie `Recreate` plutôt que `RollingUpdate` (deux
  pods sur le même volume NFS peuvent se bloquer mutuellement lors des mises à jour).
- **Le conteneur écoute sur le port 3000.** Sur GKE, la variable d'environnement
  `PORT` n'est **pas** injectée automatiquement ; le point d'entrée exporte donc
  `PORT = 3000` ; `container_port` et les sondes Kubernetes doivent tous deux valoir
  3000, sinon le pod ne devient jamais Ready alors même que l'application est saine.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée
  personnalisé exécute `./fider migrate` avant de lancer le serveur.
- **L'e-mail est désactivé pour la démonstration.** Des valeurs SMTP fictives
  permettent à l'application de démarrer ; les liens d'inscription et d'invitation
  sont écrits dans le journal du pod jusqu'à ce qu'un vrai serveur SMTP soit
  configuré via `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Fider {#a-gke-autopilot--the-fider-workload}

Les pods Fider sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Fider pour consulter les pods, les révisions et les événements. Kubernetes Engine
  → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Fider stocke toutes les données de l'application (publications, votes,
commentaires, utilisateurs, paramètres) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent de manière privée via le sidecar
**Cloud SQL Auth Proxy** sur la boucle locale `127.0.0.1` ; aucune IP publique n'est
exposée. Lors du premier déploiement, le job `db-init` crée le rôle et la base de
données de l'application ; Fider exécute ensuite ses propres migrations au
démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et
la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement. Le compte de service de la charge de travail reçoit l'accès. Des
buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

NFS est **activé par défaut** (`enable_nfs = true`) afin de fournir à Fider un
montage Cloud Filestore pour le stockage des pièces jointes. La VM du serveur NFS
partagé (gérée par `Services_GCP`) doit être à l'état `RUNNING` avant le
déploiement de l'application, et les pods s'appuyant sur NFS utilisent la stratégie
de mise à jour `Recreate`.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc,pv -n "$NAMESPACE"
  ```

Fider n'utilise **pas** Redis — ne vous attendez pas à un point de terminaison
Memorystore ou Redis.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : `JWT_SECRET` (signe les jetons d'authentification et de session). Il est
fourni au pod via l'intégration Secret Store CSI. Le mot de passe de la base de
données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret
Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un
certificat géré par Google peut être activé, et une IP statique peut être réservée
afin que l'adresse survive aux redéploiements. Définissez `BASE_URL` (via
`environment_variables`) sur l'URL externe une fois l'IP connue.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques de
GKE et de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte facultatifs sont disponibles. Lorsque l'e-mail est désactivé,
les liens d'inscription et d'invitation apparaissent dans les journaux des pods.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Fider {#3-fider-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base de données
  `fider`, accorde les privilèges, transfère la propriété du schéma `public` au rôle
  de l'application et signale au sidecar du proxy de s'arrêter afin que le pod du
  job se termine. Le job peut être réexécuté sans risque.
- **Migrations de schéma au démarrage.** Le point d'entrée personnalisé exécute
  `./fider migrate` avant de lancer le serveur (le `CMD` de l'image est remplacé par
  `./fider` uniquement). Les migrations sont idempotentes ; la mise à niveau de la
  version de l'application applique donc les modifications de schéma au démarrage
  suivant, sans étape de migration séparée.
- **`JWT_SECRET` est immuable après le premier démarrage.** Il est généré une seule
  fois et écrit dans Secret Manager. Le modifier invalide toutes les sessions
  utilisateur actives et tous les liens de connexion envoyés par e-mail encore en
  attente. N'effectuez sa rotation que pendant une fenêtre de maintenance planifiée.
- **Configuration initiale.** Il n'existe aucun identifiant par défaut. Rendez-vous
  sur l'IP / l'URL externe du LoadBalancer pour créer le site et son propriétaire
  administrateur :
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```
- **L'e-mail est désactivé par défaut.** Des valeurs SMTP fictives permettent à
  Fider de démarrer avec `EMAIL_NOEMAIL = true` ; les liens d'inscription et
  d'invitation sont écrits dans le journal du pod. Pour envoyer de vrais e-mails,
  définissez les variables SMTP de Fider via `environment_variables` et supprimez
  `EMAIL_NOEMAIL`.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/_health` —
  un point de terminaison non authentifié qui renvoie `200`. Le `container_port` et
  le port de la sonde doivent tous deux valoir **3000** (le point d'entrée exporte
  `PORT = 3000` ; GKE ne l'injecte pas automatiquement).
- **Les mises à jour adossées à NFS utilisent `Recreate`.** Une mise à jour
  progressive exécuterait brièvement deux pods sur le même volume NFS et la même base
  de données partagée ; App_GKE définit donc la stratégie `Recreate` pour les
  applications adossées à NFS.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement.
Seuls les paramètres propres à Fider ou notables pour lui sont listés ; toutes les
autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs
valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fider` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Fider (`getfider/fider:<tag>`), associé à l'ARG de build `FIDER_VERSION`. `latest` est épinglé sur `stable` (il n'existe pas de tag `:latest`) ; épinglez un tag SHA en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. |
| `container_port` | `3000` | Fider écoute sur le port 3000 ; les sondes doivent correspondre. |
| `container_resources` | 2 vCPU / 4 GiB | Limites et demandes de CPU/mémoire pour le conteneur Fider. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Fider dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Configurez ici un vrai SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) ou le `BASE_URL` externe. Ne définissez pas `DATABASE_URL`, `JWT_SECRET` ni `PORT`. |
| `secret_environment_variables` | `{}` | Association variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Se résout en `Deployment` (logique intégrée du module) ; Fider est sans état (l'état réside dans PostgreSQL / NFS). |
| `session_affinity` | `ClientIP` | Routage persistant (par défaut). |
| `container_protocol` | `http1` | Fider sert du HTTP/1.1 standard. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Suit par défaut la logique intégrée du module. Fider stocke son état dans PostgreSQL et NFS ; des PVC par pod ne sont donc pas nécessaires. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Montage Cloud Filestore pour le stockage des pièces jointes de Fider. Les pods adossés à NFS sont déployés avec `Recreate`. |
| `nfs_mount_path` | `/opt/fider/storage` | Chemin de montage dans le conteneur. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fider s'appuie sur Postgres ; laissez-le désactivé sauf si vous externalisez vers Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinents uniquement si Redis est activé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Fider nécessite PostgreSQL 15+. |
| `application_database_name` | `fider` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `fider` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Association des ClusterIP des services par étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Fider. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatif) d'import. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster / la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `JWT_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives et les liens de connexion envoyés par e-mail encore en attente. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Tout moteur autre que PostgreSQL empêche le démarrage — Fider ne fonctionne qu'avec Postgres. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans source de sauvegarde valide fait échouer le job d'import. |
| `container_port` | `3000` | Élevé | GKE n'injecte pas automatiquement `PORT` ; un port incorrect fait que les sondes visent un port inactif et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `application_version` | épingler un tag SHA ; `latest` → `stable` | Élevé | `getfider/fider` n'a pas de tag `:latest` ; le module épingle `latest` sur `stable`, mais épinglez explicitement une version pour des mises à niveau reproductibles. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la règle de validation rejette les valeurs invalides. |
| `enable_nfs` | `true` (par défaut) | Moyen | La VM NFS partagée doit être à l'état `RUNNING` avant le déploiement ; les pods adossés à NFS utilisent `Recreate`, si bien qu'un déploiement arrête brièvement le pod. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers bruts sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| SMTP (`EMAIL_SMTP_*`) | Configurer pour un envoi réel | Moyen | Avec les valeurs fictives, les liens d'inscription et d'invitation n'apparaissent que dans les journaux — aucun e-mail n'est envoyé. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris la consultation anonyme du tableau. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images —
consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Fider
partagée avec la variante Cloud Run est décrite dans
**[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Fider sur GKE Autopilot](../labs/Fider_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Fider sur Google Cloud Run](Fider_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Fider Common — Configuration applicative partagée](Fider_Common.md) — la configuration partagée par les deux cibles de déploiement.
