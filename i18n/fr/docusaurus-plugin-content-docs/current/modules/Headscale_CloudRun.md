---
title: "Headscale sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Headscale sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Headscale_CloudRun.md @ 15fd4c7 sha256:11542d61b53d -->

# Headscale sur Google Cloud Run {#headscale-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_CloudRun.png" alt="Headscale sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Headscale est une implémentation open source et auto-hébergée du serveur de
coordination Tailscale — un plan de contrôle pour un VPN maillé WireGuard
privé, compatible avec les clients Tailscale officiels. Headscale n'est **pas**
une passerelle ou un relais VPN en soi : il authentifie les nœuds, distribue
la clé publique et l'allocation IP de chaque pair, et maintient la carte
réseau du maillage synchronisée. Le trafic chiffré réel entre les appareils
circule directement, de pair à pair, via WireGuard (ou via l'infrastructure
de relais DERP publique de Tailscale lorsqu'une connexion directe n'est pas
possible) — il ne passe jamais par Headscale. Ce module déploie Headscale
sur **Cloud Run v2** sur la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Headscale et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Headscale s'exécute comme un binaire Go unique sur Cloud Run v2, construit à
partir d'une image amont personnalisée basée sur `ko`. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go, 1 vCPU / 1 GiB par défaut ; lié à une seule instance |
| Base de données | SQLite embarqué | Pas d'instance Cloud SQL — `database_type = "NONE"` |
| Persistance | Cloud Filestore (NFS) | Le fichier SQLite et les clés WireGuard/Noise se trouvent à `/var/lib/headscale`, sur le partage NFS par défaut |
| Secrets | Secret Manager | Aucun — Headscale n'a pas de secrets au niveau de l'application dans ce module |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; doit rester publique pour que les clients Tailscale réels puissent s'enregistrer |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge.** Il n'y a pas
  d'instance Cloud SQL externe ; tout l'état (registre des nœuds, clés de
  pré-authentification, clé privée du protocole Noise) réside dans un seul
  fichier SQLite sous `/var/lib/headscale`.
- **`max_instance_count` est codé en dur à `1` en aval, pas seulement par
  défaut.** `Headscale_Common` définit `config.max_instance_count = 1` comme une valeur littérale —
  la variable `max_instance_count` du module d'application n'est jamais réellement lue.
  Headscale n'a pas de support actif-actif, et deux rédacteurs sur le même
  fichier SQLite le corrompraient.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`).
  Contrairement aux applications avec une base de données ou un index de
  recherche à réchauffer, le fichier SQLite et la clé WireGuard de Headscale
  rendent les démarrages à froid rapides.
- **Le stockage est sur NFS, et WAL est désactivé.** Cloud Run n'a pas de
  périphérique de bloc, et GCS Fuse ne peut pas héberger SQLite (pas de
  verrouillage POSIX ou de mémoire partagée), donc `/var/lib/headscale` est le chemin de
  montage NFS (`enable_nfs = true` par défaut) et le bucket GCS Fuse n'y est monté
  que si NFS est désactivé. NFS fournit le verrouillage POSIX mais pas le
  mappage de mémoire partagée dont WAL a besoin, donc cette variante exécute
  SQLite avec `write_ahead_log` désactivé. Voir [Pièges](#7-pitfalls--gotchas)
  ci-dessous.
- **L'ingress public est requis pour que les clients Tailscale puissent
  s'enregistrer.** `ingress_settings = "all"` est la valeur par défaut afin que les
  appareils partout sur Internet puissent atteindre le serveur de
  coordination et s'enregistrer. L'activation d'IAP bloquerait entièrement
  l'enregistrement des clients — la CLI `tailscale` ne peut pas présenter une
  identité Google.
- **MagicDNS est désactivé par défaut.** Il nécessite que `dns.base_domain` soit
  défini et réellement différent du domaine de `server_url` — une contrainte
  qu'une seule valeur par défaut ne peut pas satisfaire de manière fiable par
  déploiement.
- **Pas de job d'initialisation par défaut.** Contrairement aux applications
  soutenues par une base de données externe, le fichier SQLite de Headscale
  est créé automatiquement au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#6-outputs)
du déploiement.

### A. Cloud Run — le service Headscale {#a-cloud-run--the-headscale-service}

Headscale s'exécute comme un service Cloud Run v2 unique. Parce que `max_instance_count`
est codé en dur à `1`, il n'y a pas d'autoscaling horizontal à observer
— seulement la mise à l'échelle à zéro et les démarrages à froid.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Le volume de stockage SQLite {#b-the-sqlite-storage-volume}

`/var/lib/headscale` contient `db.sqlite`, `noise_private.key` et la clé WireGuard
héritée. Par défaut, c'est le chemin de montage NFS. Un bucket GCS `storage`
dédié est également provisionné ; il est monté à `/var/lib/headscale` via GCS Fuse
uniquement lorsque `enable_nfs = false` — évitez cela, car une base de données SQLite
écrite via GCS Fuse est corrompue alors que `/health` passe toujours.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les mécanismes de montage GCS Fuse
et les options CMEK.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, permettant un accès
public — requis pour que les clients Tailscale réels sur des appareils/réseaux
arbitraires puissent atteindre le serveur de coordination et s'enregistrer. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging. Au démarrage, une
instance saine enregistre la génération de la clé privée, "database opened
successfully" (base de données ouverte avec succès) et "listening and serving
HTTP" (écoute et service HTTP). Les métriques Cloud Run sont envoyées à Cloud
Monitoring, avec des tests de disponibilité et des politiques d'alerte
facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Headscale {#3-headscale-application-behaviour}

- **SQLite s'initialise automatiquement au démarrage.** Il n'y a pas de job
  de configuration de base de données séparé — au premier démarrage, Headscale
  crée `db.sqlite` sous `/var/lib/headscale` et applique
  automatiquement ses propres migrations de schéma internes.
- **Génération automatique de la clé privée.** Au premier démarrage, Headscale
  génère sa clé privée de protocole Noise à `noise_private.key` (le chemin configuré
  via `noise.private_key_path` dans la configuration intégrée) si elle n'existe pas déjà.
  La perte de cette clé (ou du volume de stockage) force chaque nœud client
  précédemment enregistré à se réenregistrer.
- **Point de terminaison de santé.** `/health` est un point de terminaison
  réel et non authentifié — confirmé en direct renvoyant HTTP 200 avec
  "listening and serving HTTP" dans les journaux de l'application. Les sondes
  de démarrage et de vivacité le ciblent par défaut.
- **La configuration de première exécution est une étape manuelle
  post-déploiement.** Headscale n'est pas livré avec un flux d'inscription
  basé sur le web. La création du premier "utilisateur" (espace de noms) et
  l'émission d'une clé de pré-authentification pour l'enregistrement des
  nœuds clients se font via la CLI `headscale`, exécutée sur le même binaire
  `/ko-app/headscale` que le service utilise. Sur Cloud Run, la manière pratique
  d'exécuter ces commandes ponctuelles est une exécution de job Cloud Run
  contre l'image déployée :
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
  Voir le [lab pratique](../labs/Headscale_CloudRun.md) pour la procédure
  complète et concrète — les mécanismes exacts de job/exécution dépendent de
  la façon dont la plateforme nomme ses ressources d'exécution ponctuelles.
- **Connexion d'un client Tailscale réel.** Une fois qu'une clé de
  pré-authentification existe :
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
  L'appareil apparaît alors comme un nœud dans le registre de Headscale.
- **Inspection des nœuds enregistrés :**
  ```bash
  # Run against the deployed binary the same way as user/key creation above:
  # headscale nodes list
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Headscale sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `headscale` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout en la build amont épinglée `HEADSCALE_VERSION=0.26.1` — un ARG de build Dockerfile, pas un passe-partout de version générique. |
| `server_url` | `""` | URL publique du plan de contrôle, intégrée à l'enregistrement de chaque client. Par défaut, l'URL Cloud Run déterministe de ce service lorsqu'elle est laissée vide. La modifier ultérieurement nécessite de réenregistrer chaque nœud. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner l'infrastructure uniquement. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources par instance. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; les démarrages à froid sont rapides (pas de DB/index à réchauffer). |
| `max_instance_count` | `1` | **Codé en dur à `1` en aval quelle que soit cette valeur** — voir [Pièges](#7-pitfalls--gotchas). |
| `container_port` | `8080` | Port d'écoute natif de Headscale. |
| `execution_environment` | `gen2` | Requis pour les montages de stockage NFS (et GCS Fuse). |
| `enable_cloudsql_volume` | `false` | Non applicable — pas de Cloud SQL. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis pour que les clients Tailscale réels sur des réseaux arbitraires puissent atteindre et s'enregistrer. |
| `enable_iap` | `false` | **Ne jamais activer pour une utilisation normale** — IAP nécessite une identité Google, que la CLI `tailscale` ne peut pas présenter, bloquant tout enregistrement de client. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `storage` supportant `/var/lib/headscale`. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires. Le bucket `storage` est ajouté automatiquement uniquement lorsque `enable_nfs = false`. |
| `enable_redis` | `true` (déclaré) | Non référencé — `false` codé en dur dans `main.tf` ; Headscale n'a pas besoin de Redis. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Headscale_Common` — Headscale est entièrement basé sur SQLite, il n'y a pas d'instance Cloud SQL. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Pas de job par défaut — SQLite s'initialise au premier démarrage. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai 15s, seuil 10 | Point de terminaison Headscale réel, non authentifié. |
| `liveness_probe` | HTTP `/health`, délai 30s, seuil 3 | Même point de terminaison. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/health`. |

---

## 5. Référence d'exploration des services GCP {#5-gcp-service-exploration-reference}

Voir le §2 ci-dessus — Cloud Run, Cloud Storage, réseau et journalisation/surveillance
sont l'ensemble complet des services que ce module touche directement (au-delà de
l'infrastructure partagée VPC/IAM/Artifact Registry commune à chaque déploiement
`App_CloudRun`).

---

## 6. Sorties {#6-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `api_url` | URL `run.app` par défaut du service — c'est ce que `server_url` prédit et ce contre quoi les clients s'enregistrent. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URLs de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage` supportant `/var/lib/headscale`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 7. Pièges et astuces {#7-pitfalls--gotchas}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs et les combinaisons au moment du plan. Voir
> [App_CloudRun](App_CloudRun.md) pour le comportement général de validation.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `enable_nfs` | `true` (par défaut) | **Critique** | Désactiver NFS déplace `/var/lib/headscale` sur GCS Fuse, qui ne peut pas héberger SQLite : la base de données est corrompue à l'arrivée alors que `/health` passe toujours. Pour un périphérique de bloc et le mode WAL, utilisez [Headscale_GKE](Headscale_GKE.md) avec `stateful_pvc_enabled = true` (sa valeur par défaut). |
| `max_instance_count` | Laisser à `1` (c'est codé en dur de toute façon) | Élevé | La variable est déclarée mais n'est jamais réellement lue par `Headscale_Common` — `config.max_instance_count` est un littéral `1`. Le définir plus haut donne une fausse impression que la mise à l'échelle horizontale est disponible ; ce n'est pas le cas, et cela corromprait le fichier SQLite si c'était le cas. |
| `server_url` | Définir une fois, avant d'enregistrer les clients | Critique | Intégré à l'enregistrement de chaque client. Le modifier après l'enregistrement des clients nécessite de réenregistrer chaque nœud avec la nouvelle URL. |
| `ingress_settings` | `all` | Critique | Définir `internal` rend le serveur de coordination inaccessible aux clients Tailscale réels sur l'Internet public — tout l'intérêt du déploiement est perdu. |
| `enable_iap` | `false` | Critique | IAP nécessite une identité Google pour chaque requête. La CLI `tailscale` ne peut pas en présenter une, donc l'activation d'IAP bloque tout enregistrement de client et tout trafic de synchronisation de maillage. |
| Perte du volume/bucket de stockage | Ne jamais supprimer manuellement le bucket `storage` tant que des nœuds sont enregistrés | Critique | La clé privée du protocole Noise et l'ensemble du registre des nœuds y résident. Le perdre force chaque client à se réenregistrer à partir de zéro. |
| MagicDNS (`dns.magic_dns`) | Laisser `false` à moins que vous ne définissiez également un véritable `dns.base_domain` | Moyen | L'activation de MagicDNS sans un `base_domain` valide et distinct du domaine de `server_url` produit une résolution DNS cassée pour les clients ; le module le désactive par conception. |
| Hypothèse d'image `-debug` | Ne pas supposer qu'un shell est disponible | Faible (au moment de la build) | Le tag `-debug` inclut busybox mais n'a pas de `/bin/sh` sur `PATH` — un changement naïf de Dockerfile utilisant les étapes de shell `#!/bin/sh` ou `RUN` contre cette base échouera. Déjà géré correctement dans le Dockerfile/point d'entrée livré ; pertinent si vous le forkez. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Headscale partagée avec la variante GKE est décrite
dans **[Headscale_Common](Headscale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Headscale sur Cloud Run](../labs/Headscale_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Headscale sur GKE Autopilot](Headscale_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Headscale Common — Configuration d'application partagée](Headscale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md), [Vaultwarden sur Google Cloud Run](Vaultwarden_CloudRun.md) dans la solution **Communications d'équipe sécurisées**.
