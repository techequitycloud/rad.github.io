---
title: "PocketBase sur Google Cloud Run"
description: "Référence de configuration pour déployer PocketBase sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PocketBase_CloudRun.md @ 3055034 sha256:92edc643eda0 -->

# PocketBase sur Google Cloud Run {#pocketbase-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PocketBase_CloudRun.png" alt="PocketBase sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PocketBase est un backend open source tenant en un seul fichier — une base de
données SQLite embarquée dotée d'une API REST en temps réel, d'une
authentification intégrée, d'un stockage de fichiers et d'un tableau de bord
d'administration. Ce module déploie PocketBase sur **Cloud Run v2** en s'appuyant
sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par PocketBase et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

PocketBase s'exécute sous forme d'un unique binaire Go autonome sur Cloud Run v2.
Le déploiement assemble un ensemble volontairement minimal de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 1 vCPU / 1 GiB par défaut, écoute sur le port **8090** |
| Base de données | **SQLite embarquée** | Pas de Cloud SQL — la base de données réside dans `/pb_data`, persistée dans Cloud Storage |
| Stockage persistant | Cloud Storage (GCS FUSE) | Un bucket de données dédié monté sur `/pb_data` (gen2 requis) |
| Cache et file d'attente | **Aucun** | PocketBase n'utilise pas Redis ; `enable_redis = false` |
| Secrets | Secret Manager | Aucun généré automatiquement — l'authentification réside dans SQLite ; secrets facultatifs pour votre propre usage |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (`ingress = all`) ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **La base de données est une SQLite embarquée — il n'y a pas de Cloud SQL.**
  PocketBase stocke chaque enregistrement, jeton d'authentification et fichier
  téléversé sous `/pb_data`, monté depuis un bucket Cloud Storage via GCS FUSE.
  Perdre ou vider ce bucket fait perdre toutes les données.
- **`max_instance_count` doit rester à `1`.** SQLite est une base de données à
  écrivain unique et le montage FUSE `/pb_data` n'est pas sûr pour des écrivains
  concurrents. Exécuter plus d'une instance corrompt la base de données. C'est
  pourquoi le minimum et le maximum valent tous deux `1` par défaut.
- **`min_instance_count = 1` par défaut** (pas de mise à l'échelle à zéro).
  Garder une instance active évite la latence des démarrages à froid et
  maintient en vie l'écrivain SQLite unique. Sinon, les démarrages à froid de
  Cloud Run ajouteraient de la latence à la première requête après une période
  d'inactivité.
- **Le compte administrateur est créé de manière interactive au premier
  lancement sur `/_/`.** Aucun mot de passe administrateur n'est injecté. La
  première personne qui atteint `/_/` crée le superutilisateur — ouvrez l'URL
  d'administration et créez-le **immédiatement** après le déploiement.
- **Aucun secret n'est généré automatiquement.** PocketBase émet et stocke
  lui-même toute l'authentification ; Secret Manager n'est utilisé que si vous
  ajoutez vos propres secrets (SMTP, clés de sauvegarde externes, etc.).
- **Entrée publique par défaut.** `ingress_settings = "all"` — PocketBase est
  une application web destinée aux utilisateurs (interface d'administration sur
  `/_/` plus une API REST publique). Activer IAP bloquera le trafic public de
  l'API et de l'application.
- **NFS et Redis sont désactivés.** PocketBase n'a besoin ni de l'un ni de
  l'autre ; tout l'état réside dans le volume unique `/pb_data`.
- **L'environnement d'exécution gen2** est requis pour le montage GCS FUSE
  `/pb_data`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service PocketBase {#a-cloud-run--the-pocketbase-service}

PocketBase s'exécute sous forme d'un service Cloud Run v2 qui écoute sur le port
**8090**. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs. Conservez-le
sur une instance unique (voir le §3).

- **Console :** Cloud Run → sélectionnez le service pour consulter les
  révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Base de données — SQLite embarquée (sans Cloud SQL) {#b-database--embedded-sqlite-no-cloud-sql}

Il n'y a **aucune instance Cloud SQL**. La base de données de PocketBase est un
ensemble de fichiers SQLite situés dans `/pb_data`, monté depuis le bucket de
données Cloud Storage. Pour inspecter ou sauvegarder la base de données, vous
travaillez sur le contenu du bucket, et non sur un point de terminaison SQL.

- **Console :** Cloud Storage → Buckets → le bucket de données PocketBase →
  `pb_data/`.
- **CLI :**
  ```bash
  # Confirm the service reports NO Cloud SQL attachment:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'
  # Copy the SQLite database out of the bucket for an offline backup / inspection:
  gcloud storage cp gs://<data-bucket>/data.db ./pb_data-backup.db
  ```

### C. Cloud Storage — le volume `/pb_data` {#c-cloud-storage--the-pb_data-volume}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné
automatiquement et monté sur `/pb_data` via GCS FUSE. Il contient la base de
données SQLite, les fichiers téléversés et les paramètres — tout ce que
PocketBase persiste.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  gcloud storage du -s gs://<data-bucket>/        # total data size
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK. Le
bucket applique la prévention de l'accès public.

### D. Secret Manager {#d-secret-manager}

**Aucun secret n'est généré automatiquement** pour PocketBase — son
authentification est stockée dans SQLite. Secret Manager n'est utilisé que si
vous injectez vos propres secrets (par exemple des identifiants SMTP ou des clés
de sauvegarde externes) via `secret_environment_variables`.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~pocketbase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress = all`), ce qui
autorise l'accès public dont l'application et l'API de PocketBase ont besoin. Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud
Run vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PocketBase {#3-pocketbase-application-behaviour}

- **Aucun job de base de données au premier déploiement.** PocketBase crée
  lui-même sa base de données SQLite, ses collections système et son schéma au
  premier démarrage sous `/pb_data`. Il n'y a aucun job `db-init` à exécuter ni à
  surveiller.
- **Les migrations s'appliquent automatiquement au démarrage.** PocketBase
  exécute lui-même les migrations de schéma en attente à chaque démarrage ; la
  mise à niveau de `application_version` applique donc les changements de schéma
  sans étape de migration distincte. Sauvegardez toujours `/pb_data` avant un
  changement de version.
- **Le superutilisateur administrateur est créé au premier lancement.** Ouvrez
  `https://<service-url>/_/` juste après le déploiement et créez le compte
  administrateur. Tant qu'il n'existe pas, quiconque atteint `/_/` peut se
  l'approprier — considérez cette étape de premier lancement comme urgente.
- **Le volume `/pb_data` constitue le seul état durable.** La base de données
  SQLite, les fichiers téléversés et les paramètres y résident tous. Protégez le
  bucket de données en conséquence ; sauvegardez-le de manière planifiée.
- **Instance unique par conception.** SQLite sérialise les écritures dans un
  seul fichier de base de données et le montage GCS FUSE est à écrivain unique.
  `min_instance_count` et `max_instance_count` valent tous deux `1` par défaut ;
  n'augmentez pas `max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/health`, le point de terminaison public et non authentifié de PocketBase
  (renvoie HTTP `200` / `{"code":200,"message":"API is healthy."}`). Le premier
  démarrage est rapide, car il n'y a aucune base de données externe à attendre.
- **Vérifier l'état à l'exécution :**
  ```bash
  curl -s "$(gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)')/api/health"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à PocketBase ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `pocketbase` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image ; `latest` correspond à l'ARG de build épinglé `0.22.21`. Épinglez une version explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU suffit largement pour le binaire Go unique. |
| `memory_limit` | `1Gi` | Mémoire par instance ; PocketBase est léger (512Mi suffisent souvent). |
| `min_instance_count` | `1` | Conservez 1 — évite les démarrages à froid et maintient en vie l'écrivain SQLite unique. |
| `max_instance_count` | `1` | **Ne pas augmenter.** SQLite + GCS FUSE sont à écrivain unique ; >1 corrompt les données. |
| `container_port` | `8090` | PocketBase écoute sur 8090 (API HTTP + interface d'administration). |
| `execution_environment` | `gen2` | Requis pour le montage GCS FUSE `/pb_data`. |
| `enable_cloudsql_volume` | `false` | Désactivé d'office — PocketBase n'utilise pas Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir/construit l'image PocketBase dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface de l'application et à l'API REST. `internal` restreint l'accès au VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque l'API publique et l'interface d'administration.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires pour le conteneur (PocketBase n'en a besoin d'aucun pour le premier démarrage). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (uniquement pour vos propres secrets). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket de données `/pb_data` et tout `storage_buckets` supplémentaire. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de données provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé — PocketBase persiste tout dans le bucket `/pb_data`. |
| `gcs_volumes` | `[]` | Volumes GCS FUSE supplémentaires (le volume `/pb_data` est ajouté automatiquement). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — PocketBase utilise une base de données SQLite embarquée ; aucun Cloud SQL n'est créé. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health`, délai de 15s | Sonde de démarrage ; rapide, car il n'y a aucune base de données externe à attendre. |
| `liveness_probe` | HTTP `/api/health`, délai de 30s | Sonde de vivacité sur le point de terminaison de santé public. |
| `uptime_check_config` | désactivé, chemin `/api/health` | Test de disponibilité Cloud Monitoring. |

Toutes les autres entrées suivent le comportement standard
d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `pocketbase_url` | URL du service pour l'API HTTP + l'interface d'administration de PocketBase (port 8090). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/pb_data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan — un `container_port` invalide, un environnement
> d'exécution `gen1` avec des montages GCS FUSE, IAP sans identités autorisées, des
> valeurs de sonde ou de rétention hors plage. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de toute
> ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt
> qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` (ne jamais augmenter) | Critical | SQLite + GCS FUSE sont à écrivain unique ; plus d'une instance corrompt la base de données. |
| Le bucket de données `/pb_data` | Ne jamais le supprimer ; le sauvegarder | Critical | Le bucket **est** la base de données et le stockage de fichiers — le supprimer ou le vider détruit toutes les données. |
| `database_type` | `NONE` (fixe) | Critical | PocketBase n'a pas de base de données externe ; sélectionner un moteur provisionne un Cloud SQL inutilisé et ne change pas l'emplacement des données. |
| Compte administrateur sur `/_/` | À créer immédiatement après le déploiement | Critical | Tant que le superutilisateur n'existe pas, quiconque atteint `/_/` peut se l'approprier et prendre le contrôle de l'instance. |
| Changement de `application_version` | Sauvegardez d'abord `/pb_data` | High | PocketBase migre automatiquement le schéma au démarrage ; une mise à niveau interrompue peut laisser la base SQLite au milieu d'une migration. |
| `execution_environment` | `gen2` | High | gen1 ne peut pas monter le volume GCS FUSE `/pb_data` ; le service démarre sans données persistantes. |
| `ingress_settings` | `all` | High | `internal` bloque l'accès depuis Internet à l'interface publique de l'application et à l'API REST. |
| `enable_iap` | Uniquement pour les déploiements privés | High | IAP bloque toutes les requêtes non authentifiées, y compris les clients de l'API publique et l'interface d'administration. |
| `min_instance_count` | `1` | Medium | La mise à l'échelle à zéro (`0`) ajoute la latence des démarrages à froid et interrompt brièvement l'écrivain SQLite unique entre les requêtes. |
| `memory_limit` | `1Gi` (512Mi min) | Low | PocketBase est léger ; un surdimensionnement ne fait qu'augmenter le coût. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La
configuration applicative propre à PocketBase partagée avec la variante GKE est
décrite dans **[PocketBase_Common](PocketBase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PocketBase sur Cloud Run](../labs/PocketBase_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [PocketBase sur GKE Autopilot](PocketBase_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [PocketBase Common — Configuration applicative partagée](PocketBase_Common.md) — la configuration partagée par les deux cibles de déploiement.
