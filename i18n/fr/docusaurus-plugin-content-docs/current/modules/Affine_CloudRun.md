---
title: "AFFiNE sur Google Cloud Run"
description: "Référence de configuration pour déployer AFFiNE sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Affine_CloudRun.md @ 3055034 sha256:90b3216c4532 -->

# AFFiNE sur Google Cloud Run {#affine-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Affine_CloudRun.png" alt="AFFiNE sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

AFFiNE est une base de connaissances open source, centrée sur la confidentialité, qui réunit documents, tableaux blancs et bases de données dans un même espace de travail — une alternative auto-hébergeable à Notion et Miro. Ce module déploie AFFiNE sur **Cloud Run v2**, au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise AFFiNE et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Le serveur auto-hébergé d'AFFiNE s'exécute comme un conteneur Node.js unique sur Cloud Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 2 vCPU / 4 GiB par défaut, instance unique toujours active |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — AFFiNE ne prend pas en charge MySQL (vérifié au moment du plan) |
| Collaboration en temps réel | Redis | **Obligatoire** — pub/sub de synchronisation des documents Yjs et file de jobs ; l'hôte NFS héberge aussi le Redis par défaut |
| Stockage des blobs | Filestore / NFS | Pièces jointes téléversées conservées dans `/root/.affine/storage` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement ; AFFiNE n'a besoin d'aucun secret applicatif |
| Image de conteneur | Cloud Build + Artifact Registry | Build personnalisé léger au-dessus de `ghcr.io/toeverything/affine` |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Une validation au moment du plan limite `database_type` aux versions de PostgreSQL ; MySQL est rejeté.
- **Redis est obligatoire.** Une validation au moment du plan fait échouer le déploiement si `enable_redis = false`. Sans `redis_host` explicite, l'IP du serveur NFS est utilisée comme point de terminaison Redis.
- **Instance unique par conception.** `min_instance_count = 1`, `max_instance_count = 1`, `cpu_always_allocated = true` — les WebSockets de collaboration en temps réel doivent rester accessibles et alimentés en CPU, et l'état de collaboration propre à chaque processus ainsi que les blobs sur le système de fichiers rendent la mise à l'échelle horizontale dangereuse.
- **Pas de socket Cloud SQL.** `enable_cloudsql_volume = false` : AFFiNE utilise un `DATABASE_URL` de type URL-authority qui ne peut pas contenir les deux-points du chemin du socket ; le point d'entrée se connecte donc via l'IP privée de l'instance avec `sslmode=require`.
- **Deux jobs d'initialisation à l'application.** `db-init` crée de manière idempotente la base de données et l'utilisateur ; `affine-migrate` exécute le `self-host-predeploy` d'AFFiNE (migration du schéma + génération de la clé de signature) avant le démarrage du serveur.
- **Aucun secret applicatif.** AFFiNE conserve sa propre clé de signature dans PostgreSQL lors de la migration ; seul le **mot de passe de la base de données** généré automatiquement réside dans Secret Manager.
- **Les sondes de santé ciblent `/`** — AFFiNE renvoie HTTP 200 sur son chemin racine une fois prêt.
- **`application_version = "latest"` correspond à `stable`** — AFFiNE ne publie pas de tag d'image `latest`.
- **La recherche plein texte/vectorielle est désactivée** (`AFFINE_INDEXER_ENABLED = "false"`) — l'indexeur nécessite un backend vectoriel qui n'est pas provisionné ici.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service AFFiNE {#a-cloud-run--the-affine-service}

AFFiNE s'exécute comme un service Cloud Run v2 épinglé sur une instance unique toujours active. Chaque déploiement crée une révision immuable ; le trafic bascule vers la plus récente qui est saine.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

AFFiNE stocke les espaces de travail, les documents, les utilisateurs et sa propre clé de signature dans une instance gérée Cloud SQL for PostgreSQL 15. Comme le `DATABASE_URL` d'AFFiNE est un DSN de type URL-authority, le service se connecte via l'**IP privée avec TLS** (`sslmode=require`) plutôt que par le socket de l'Auth Proxy. Au premier déploiement, le job `db-init` crée la base de données et l'utilisateur de l'application, puis `affine-migrate` crée le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis — collaboration en temps réel {#c-redis--real-time-collaboration}

Redis porte le pub/sub de synchronisation des documents Yjs d'AFFiNE et sa file de jobs en arrière-plan — le déploiement refuse de produire un plan sans lui. Lorsqu'aucun `redis_host` externe n'est configuré, le Redis hébergé sur le serveur NFS partagé est utilisé automatiquement.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée) ; Compute Engine → VM instances (l'hôte NFS/Redis).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info clients
  ```

### D. Filestore (NFS) et Cloud Storage {#d-filestore-nfs-and-cloud-storage}

Les blobs téléversés (images, pièces jointes, fichiers intégrés) sont écrits sur un partage **NFS** monté sur `/root/.affine/storage`, afin de survivre aux révisions et aux redémarrages. Un bucket **Cloud Storage** dédié (suffixe `storage`) est également provisionné automatiquement. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances (ou Compute Engine → VM instances pour la VM NFS autogérée) ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données généré automatiquement est le seul secret — AFFiNE génère et stocke sa clé de signature dans PostgreSQL pendant le job `affine-migrate` ; il n'existe donc aucun secret applicatif à gérer ou à faire tourner.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'ingress et la sortie VPC contrôlent la connectivité. Le point d'entrée cloud définit par défaut `AFFINE_SERVER_EXTERNAL_URL` sur l'URL du service injectée, afin que les invitations et les liens de partage se résolvent correctement.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application AFFiNE {#3-affine-application-behaviour}

- **Configuration de la base de données en deux étapes.** À l'application, `db-init` (image `postgres:15-alpine`) crée de manière idempotente le rôle et la base de données AFFiNE, accorde les privilèges et tente d'accorder `cloudsqlsuperuser` afin que les migrations puissent exécuter `CREATE EXTENSION`. Ensuite, `affine-migrate` exécute `node ./scripts/self-host-predeploy` d'AFFiNE à l'aide de l'image applicative construite — migration idempotente du schéma **et génération de la clé de signature**. Les deux peuvent être réexécutés sans risque ; `affine-migrate` effectue jusqu'à 3 tentatives.
- **La clé de signature réside dans la base de données.** Contrairement à la plupart des applications, il n'y a pas de variable d'environnement de type `APP_SECRET` : la clé générée par `self-host-predeploy` est conservée dans PostgreSQL, de sorte que le déploiement ne porte aucun secret applicatif susceptible de se désynchroniser ou à faire tourner.
- **Assemblage du DSN au démarrage.** Le point d'entrée cloud construit `DATABASE_URL` à partir des variables `DB_*` injectées par le socle (en encodant les identifiants pour l'URL) et associe `REDIS_HOST/PORT/AUTH` aux `REDIS_SERVER_*` d'AFFiNE. Sur Cloud Run, il se connecte à l'IP privée de Cloud SQL avec `sslmode=require` ; une variable d'environnement `DATABASE_URL` prédéfinie est prioritaire.
- **URL externe.** `AFFINE_SERVER_EXTERNAL_URL` vaut par défaut l'URL du service Cloud Run. Définissez-la explicitement (via `environment_variables`) une fois un domaine personnalisé en service, afin que les liens de partage et les e-mails d'invitation utilisent le bon hôte.
- **Configuration du premier lancement.** Ouvrez l'URL du service et créez le premier compte — sur une nouvelle instance AFFiNE auto-hébergée, le premier utilisateur inscrit devient l'administrateur du serveur, et le panneau d'administration se trouve à `<url>/admin`.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité (readiness) ciblent `/`, qui renvoie HTTP 200 une fois le serveur prêt (fenêtre de démarrage : délai initial de 60 s + jusqu'à 30 × 15 s).
- **Contrainte de mise à l'échelle.** Le service est épinglé sur exactement une instance toujours active. Les blobs sur le système de fichiers NFS et l'état Yjs propre à chaque processus rendent plusieurs instances dangereuses ; procédez plutôt à une mise à l'échelle verticale (`cpu_limit` / `memory_limit`).
- **Vérification :**
  ```bash
  SERVICE=$(gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~affine" --format="value(metadata.name)" --limit=1)
  SERVICE_URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT" \
    --region "$REGION" --format="value(status.url)")
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"    # expect 200
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à AFFiNE ou notables pour lui sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès IAM et les alertes de surveillance. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `affine` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `stable` | Tag d'image pour `ghcr.io/toeverything/affine` ; `latest` correspond à `stable`. Incrémentez-le pour déclencher un nouveau build et une nouvelle révision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `2000m` / `4Gi` | AFFiNE a besoin d'au moins 2Gi pour fonctionner de manière fiable. |
| `container_port` | `3010` | Port natif du serveur auto-hébergé d'AFFiNE. |
| `min_instance_count` | `1` | Garde le serveur WebSocket de collaboration toujours accessible — la mise à l'échelle jusqu'à zéro interrompt les sessions d'édition en direct. |
| `max_instance_count` | `1` | **Épinglé.** Les blobs sur le système de fichiers + l'état de collaboration propre à chaque processus rendent la mise à l'échelle horizontale dangereuse. |
| `cpu_always_allocated` | `true` | La synchronisation Yjs par WebSocket est privée de CPU avec la limitation du CPU basée sur les requêtes — conservez true pour un éditeur collaboratif en direct. |
| `enable_cloudsql_volume` | `false` | Le `DATABASE_URL` de type URL-authority d'AFFiNE ne peut pas contenir le chemin du socket Cloud SQL ; le point d'entrée utilise l'IP privée avec `sslmode=require`. |
| `container_image_source` | `custom` | Le build d'encapsulation léger fournit le point d'entrée cloud — obligatoire. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionnées par-dessus les valeurs par défaut d'`Affine_Common` (`NODE_ENV`, `AFFINE_SERVER_HOST/PORT`, `AFFINE_CONFIG_PATH`, `AFFINE_INDEXER_ENABLED=false`). Ne définissez jamais `PORT` — c'est un nom réservé de Cloud Run qui fait échouer la création des Jobs. |
| `secret_environment_variables` | `{}` | AFFiNE n'a besoin d'aucun secret applicatif par défaut. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Stockage des blobs **et** hôte Redis par défaut. Conservez true sauf si un `redis_host` externe est fourni. |
| `nfs_mount_path` | `/root/.affine/storage` | Emplacement où AFFiNE conserve les blobs téléversés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun. Le bucket GCS `storage` est toujours provisionné par `Affine_Common`.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | AFFiNE nécessite PostgreSQL — MySQL est rejeté au moment du plan. |
| `db_name` / `db_user` | `affine` / `affine` | Immuables après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` (`postgres:15-alpine`) + `affine-migrate` (image applicative construite). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60 s, 30 échecs | Fenêtre généreuse pour le premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 60 s | Le chemin racine renvoie 200 une fois prêt. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — la validation au moment du plan rejette `false`. Pub/sub Yjs + file de jobs. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP de l'hôte NFS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 22 — VPC Service Controls {#group-22--vpc-service-controls}

Toutes les entrées suivent le comportement standard d'App_CloudRun (`enable_vpc_sc`, `vpc_cidr_ranges`, `vpc_sc_dry_run`, `organization_id`, `enable_audit_logging`).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données (l'hôte est sensible). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket AFFiNE `storage`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `affine-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

Une validation croisée des variables s'exécute au moment du plan (`validation.tf`) : elle impose PostgreSQL, un Redis obligatoire avec un hôte résolvable, des nombres d'instances `min ≤ max`, et rejette un volume Cloud SQL avec `database_type = "NONE"` — les erreurs de configuration échouent rapidement au lieu de produire un déploiement défectueux.

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | AFFiNE nécessite PostgreSQL ; MySQL est rejeté au moment du plan. |
| `db_name` / `db_user` | à définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit tous les espaces de travail. |
| `enable_redis` | `true` | Critique | Obligatoire — la collaboration en temps réel et la file de jobs ont besoin de Redis ; `false` fait échouer le plan. |
| `redis_host` | `""` (NFS) ou explicite | Critique | Redis activé avec NFS désactivé et aucun hôte défini fait échouer la validation ; un hôte erroné casse la synchronisation des documents à l'exécution. |
| `enable_nfs` | `true` | Critique | Sans NFS, les blobs téléversés atterrissent sur un disque éphémère et disparaissent à chaque révision/redémarrage — et l'hôte Redis par défaut disparaît. |
| `container_port` | `3010` | Critique | Port natif d'AFFiNE ; une incohérence fait échouer toutes les sondes de santé. |
| `max_instance_count` | `1` | Critique | Plus d'une instance fragmente l'état de collaboration propre à chaque processus et les blobs du système de fichiers — divergence silencieuse des données. |
| `container_image_source` | `custom` | Élevé | L'image amont ne contient pas le point d'entrée qui assemble `DATABASE_URL` / `REDIS_SERVER_*` — le serveur ne peut pas atteindre sa base de données. |
| `enable_cloudsql_volume` | `false` | Élevé | Les deux-points du chemin du socket cassent l'analyseur d'URL d'AFFiNE (`invalid port`) ; conservez IP privée + `sslmode=require`. |
| `cpu_always_allocated` | `true` | Élevé | La limitation basée sur les requêtes prive de CPU la synchronisation Yjs par WebSocket entre les requêtes — l'édition en direct se bloque. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle jusqu'à zéro interrompt les sessions de collaboration actives et ajoute des délais de démarrage à froid. |
| `memory_limit` | `4Gi` (≥ `2Gi`) | Élevé | OOM de Node.js pendant la synchronisation des documents ou la migration en dessous de 2Gi. |
| `environment_variables` `PORT` | ne jamais définir | Élevé | `PORT` est réservé par Cloud Run ; le définir fait échouer chaque création de Job avec une erreur HTTP 400. |
| `application_version` | `stable` (tag épinglé) | Moyen | Des tags inexistants (p. ex. `latest` littéral) font échouer le build de l'image ; le module fait correspondre `latest` → `stable`. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2. |
| `AFFINE_SERVER_EXTERNAL_URL` | URL du service / domaine personnalisé | Moyen | Un hôte erroné casse les liens d'invitation et les URL de partage. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à AFFiNE, partagée avec la variante GKE, est décrite dans **[Affine_Common](Affine_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AFFiNE sur Cloud Run](../labs/Affine_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [AFFiNE sur GKE Autopilot](Affine_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [AFFiNE Common — Configuration applicative partagée](Affine_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Penpot sur Google Cloud Run](Penpot_CloudRun.md) et [Excalidraw sur Google Cloud Run](Excalidraw_CloudRun.md) dans la solution **Design & Visual Collaboration**.
