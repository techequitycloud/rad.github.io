---
title: "Documenso sur GKE Autopilot"
description: "Référence de configuration pour déployer Documenso sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Documenso_GKE.md @ 3055034 sha256:23fafc3ffe07 -->

# Documenso sur GKE Autopilot {#documenso-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Documenso_GKE.png" alt="Documenso sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Documenso est une alternative open source à DocuSign — une application Next.js
permettant d'envoyer, de signer et de gérer des documents à signature électronique
sur une infrastructure que vous contrôlez. Ce module déploie Documenso sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Documenso et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Documenso s'exécute comme une charge de travail Next.js unique, construite à partir
d'une image personnalisée légère par-dessus l'image officielle `documenso/documenso`.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js sur le port 3000, 2 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le moteur est fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge |
| Fichiers persistants | Cloud Filestore (NFS) | Activé par défaut, monté sur `/mnt/nfs`, mais non utilisé pour le stockage des documents (voir ci-dessous) |
| Stockage objet | Cloud Storage | Un bucket `uploads` + un compte de service HMAC, provisionnés pour un transport de téléversement facultatif compatible S3 |
| Secrets | Secret Manager | `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY`, clés HMAC et (facultativement) mot de passe SMTP générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing / Gateway API | Domaine personnalisé activé par défaut avec une IP statique réservée ; repli sur un nom d'hôte `nip.io` si aucun domaine n'est défini |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est la valeur
  par défaut. La pile Next.js + Prisma de Documenso ne prend pas en charge MySQL,
  mais contrairement à certains autres modules, ce n'est **pas imposé par une
  précondition au moment du plan** — remplacer `database_type` par autre chose que
  Postgres casse silencieusement l'application au lieu de faire échouer le plan.
- **Build personnalisé, pas d'image précompilée.** `container_image_source = "custom"`
  construit une image légère `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}`
  qui ajoute `bash`, `curl`, `postgresql-client` et `openssl`, ainsi qu'un point
  d'entrée personnalisé. Le propre `sh start.sh` de l'image amont exécute les
  migrations Prisma et démarre le serveur Next.js — il n'y a pas de job de migration
  distinct.
- **Cloud SQL est joint via le sidecar Auth Proxy.** `enable_cloudsql_volume
  = true` exécute un sidecar cloud-sql-proxy ; le point d'entrée assemble
  `NEXT_PRIVATE_DATABASE_URL` à partir des valeurs `DB_*` injectées, selon qu'il
  s'agit d'un socket Unix, du proxy `127.0.0.1` ou d'une IP directe + SSL, en
  fonction de ce qui est injecté.
- **Redis est désactivé par défaut et n'est pas requis.** Documenso utilise un
  fournisseur de jobs local adossé à PostgreSQL (`enable_redis = false`). Ne
  l'activez que si vous faites passer Documenso au fournisseur de jobs `bullmq`
  (Redis).
- **NFS est activé par défaut, mais Documenso ne l'utilise pas pour les documents.**
  Les documents sont stockés dans PostgreSQL par défaut
  (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`). L'instance Filestore ainsi
  provisionnée existe surtout comme hôte Redis de repli exigé par la précondition du
  plan lorsque `enable_redis = true` — avec Redis désactivé (par défaut), elle
  représente en pratique un surcoût inutilisé.
- **Un certificat de signature est requis pour signer réellement des documents.**
  `NEXT_PRIVATE_SIGNING_TRANSPORT = "local"` attend un certificat `.p12`. Si aucun
  n'est fourni, le point d'entrée génère lui-même un certificat auto-signé jetable
  pour que l'application démarre malgré tout — mais signer avec ce certificat n'est
  pas adapté à la production.
- **`webapp_url` est vide par défaut.** Tant qu'elle n'est pas définie,
  `NEXTAUTH_URL` et `NEXT_PUBLIC_WEBAPP_URL` valent par défaut
  `http://localhost:3000` ; le point d'entrée les remplace automatiquement au
  démarrage par le `GKE_SERVICE_URL` injecté par la plateforme, mais il est
  recommandé de définir `webapp_url` explicitement dès qu'un domaine stable est
  connu.
- **Mise à zéro par défaut.** `min_instance_count = 0`,
  `max_instance_count = 3`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region "$REGION" --project "$PROJECT"`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Documenso {#a-gke-autopilot--the-documenso-workload}

Les pods Documenso sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. La charge de travail est un `Deployment` standard
(non adossé à NFS au sens qui compte pour la stratégie de déploiement, puisque les
documents résident dans Postgres et non sur le partage NFS monté).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Documenso pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe / le nom d'hôte.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE" --selector="app.kubernetes.io/name=documenso" 2>/dev/null \
    || kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Documenso stocke toutes les données applicatives (utilisateurs, documents,
destinataires, événements d'audit) dans une instance gérée Cloud SQL for
PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** ; aucune IP publique
n'est exposée. Lors du premier déploiement, le job `db-init` crée le rôle et la base
de données de l'application ; l'image Documenso exécute ensuite ses propres
migrations Prisma au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~documenso"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `uploads`, CORS activé pour un accès
direct depuis le navigateur) et un compte de service détenant une **clé HMAC** sont
provisionnés automatiquement, le compte de service de stockage recevant
`roles/storage.objectAdmin` sur le bucket. Il s'agit d'une infrastructure à
activer explicitement : Documenso n'y écrit que si vous définissez
`NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` et câblez les variables d'environnement secrètes
`S3_ACCESS_KEY` / `S3_SECRET_KEY` — par défaut, les documents sont stockés dans
PostgreSQL. Par ailleurs, un volume **NFS (Cloud Filestore)** est monté sur
`/mnt/nfs`, mais l'application n'y écrit pas dans sa configuration par défaut.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Documenso exige trois secrets au démarrage — `NEXTAUTH_SECRET`,
`NEXT_PRIVATE_ENCRYPTION_KEY` et `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` — tous
validés par Zod dans l'application Next.js, qui ne démarre pas sans eux. Sont en
outre générés `S3_ACCESS_KEY` / `S3_SECRET_KEY` (identifiants HMAC, utilisés
uniquement si le transport de téléversement S3 est activé) et, lorsque `smtp_host`
est défini, `NEXT_PRIVATE_SMTP_PASSWORD`. Le mot de passe de la base de données est
géré séparément par le socle. Sur GKE, les secrets sont projetés dans les pods via
le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~documenso"
  gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Contrairement à de nombreux modules applicatifs, Documenso définit par défaut `enable_custom_domain =
true` : une Gateway Kubernetes dotée d'une IP statique
réservée est provisionnée automatiquement. Si `application_domains` est laissé vide,
un nom d'hôte `nip.io` basé sur l'IP statique générée automatiquement est utilisé,
de sorte que l'application est immédiatement accessible en HTTPS.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,gateway -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
GKE et Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et
des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Documenso {#3-documenso-application-behaviour}

- **Configuration de la base au premier déploiement.** Le job `db-init` exécute
  `db-init.sh` avec `postgres:15-alpine`. Il attend que Cloud SQL accepte les
  connexions, puis crée de manière idempotente le rôle et la base de données de
  l'application (privilège `CREATEDB`, propriété attribuée sur la base cible),
  accorde les privilèges sur le schéma et, enfin, signale au sidecar Cloud SQL Auth
  Proxy (`POST
  /quitquitquit`) de s'arrêter afin que le job puisse se terminer. Le job peut être
  relancé sans risque (`execute_on_apply = true`, `max_retries = 3`).
- **Les migrations s'exécutent automatiquement, sans job distinct.** Le propre
  `start.sh` de l'image officielle Documenso exécute les migrations Prisma sur
  `NEXT_PRIVATE_DATABASE_URL` à chaque démarrage du conteneur, puis lance le serveur
  Next.js autonome.
- **`NEXT_PRIVATE_DATABASE_URL` est assemblée au démarrage.** Le point d'entrée
  personnalisé la construit à partir de `DB_USER`/`DB_PASSWORD`/`DB_HOST`/
  `DB_NAME`/`DB_PORT` injectés par la plateforme, selon que `DB_HOST` est un chemin
  de socket Unix, la boucle locale `127.0.0.1` de l'Auth Proxy ou une IP directe
  (auquel cas `sslmode=require` est imposé). `NEXT_PRIVATE_DIRECT_DATABASE_URL` en
  est le reflet.
- **Aucun compte administrateur initial.** Ce module ne crée pas d'utilisateur
  administrateur/propriétaire Documenso. La première personne qui termine
  l'inscription via l'interface web de l'application devient le propriétaire du
  compte — comportement standard de Documenso en amont, et non quelque chose que ce
  module provisionne.
- **Le certificat de signature est une étape post-déploiement requise pour une
  signature réelle.** Sans certificat fourni, le point d'entrée génère lui-même un
  `.p12` auto-signé jetable dans `/opt/documenso/cert.p12` afin que l'application
  démarre et que les fonctionnalités hors signature fonctionnent, en journalisant un
  avertissement bien visible. Pour une signature en production, fournissez un
  véritable certificat via `secret_environment_variables` en associant
  `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (`.p12` encodé en base64) et
  `NEXT_PRIVATE_SIGNING_PASSPHRASE`.
- **Résolution de l'URL de la webapp.** `NEXTAUTH_URL` / `NEXT_PUBLIC_WEBAPP_URL`
  valent par défaut `http://localhost:3000`. S'ils ont toujours cette valeur au
  démarrage du conteneur, le point d'entrée les remplace tous deux par le
  `GKE_SERVICE_URL` injecté par la plateforme. Définissez `webapp_url` explicitement
  dès qu'un domaine personnalisé est enregistré, afin que les liens OAuth et des
  e-mails restent stables d'un redéploiement à l'autre.
- **Chemin de santé.** La sonde de démarrage est une requête **HTTP** `GET /` sur le
  port 3000 avec une marge généreuse (`period_seconds = 30`, `failure_threshold = 20`,
  ≈10 minutes) pour absorber le démarrage à froid et les migrations Prisma ; la sonde
  de vivacité est une requête **HTTP** `GET /` avec un délai initial de 60 s.
  Documenso n'a pas de point de terminaison de santé dédié.
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DATABASE_URL|WEBAPP_URL|SIGNING'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Documenso ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard. La liste complète de toutes les
variables déclarées, y compris celles héritées sans modification du socle, figure
dans le [README du module](https://github.com/techequitycloud/partner-modules/blob/main/modules/Documenso_GKE/README.md).

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `documenso` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Documenso` | Nom lisible affiché dans la console GCP. |
| `application_version` | `latest` | Définit l'argument de build `DOCUMENSO_VERSION` de l'image de base du build personnalisé `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}`. |
| `description` | `"Documenso - The Open Source DocuSign Alternative"` | Renseigne le champ de description de la charge de travail GKE. |
| `application_description` | `"Documenso on GKE Autopilot"` | **Non référencée** — `description` (ci-dessus) est prioritaire et contrôle à sa place la description de la charge de travail. |
| `webapp_url` | `""` | URL publique de l'instance. À définir après le premier déploiement (ou l'enregistrement d'un domaine personnalisé) pour que les callbacks NextAuth et les liens des e-mails soient stables. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure, sans déployer la charge de travail. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `2000m` | 2 vCPU par pod (surcharge propre à l'application ; la variable générique `container_resources` n'est pas transmise pour ce module). |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `min_instance_count` | `0` | Mise à zéro par défaut. |
| `max_instance_count` | `3` | Plafond du HPA. |
| `container_port` | `3000` | Port du serveur Next.js de Documenso. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` est disponible si une future version amont a besoin de gRPC/HTTP2. |
| `timeout_seconds` | `300` | Durée maximale d'une requête. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy — requis pour la connectivité à la base sur GKE. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |
| `container_image_source` / `container_image` / `container_resources` / `container_build_config` | — | **Non référencées.** `Documenso_Common` effectue toujours le build personnalisé et fixe ses propres limites de ressources à partir de `cpu_limit`/`memory_limit` ; ces variables reprises du socle n'ont aucun effet sur ce module. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en clair ; les variables essentielles de Documenso sont injectées automatiquement. |
| `secret_environment_variables` | `{}` | Références Secret Manager supplémentaires injectées comme variables d'environnement. |
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP. Laissez vide pour désactiver l'e-mail (invitations, notifications de signature). |
| `smtp_port` / `smtp_secure_enabled` | `587` / `false` | Utilisez `465` + `true` pour le TLS implicite, sinon STARTTLS sur `587`. |
| `smtp_user` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | `""` | Génère automatiquement une valeur dans Secret Manager lorsqu'il est laissé vide et que `smtp_host` est défini. |
| `mail_from` | `""` | Adresse d'expéditeur des e-mails sortants de Documenso. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe / Gateway pour l'interface Documenso. |
| `workload_type` | `Deployment` | Documenso n'utilise ni StatefulSet ni PVC. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client atteigne toujours le même pod. |
| `network_tags` | `["nfsserver"]` | Requis pour la connectivité NFS lorsque `enable_nfs = true` (par défaut). |
| `gke_cluster_name` / `namespace_name` | `""` | Laissez vide pour la découverte automatique / un nom d'espace de noms généré automatiquement. |
| `gke_cluster_selection_mode` / `enable_multi_cluster_service` / `prereq_gke_subnet_cidr` / `extra_service_ports` | — | **Non référencées** par ce module — variables reprises du socle sans effet ici. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé par Documenso (`workload_type = "Deployment"` par défaut). Toutes les variables `stateful_*` sont héritées sans modification d'[App_GKE](App_GKE.md).

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

`enable_resource_quota` et toutes les variables `quota_*` sont déclarées par souci
de cohérence avec les conventions du socle, mais ne sont **pas transmises** par ce
module — elles n'ont aucun effet sur le déploiement de Documenso.

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, `failure_threshold=20`, `period_seconds=30` | Sonde propre à Documenso, transmise via la sortie `config` du module Common ; remplace en pratique la valeur par défaut générique `startup_probe_config` du socle pour cette application. |
| `liveness_probe` | HTTP `/`, `initial_delay_seconds=60`, `failure_threshold=3` | Même mécanisme que `startup_probe` ; remplace la valeur par défaut générique `health_check_config`. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` (qui crée uniquement la base de données et le rôle). |
| `cron_jobs` / `additional_services` | `[]` | Aucun job planifié ni sidecar par défaut. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — voir
[App_GKE](App_GKE.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode` (cette dernière **est**
transmise par Documenso, contrairement à plusieurs autres variables reprises du
groupe 12 dans d'autres modules).

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne Filestore. Non utilisé par défaut pour le stockage des documents — voir la [Vue d'ensemble](#1-overview). Pertinent surtout comme hôte Redis de repli si `enable_redis` est activé ultérieurement. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage dans le conteneur (inutilisé par la configuration par défaut de l'application). |
| `nfs_instance_name` / `nfs_instance_base_name` | `""` / `app-nfs` | VM NFS existante à réutiliser, ou nom de base d'une VM créée à la volée. |
| `nfs_volume_name` | `nfs-data-volume` | **Non transmise** par ce module — sans effet. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | `Documenso_Common` provisionne en outre toujours son propre bucket `uploads` (CORS activé), indépendamment de ce paramètre. |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse monté par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Rétention des images dans Artifact Registry. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Documenso utilise un fournisseur de jobs local adossé à PostgreSQL et ne nécessite pas Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinentes uniquement si vous faites passer Documenso au fournisseur de jobs `bullmq`. |
| `cubejs_api_url` / `hub_api_url` | `http://localhost:4000` / `http://localhost:8080` | **Reliquats inertes** du modèle de variables dérivé de Formbricks de ce module — transmises à `Documenso_Common` mais jamais lues par aucune variable d'environnement, aucun Dockerfile ni aucune logique du point d'entrée. Sans effet sur le déploiement. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Non imposée au moment du plan** — la remplacer par autre chose que Postgres casse le schéma Prisma de Documenso à l'exécution au lieu de faire échouer le plan. |
| `db_name` | `documenso` | La base de données réellement créée et injectée comme `DB_NAME`. |
| `db_user` | `documenso` | Le rôle réellement créé et injecté comme `DB_USER` ; mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré automatiquement. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Le schéma Prisma de Documenso ne requiert aucune extension personnalisée. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Sans objet — Documenso nécessite PostgreSQL. |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Instance Cloud SQL existante à réutiliser, ou nom de base d'une instance créée à la volée. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Rotation du mot de passe de la base sans interruption de service. |

`application_database_name` (par défaut `documensodb`) et
`application_database_user` (par défaut `documensouser`) sont également déclarées
sur ce module mais ne sont **pas transmises** au socle — `main.tf` câble
`db_name`/`db_user` (ci-dessus) à leur place. Définir les variables
`application_database_*` n'a aucun effet. Les cinq variables `db_*_env_var_name`
(host, name, password, port, user) sont de même déclarées mais non transmises.

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; à augmenter pour la production / la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaure depuis une sauvegarde lors du déploiement. `backup_uri` est la valeur réellement transmise au socle. |
| `backup_file` | `backup.sql` | **Non référencée** — c'est `backup_uri` (ci-dessus) qui est réellement utilisée ; définir `backup_file` n'a aucun effet. |

### Groupe 18 — Scripts SQL personnalisés {#group-18--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutent du SQL depuis un bucket GCS après le
provisionnement. Voir [App_GKE](App_GKE.md).

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway + une IP statique par défaut (contrairement à la plupart des autres modules, qui le désactivent par défaut). |
| `application_domains` | `[]` | S'il est vide, un nom d'hôte `nip.io` basé sur l'IP statique générée automatiquement est utilisé. |
| `reserve_static_ip` | `true` | Maintient l'adresse externe stable d'un redéploiement à l'autre. |
| `static_ip_name` | `""` | Laissez vide pour une génération automatique. |
| `network_name` | `""` | **Non référencée** — la découverte du réseau est codée en dur en interne ; sans effet. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

`enable_iap`, `iap_authorized_users`/`iap_authorized_groups`,
`iap_oauth_client_id`/`iap_oauth_client_secret` (sensibles), `iap_support_email`
— contrôle d'accès IAP standard d'App_GKE devant la Gateway. Voir [App_GKE](App_GKE.md).

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

`enable_cloud_armor`, `admin_ip_ranges`, `cloud_armor_policy_name`, `enable_cdn`
— configuration WAF/CDN standard d'App_GKE. Voir [App_GKE](App_GKE.md).

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`,
`enable_audit_logging` — configuration standard du périmètre VPC-SC d'App_GKE. Voir
[App_GKE](App_GKE.md).

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

Métadonnées propres à la plateforme / à l'interface (`module_description`,
`module_documentation`, `module_dependency`, `requires_services`,
`module_services`, `credit_cost`, `require_credit_purchases`, `enable_purge`,
`public_access`, `require_services_gcp_module`, `shared_users`,
`technical_support_users`, `resource_creator_identity`,
`impersonation_service_account`, `job_execution_wait_timeout`), plus trois
variables déclarées mais inertes (`application_module`, `explicit_secret_values`,
`scripts_dir` — le module câble en interne ses propres valeurs de secrets et son
chemin de scripts depuis `Documenso_Common`). Aucune d'elles n'affecte
l'infrastructure déployée ; consultez le
[README du module](https://github.com/techequitycloud/partner-modules/blob/main/modules/Documenso_GKE/README.md#module-metadata-group-0)
pour le tableau complet.

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Documenso. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms du job de configuration (`db-init`) et du job d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster / la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé avec un paramètre sans état, IAP sans identité autorisée, des `quota_memory_*` donnés sous forme d'entiers nus, un `container_port`/`backup_retention_days` hors limites. Le propre `validation.tf` de ce module bloque en outre `min_instance_count > max_instance_count`, `enable_redis = true` sans `redis_host` ni `enable_nfs`, `enable_iap = true` sans les deux identifiants OAuth, et `enable_cloudsql_volume = true` avec `database_type = "NONE"`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource — mais remplacer `database_type` par autre chose que Postgres ne fait *pas* partie des contrôles, si bien que cette erreur n'est détectée qu'à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critical | Non validé au plan — passer à MySQL/SQL Server casse Prisma et toutes les requêtes à l'exécution, et non au moment du plan. |
| Certificat de signature (`NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`) | Fournir un véritable `.p12` après le déploiement | Critical | Sans lui, le point d'entrée auto-signe un certificat jetable — les documents sont « signés », mais la signature n'est pas reconnue par les lecteurs PDF ; inadapté à la production. |
| `NEXT_PRIVATE_ENCRYPTION_KEY` / `_SECONDARY_KEY` (générées automatiquement) | Ne jamais les modifier directement | Critical | Elles chiffrent les données de Documenso ; faites-les tourner uniquement via l'emplacement de la clé secondaire, jamais en régénérant la clé principale sur place. |
| `webapp_url` | À définir dès que l'URL / le domaine est connu | High | Non définie, `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` suivent la valeur que prend `GKE_SERVICE_URL` à chaque démarrage ; une valeur explicite maintient les callbacks d'authentification et les liens des e-mails stables d'un redéploiement à l'autre. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour le chemin de connectivité à la base par défaut du point d'entrée sur GKE. |
| `db_name` / `db_user` | À définir une fois | High | Les renommer après le premier déploiement fait pointer l'application vers un rôle / une base différents (vides) — `application_database_name`/`application_database_user` sont des leurres inertes ; les modifier n'a aucun effet. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Des entiers nus sont interprétés en octets et bloquent tout ordonnancement de pod dans l'espace de noms. |
| `enable_nfs` | `true` (par défaut) ou `false` si Redis reste désactivé | Medium | Filestore est facturé que l'application y écrive ou non ; avec `enable_redis = false` (par défaut), le montage NFS est un surcoût inutilisé. |
| `smtp_host` | À définir pour la production | Medium | Laissé vide, aucune variable `NEXT_PRIVATE_SMTP_*` n'est injectée — aucun e-mail d'invitation ni de notification de signature n'est envoyé. |
| `enable_custom_domain` / `reserve_static_ip` | `true` (par défaut) | Medium | Sans IP ou domaine stable, le nom d'hôte de repli `nip.io` peut changer, ce qui casse `webapp_url` et les callbacks OAuth d'un redéploiement à l'autre. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Documenso partagée
avec la variante Cloud Run (secrets, job `db-init` et point d'entrée personnalisé)
est décrite dans **Documenso_Common** (source du module :
`modules/Documenso_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Documenso sur GKE Autopilot](../labs/Documenso_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Documenso sur Google Cloud Run](Documenso_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Documenso Common — Configuration applicative partagée](Documenso_Common.md) — la configuration partagée par les deux cibles de déploiement.
