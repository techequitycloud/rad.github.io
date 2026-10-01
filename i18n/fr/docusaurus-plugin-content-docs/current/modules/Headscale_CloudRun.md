---
title: "Headscale sur Google Cloud Run"
description: "Référence de configuration pour déployer Headscale sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Headscale_CloudRun.md @ 3055034 sha256:09580f246888 -->

# Headscale sur Google Cloud Run {#headscale-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_CloudRun.png" alt="Headscale sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Headscale est une implémentation open source et auto-hébergée du serveur de
coordination Tailscale — un plan de contrôle pour un VPN maillé privé WireGuard,
compatible avec les clients Tailscale officiels. Headscale n'est **pas** lui-même
une passerelle ni un relais VPN : il authentifie les nœuds, distribue la clé
publique et l'adresse IP attribuée de chaque pair, et maintient à jour la carte
réseau du maillage. Le trafic chiffré proprement dit entre les appareils circule
directement, de pair à pair, via WireGuard (ou via l'infrastructure publique de
relais DERP de Tailscale lorsqu'une connexion directe est impossible) — il ne
transite jamais par Headscale. Ce module déploie Headscale sur **Cloud Run v2**
au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Headscale et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Headscale s'exécute comme un unique binaire Go sur Cloud Run v2, construit à partir
d'une image amont personnalisée basée sur `ko`. Le déploiement assemble un ensemble
ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 1 GiB par défaut ; épinglé de manière stricte à une seule instance |
| Base de données | SQLite intégré | Aucune instance Cloud SQL — `database_type = "NONE"` |
| Persistance | Cloud Storage (GCS Fuse) | Le fichier SQLite, les fichiers annexes du WAL et les clés WireGuard/Noise résident sous `/var/lib/headscale` |
| Secrets | Secret Manager | Aucun — Headscale n'a pas de secret applicatif dans ce module |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; doit rester publique pour que de vrais clients Tailscale puissent s'enregistrer |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge.** Il n'existe aucune
  instance Cloud SQL externe ; tout l'état (registre des nœuds, clés de
  pré-authentification, clé privée du protocole Noise) réside dans un unique
  fichier SQLite sous `/var/lib/headscale`.
- **`max_instance_count` est codé en dur à `1` en aval, et non simplement défini
  par défaut.** `Headscale_Common` fixe `config.max_instance_count = 1` comme valeur
  littérale — la variable `max_instance_count` de l'Application Module n'est en
  réalité jamais lue. Headscale ne prend pas en charge le mode actif-actif, et deux
  écrivains sur le même fichier SQLite le corrompraient.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`).
  Contrairement aux applications dotées d'une base de données ou d'un index de
  recherche à préchauffer, le fichier SQLite et la clé WireGuard de Headscale
  rendent les démarrages à froid rapides.
- **Le stockage repose sur GCS Fuse sur Cloud Run — un compromis réel et
  documenté.** Le mode WAL de SQLite exige un véritable verrouillage de fichiers
  POSIX, que gcsfuse ne fournit pas de manière fiable. C'est acceptable uniquement
  parce que des écrivains concurrents sont structurellement impossibles
  (`max_instance_count` épinglé à 1). Consultez les
  [pièges](#7-pitfalls--gotchas) ci-dessous.
- **Une entrée publique est nécessaire pour que les clients Tailscale
  s'enregistrent.** `ingress_settings = "all"` est la valeur par défaut afin que
  des appareils situés n'importe où sur internet puissent joindre le serveur de
  coordination. Activer IAP bloquerait entièrement l'enregistrement des clients —
  la CLI `tailscale` ne peut pas présenter d'identité Google.
- **MagicDNS est désactivé par défaut.** Il exige que `dns.base_domain` soit
  défini et réellement différent du domaine de `server_url` — une contrainte
  qu'une seule valeur par défaut intégrée ne peut pas satisfaire de manière fiable
  pour chaque déploiement.
- **Aucun job d'initialisation par défaut.** Contrairement aux applications
  reposant sur une base de données externe, le fichier SQLite de Headscale est
  créé automatiquement au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [sorties](#6-outputs) du
déploiement.

### A. Cloud Run — le service Headscale {#a-cloud-run--the-headscale-service}

Headscale s'exécute comme un unique service Cloud Run v2. Comme
`max_instance_count` est codé en dur à `1`, il n'y a aucune mise à l'échelle
horizontale automatique à observer — uniquement la mise à zéro et les démarrages
à froid.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume de stockage SQLite {#b-cloud-storage--the-sqlite-storage-volume}

Un bucket GCS `storage` dédié est provisionné automatiquement et monté sur
`/var/lib/headscale` via GCS Fuse. Il contient `db.sqlite` (+ les fichiers annexes
`-wal`/`-shm` en mode WAL), `noise_private.key` et l'ancienne clé WireGuard.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les mécanismes de montage GCS Fuse
et les options CMEK.

### C. Réseau et entrée {#c-networking--ingress}

Le service est joignable par défaut à son URL `run.app`, avec un accès public —
nécessaire pour que de vrais clients Tailscale, sur des appareils et des réseaux
quelconques, puissent joindre le serveur de coordination et s'enregistrer. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging. Au démarrage, une
instance saine journalise la génération de la clé privée, « database opened
successfully » et « listening and serving HTTP ». Les métriques Cloud Run sont
envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Headscale {#3-headscale-application-behaviour}

- **SQLite s'initialise automatiquement au démarrage.** Il n'existe pas de tâche
  distincte de configuration de la base de données — au premier démarrage,
  Headscale crée `db.sqlite` sous `/var/lib/headscale` et applique
  automatiquement ses propres migrations de schéma internes.
- **Génération automatique de la clé privée.** Au premier démarrage, Headscale
  génère sa clé privée du protocole Noise dans `noise_private.key` (le chemin
  configuré via `noise.private_key_path` dans la configuration intégrée) si elle
  n'existe pas déjà. La perte de cette clé (ou du volume de stockage) oblige chaque
  nœud client déjà enregistré à se réenregistrer.
- **Endpoint de santé.** `/health` est un véritable endpoint non authentifié —
  confirmé en conditions réelles, renvoyant HTTP 200 en même temps que
  « listening and serving HTTP » dans les journaux de l'application. Les sondes de
  démarrage et de vivacité le ciblent toutes deux par défaut.
- **La configuration initiale est une étape manuelle, après le déploiement.**
  Headscale n'est livré avec aucun parcours d'inscription web. La création du
  premier « user » (espace de noms) et l'émission d'une clé de
  pré-authentification pour enregistrer les nœuds clients se font toutes deux via
  la CLI `headscale`, exécutée sur le même binaire `/ko-app/headscale` que celui
  qu'utilise le service. Sur Cloud Run, le moyen pratique d'exécuter ces commandes
  ponctuelles est une exécution de Cloud Run Job sur l'image déployée :
  ```bash
  # Create the first user/namespace:
  gcloud run jobs execute <job-name> --project "$PROJECT" --region "$REGION" \
    --container <service-name> --command="/ko-app/headscale" \
    --args="users,create,myuser" --wait

  # Issue a pre-auth key for that user (valid 1 hour, reusable):
  gcloud run jobs execute <job-name> --project "$PROJECT" --region "$REGION" \
    --container <service-name> --command="/ko-app/headscale" \
    --args="preauthkeys,create,--user,myuser,--reusable,--expiration,1h" --wait
  ```
  Consultez le [lab pratique](../labs/Headscale_CloudRun.md) pour la procédure
  complète et concrète — les mécanismes exacts de tâche/d'exécution dépendent de la
  manière dont la plateforme nomme ses ressources d'exécution ponctuelles.
- **Connecter un vrai client Tailscale.** Une fois qu'une clé de
  pré-authentification existe :
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
  L'appareil apparaît alors comme un nœud dans le registre de Headscale.
- **Inspecter les nœuds enregistrés :**
  ```bash
  # Run against the deployed binary the same way as user/key creation above:
  # headscale nodes list
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Headscale ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `headscale` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout vers le build amont épinglé `HEADSCALE_VERSION=0.26.1` — un ARG de build du Dockerfile, et non une transmission générique de version. |
| `server_url` | `""` | URL publique du plan de contrôle, intégrée à l'enregistrement de chaque client. Lorsqu'elle est laissée vide, elle prend par défaut l'URL Cloud Run déterministe de ce service. La modifier ultérieurement impose de réenregistrer chaque nœud. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources par instance. |
| `min_instance_count` | `0` | Mise à zéro ; les démarrages à froid sont rapides (aucune base ni aucun index à préchauffer). |
| `max_instance_count` | `1` | **Codé en dur à `1` en aval, quelle que soit cette valeur** — consultez les [pièges](#7-pitfalls--gotchas). |
| `container_port` | `8080` | Port d'écoute natif de Headscale. |
| `execution_environment` | `gen2` | Requis pour le montage de stockage GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Sans objet — pas de Cloud SQL. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour que de vrais clients Tailscale, sur des réseaux quelconques, puissent joindre le service et s'enregistrer. |
| `enable_iap` | `false` | **Ne l'activez jamais en usage normal** — IAP exige une identité Google, que la CLI `tailscale` ne peut pas présenter, ce qui bloque tout enregistrement de client. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` qui sous-tend `/var/lib/headscale`. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le bucket `storage` est ajouté automatiquement. |
| `enable_redis` | `true` (déclarée) | Non référencée — codée en dur à `false` dans `main.tf` ; Headscale n'a aucun usage de Redis. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixée par `Headscale_Common` — Headscale repose entièrement sur SQLite, il n'y a pas d'instance Cloud SQL. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucune tâche par défaut — SQLite s'initialise lui-même au premier démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 15s, seuil de 10 | Véritable endpoint Headscale non authentifié. |
| `liveness_probe` | HTTP `/health`, délai de 30s, seuil de 3 | Même endpoint. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/health`. |

---

## 5. Référence d'exploration des services GCP {#5-gcp-service-exploration-reference}

Consultez le §2 ci-dessus — Cloud Run, Cloud Storage, le réseau et la
journalisation/supervision constituent l'ensemble complet des services que ce
module utilise directement (au-delà de l'infrastructure partagée
VPC/IAM/Artifact Registry commune à tout déploiement `App_CloudRun`).

---

## 6. Sorties {#6-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service — c'est ce que `server_url` prévoit et ce auprès de quoi les clients s'enregistrent. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage` qui sous-tend `/var/lib/headscale`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuelles tâches de configuration personnalisées (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 7. Pièges et points d'attention {#7-pitfalls--gotchas}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs et
> leurs combinaisons au moment du plan. Consultez
> [App_CloudRun](App_CloudRun.md) pour le comportement général de validation.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| SQLite sur GCS Fuse | Acceptez le compromis, ou utilisez `Headscale_GKE` en production | **Critique** | Les fichiers WAL/journal de SQLite exigent un véritable verrouillage de fichiers POSIX, que gcsfuse ne fournit pas de manière fiable — confirmé en conditions réelles par des entrées de journal `BufferedWriteHandler.OutOfOrderError` répétées pour `db.sqlite`/`db.sqlite-wal`/`db.sqlite-shm`. gcsfuse se rabat sur un chemin d'écriture hérité plus lent ; l'application a continué de fonctionner lors des tests observés, mais il s'agit d'une catégorie connue de risque de corruption SQLite, documentée ailleurs dans ce catalogue. **Aucune correction n'est possible sur Cloud Run** — il n'existe pas d'alternative de volume en mode bloc, seulement gcsfuse ou un stockage éphémère. Pour un déploiement de production, utilisez plutôt [Headscale_GKE](Headscale_GKE.md) avec `stateful_pvc_enabled = true` (sa valeur par défaut). |
| `max_instance_count` | Laissez `1` (elle est de toute façon codée en dur) | Élevé | La variable est déclarée mais jamais réellement lue par `Headscale_Common` — `config.max_instance_count` est un `1` littéral. La définir plus haut donne la fausse impression qu'une mise à l'échelle horizontale est possible ; elle ne l'est pas, et corromprait le fichier SQLite si elle l'était. |
| `server_url` | Définissez-la une fois, avant d'enregistrer des clients | Critique | Intégrée à l'enregistrement de chaque client. La modifier après l'enregistrement des clients impose de réenregistrer chaque nœud auprès de la nouvelle URL. |
| `ingress_settings` | `all` | Critique | Définir `internal` rend le serveur de coordination injoignable pour de vrais clients Tailscale sur internet — la raison d'être même du déploiement est alors compromise. |
| `enable_iap` | `false` | Critique | IAP exige une identité Google pour chaque requête. La CLI `tailscale` ne peut pas en présenter, si bien qu'activer IAP bloque tout enregistrement de client et tout le trafic de synchronisation du maillage. |
| Perte du volume/bucket de stockage | Ne supprimez jamais manuellement le bucket `storage` tant que des nœuds sont enregistrés | Critique | La clé privée du protocole Noise et l'intégralité du registre des nœuds s'y trouvent. Sa perte oblige chaque client à se réenregistrer de zéro. |
| MagicDNS (`dns.magic_dns`) | Laissez `false` à moins de définir aussi un véritable `dns.base_domain` | Moyen | Activer MagicDNS sans `base_domain` valide et distinct du domaine de `server_url` entraîne une résolution DNS défaillante pour les clients ; le module le livre désactivé à dessein. |
| Hypothèse sur l'image `-debug` | Ne supposez pas qu'un shell est disponible | Faible (au build) | Le tag `-debug` embarque busybox mais n'a pas de `/bin/sh` dans le `PATH` — une modification naïve du Dockerfile utilisant `#!/bin/sh` ou des étapes shell `RUN` sur cette base échouera. Déjà correctement géré dans le Dockerfile/point d'entrée livré ; à prendre en compte si vous en faites un fork. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Headscale, partagée avec la variante GKE, est décrite dans
**[Headscale_Common](Headscale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Headscale sur Cloud Run](../labs/Headscale_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Headscale sur GKE Autopilot](Headscale_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Headscale Common — Configuration applicative partagée](Headscale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Secure Team Communications**.
