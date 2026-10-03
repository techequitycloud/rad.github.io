---
title: "Fider sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Fider sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Fider_GKE.md @ 15fd4c7 sha256:a37b8a16c3b4 -->

# Fider sur GKE Autopilot {#fider-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_GKE.png" alt="Fider sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider est un tableau de bord open source, auto-hébergé, pour les retours et le
vote de fonctionnalités — les clients publient des idées, votent et commentent,
et vous priorisez en fonction de la demande. Ce module déploie Fider sur **GKE
Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Fider et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation
App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Fider s'exécute comme une seule charge de travail web Go. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Binaire Go unique, autoscalé horizontalement |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Fider ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Stockage de fichiers | PostgreSQL (pièces jointes) | Fider stocke les pièces jointes dans PostgreSQL ; le montage NFS optionnel est désactivé par défaut et inutilisé |
| Secrets | Secret Manager | `JWT_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée (`database_type = POSTGRES_15`) ; la sélection de tout autre
  moteur entraîne une erreur au démarrage.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il
  signe tous les jetons d'authentification et de session (y compris les liens
  de connexion magiques envoyés par e-mail) et **ne doit jamais être renouvelé
  après le premier démarrage** — cela invaliderait toutes les sessions actives
  et les liens de connexion en attente.
- **Fider est un binaire Go unique sans worker en arrière-plan.** Tout l'état
  réside dans PostgreSQL ; il n'y a pas de processus de file d'attente. Un
  minimum de 1 réplica est maintenu (GKE ne prend pas en charge la mise à
  l'échelle à zéro).
- **Pas de Redis.** Fider utilise une file d'attente et un cache basés sur
  PostgreSQL (`VALKEY_URL` vide), donc `enable_redis` est par défaut `false`.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Fider stocke les pièces
  jointes dans PostgreSQL et ce module ne le bascule jamais en mode système de
  fichiers, donc un partage NFS ne recevrait rien. Si vous l'activez, App_GKE
  déploie le pod avec la stratégie `Recreate` plutôt que `RollingUpdate`.
- **Le conteneur écoute sur le port 3000.** Sur GKE, la variable d'environnement
  `PORT` n'est **pas** injectée automatiquement, donc le point d'entrée
  exporte `PORT = 3000` ; `container_port` et les sondes Kubernetes doivent toutes deux être
  sur 3000, sinon le pod ne devient jamais Ready même si l'application est
  saine.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée
  personnalisé exécute `./fider migrate` avant de démarrer le serveur.
- **L'e-mail est désactivé pour la démo.** Des valeurs SMTP de substitution
  permettent à l'application de démarrer ; les liens d'inscription /
  d'invitation sont imprimés dans les journaux du pod jusqu'à ce qu'un vrai
  SMTP soit configuré via `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail Fider {#a-gke-autopilot--the-fider-workload}

Les pods Fider sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Fider pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Fider stocke toutes les données d'application (publications, votes,
commentaires, utilisateurs, paramètres) dans une instance gérée Cloud SQL pour
PostgreSQL 15. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth
Proxy** sur la boucle locale `127.0.0.1` ; aucune IP publique n'est exposée. Lors
du premier déploiement, le job `db-init` crée le rôle et la base de données de
l'application ; Fider exécute ensuite ses propres migrations au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et le renouvellement du mot de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement. Le compte de service de la charge de travail se voit accorder
l'accès. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

NFS est **désactivé par défaut** (`enable_nfs = false`) : Fider conserve les pièces
jointes dans PostgreSQL, donc le montage est inutilisé. Si vous l'activez, la
VM de serveur NFS partagée (gérée par `Services_GCP`) doit être `RUNNING` avant le
déploiement de l'application, et les pods basés sur NFS utilisent la stratégie
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
livré dans le pod via l'intégration Secret Store CSI. Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour l'intégration et le
renouvellement de Secret Store CSI.

### F. Réseau et ingress {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe Cloud
Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une adresse IP statique peut être réservée afin que
l'adresse survive aux redéploiements. Définissez `BASE_URL` (via `environment_variables`) sur
l'URL externe une fois l'adresse IP connue.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud
SQL vers Cloud Monitoring. Des tests de disponibilité et des stratégies
d'alerte optionnels sont disponibles. Lorsque l'e-mail est désactivé, les liens
d'inscription / d'invitation apparaissent dans les journaux des pods.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Fider {#3-fider-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  `db-init` exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il se connecte via le Cloud
  SQL Auth Proxy et crée de manière idempotente le rôle et la base de données
  `fider`, accorde les privilèges, réaffecte la propriété du schéma `public` au
  rôle de l'application, et signale au sidecar proxy de s'arrêter afin que le
  pod du job se termine. Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée personnalisé
  exécute `./fider migrate` avant de lancer le serveur (le `CMD` de l'image est
  remplacé par `./fider` uniquement). Les migrations sont idempotentes, donc la
  mise à niveau de la version de l'application applique les modifications de
  schéma au prochain démarrage sans étape de migration distincte.
- **`JWT_SECRET` est immuable après le premier démarrage.** Il est généré une
  fois et écrit dans Secret Manager. Le modifier invalide toutes les sessions
  utilisateur actives et tous les liens de connexion par e-mail en attente. Ne
  le renouvelez que pendant une fenêtre de maintenance planifiée.
- **Configuration initiale.** Il n'y a pas de identifiants par défaut. Accédez
  à l'adresse IP externe / URL du LoadBalancer pour créer le site et son
  propriétaire administrateur :
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```
- **L'e-mail est désactivé par défaut.** Des valeurs SMTP de substitution
  permettent à Fider de démarrer avec `EMAIL_NOEMAIL = true` ; les liens d'inscription et
  d'invitation sont imprimés dans les journaux du pod. Pour envoyer de vrais
  e-mails, définissez les variables SMTP de Fider via `environment_variables` et supprimez
  `EMAIL_NOEMAIL`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/_health`
  — un point de terminaison non authentifié renvoyant `200`. Le `container_port` et
  le port de la sonde doivent tous deux être **3000** (le point d'entrée
  exporte `PORT = 3000` ; GKE ne l'injecte pas automatiquement).
- **Les mises à jour basées sur NFS utilisent `Recreate`** (uniquement lorsque
  `enable_nfs = true`). Une mise à jour progressive exécuterait brièvement deux pods
  contre le même volume NFS et la base de données partagée ; App_GKE définit
  donc la stratégie sur `Recreate` pour les applications basées sur NFS.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Fider sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fider` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Fider (`getfider/fider:<tag>`), mappé à l'ARG de build `FIDER_VERSION`. `latest` est épinglé à `stable` (aucun tag `:latest` n'existe) ; épingler à un tag SHA en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `5` | Nombre maximum de réplicas. |
| `container_port` | `3000` | Fider écoute sur le port 3000 ; les sondes doivent correspondre. |
| `container_resources` | 2 vCPU / 4 GiB | Limites et requêtes CPU/mémoire pour le conteneur Fider. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Fider dans Artifact Registry avant le déploiement. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Configurez ici un vrai SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) ou l'URL externe `BASE_URL`. Ne définissez pas `DATABASE_URL`, `JWT_SECRET` ou `PORT`. |
| `secret_environment_variables` | `{}` | Mappage variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` | Résout en `Deployment` (la logique intégrée du module) ; Fider est sans état (l'état réside dans PostgreSQL). |
| `session_affinity` | `ClientIP` | Routage persistant (par défaut). |
| `container_protocol` | `http1` | Fider sert du HTTP/1.1 standard. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Par défaut, la logique intégrée du module. Fider stocke l'état dans PostgreSQL, donc les PVC par pod ne sont pas nécessaires. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Laisser désactivé : Fider stocke les pièces jointes dans PostgreSQL et n'écrit jamais sur le montage. Les pods basés sur NFS se déploient avec `Recreate`. |
| `nfs_mount_path` | `/opt/fider/storage` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fider est basé sur Postgres ; laisser désactivé sauf si externalisé vers Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si Redis est activé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Fider nécessite PostgreSQL 15+. |
| `application_database_name` | `fider` | Nom de la base de données de l'application. Immuable après le premier déploiement. |
| `application_database_user` | `fider` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

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
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Fider. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
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
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un réplica en
> lecture sans son primaire, IAP sans identités autorisées, un runtime
> `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une
> extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration
> invalide échoue la **planification** avec une erreur claire et nommée avant
> la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `JWT_SECRET` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler invalide toutes les sessions actives et les liens de connexion par e-mail en attente. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Tout moteur non-PostgreSQL entraîne une erreur au démarrage — Fider est uniquement compatible avec Postgres. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans source de sauvegarde valide échoue le job d'importation. |
| `container_port` | `3000` | Élevé | GKE n'injecte pas automatiquement `PORT` ; un port non concordant fait que les sondes atteignent un port mort et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `application_version` | épingler un tag SHA ; `latest` → `stable` | Élevé | `getfider/fider` n'a pas de tag `:latest` ; le module épingle `latest` à `stable`, mais épinglez explicitement pour des mises à niveau reproductibles. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `enable_nfs` | `false` (par défaut) | Moyen | Fider n'utilise pas le montage. S'il est activé, la VM NFS partagée doit être `RUNNING` avant le déploiement, et les pods basés sur NFS utilisent `Recreate`, de sorte qu'un déploiement progressif met brièvement le pod hors service. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| SMTP (`EMAIL_SMTP_*`) | Configurer pour un vrai e-mail | Moyen | Laissés comme espaces réservés, les liens d'inscription / d'invitation n'apparaissent que dans les journaux — aucun e-mail n'est envoyé. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris la navigation anonyme sur le tableau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Fider
partagée avec la variante Cloud Run est décrite dans
**[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Fider sur GKE Autopilot](../labs/Fider_GKE.md) — déployez-le
  étape par étape, avec les écrans de la console et les commandes à chaque
  étape.
- [Fider sur Google Cloud Run](Fider_CloudRun.md) — la même application sur
  Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Fider Common — Configuration d'application partagée](Fider_Common.md) — la
  configuration partagée par les deux cibles de déploiement.
