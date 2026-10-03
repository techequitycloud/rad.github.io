---
title: "Ntfy sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Ntfy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ntfy_CloudRun.md @ 15fd4c7 sha256:a504244f3e62 -->

# Ntfy sur Google Cloud Run {#ntfy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ntfy_CloudRun.png" alt="Ntfy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ntfy est un serveur de notifications push pub/sub open source, sous licence Apache
2.0, écrit en Go. Les applications publient des messages via une API REST/HTTP
simple et les clients les reçoivent instantanément via des flux WebSocket ou
Server-Sent-Events (SSE) — aucune base de données externe n'est requise. Ce
module déploie ntfy sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ntfy et sur la façon
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ntfy s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement
assemble un ensemble délibérément restreint de services Google Cloud — ntfy
n'a pas de dépendance propre à une base de données, un cache ou un stockage
d'objets :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go unique, 1 vCPU / 512 MiB par défaut ; CPU toujours alloué pour les flux de longue durée |
| Base de données | **Aucune** | `database_type = "NONE"` ; le cache de messages est un fichier SQLite local, aucune instance Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut) ou NFS (optionnel) | Cache SQLite à `/var/cache/ntfy/cache.db` ; activer NFS pour un historique de messages durable |
| Stockage d'objets | **Aucun** | ntfy ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; ntfy utilise un bus de messages in-process |
| Secrets | Secret Manager | Pas de secrets auto-générés ; seulement `secret_environment_variables` fournis par l'utilisateur |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — ntfy
  conserve son cache de messages dans un fichier SQLite local. Les variables
  liées à la base de données existent pour être complètes mais sont inertes à
  moins que vous n'optiez délibérément pour une base de données externe.
- **Le cache de messages est éphémère par défaut.** Il se trouve à
  `/var/cache/ntfy/cache.db`. Le système de fichiers racine de Cloud Run est en lecture
  seule, donc le point d'entrée revient à `/tmp/ntfy` lorsque le répertoire
  configuré n'est pas inscriptible. L'historique des messages est donc perdu à
  chaque redémarrage/redéploiement, à moins que vous n'activiez NFS
  (`enable_nfs = true`) et que vous ne pointiez le répertoire de cache vers le
  montage.
- **Le CPU est toujours alloué (`cpu_always_allocated = true`).** ntfy maintient des flux
  WebSocket/SSE de longue durée ouverts pour pousser les messages aux abonnés
  connectés en temps réel, de sorte que le CPU ne doit pas être limité entre
  les requêtes. Passer à `false` permet de réduire les coûts sur une
  instance à faible trafic, mais interrompt la livraison en temps réel pendant
  l'inactivité.
- **Instance unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Étant donné que le flux d'un abonné est ancré à l'instance qui le contient et
  qu'il n'y a pas de bus de messages partagé, la mise à l'échelle n'est pas la
  valeur par défaut. Gardez le maximum à 1, sauf si vous placez un cache/broker
  partagé derrière ntfy.
- **L'ingress public est la valeur par défaut** (`ingress_settings = "all"`) afin que les
  éditeurs et les abonnés puissent atteindre le service. L'activation de l'IAP
  nécessite une connexion Google et bloque les appels de publication/abonnement
  non authentifiés.
- **Le point de terminaison de santé est `/v1/health`**, qui renvoie
  `{"healthy":true}` avec HTTP 200 dès que le serveur se lie à son port.
- **Le contrôle d'accès est une étape post-déploiement.** ntfy est livré avec
  un accès ouvert ; configurez les utilisateurs et les ACL de sujets
  ultérieurement via son CLI ou les variables d'environnement `NTFY_AUTH_*`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les
noms de service et de ressource sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service ntfy {#a-cloud-run--the-ntfy-service}

ntfy s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs. Étant donné que le CPU est toujours alloué, une instance
active maintient ses flux d'abonnés actifs entre les requêtes.

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

### B. Persistance — le cache de messages SQLite {#b-persistence--the-sqlite-message-cache}

ntfy n'a **pas d'instance Cloud SQL**. Son cache de messages est un fichier
SQLite local à `NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), créé par le point
d'entrée au démarrage. Sur le système de fichiers racine en lecture seule de
Cloud Run, le point d'entrée revient à `/tmp/ntfy` lorsque ce chemin n'est
pas inscriptible — donc avec la configuration par défaut, le cache est
**éphémère** et l'historique des messages ne survit pas à un redémarrage.

Pour un historique durable, activez NFS et montez-le là où se trouve le cache :

- **Console :** Filestore → Instances (quand `enable_nfs = true`).
- **CLI :**
  ```bash
  # Confirm the cache path injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de montage NFS (Filestore).

### C. Secret Manager {#c-secret-manager}

ntfy ne génère **aucun** secret au moment du déploiement — il n'y a pas de mot
de passe de base de données ou de clé de chiffrement à gérer. Secret Manager
n'est utilisé que si vous fournissez le vôtre via `secret_environment_variables` (par exemple,
une valeur `NTFY_AUTH_*` ou une credential push en amont).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible à son URL `run.app` par défaut, ce qui permet
l'accès public dont ntfy a besoin pour le trafic de publication/abonnement. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle
d'egress VPC contrôlent la connectivité. Si les clients utilisent le streaming
HTTP/2, définissez `container_protocol = "h2c"`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte optionnelles. ntfy enregistre son adresse d'écoute
et le chemin de cache résolu au démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ntfy {#3-ntfy-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** ntfy n'a
  pas de base de données externe et pas d'étape de migration. Le point
  d'entrée prépare le répertoire du cache SQLite et exécute immédiatement
  `ntfy serve`. Il n'y a pas de job `db-init` par défaut.
- **Cache éphémère avec repli automatique.** Le point d'entrée crée le
  répertoire de `NTFY_CACHE_FILE` ; sur le rootfs en lecture seule de Cloud Run,
  il revient à `/tmp/ntfy` et enregistre un avertissement. Cela maintient un
  déploiement de base (sans NFS) sain. Activez NFS pour un historique de
  messages durable.
- **La livraison en temps réel nécessite un CPU alloué.** Les abonnés
  maintiennent des flux WebSocket/SSE ouverts ; `cpu_always_allocated = true` garantit que le
  bus de messages in-process continue de livrer entre les requêtes entrantes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/v1/health`, qui renvoie `{"healthy":true}` et HTTP 200 dès que le serveur
  se lie au port 80. Vérifiez :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s "$SERVICE_URL/v1/health"      # -> {"healthy":true}
  ```
- **Test de fumée de publication / abonnement.**
  ```bash
  curl -d "hello from ntfy" "$SERVICE_URL/mytopic"     # publish
  curl -s "$SERVICE_URL/mytopic/json"                   # subscribe (streaming JSON)
  ```
- **L'accès est ouvert jusqu'à ce que vous le verrouilliez.** Par défaut, tout
  client peut publier et s'abonner à n'importe quel sujet. Configurez les
  utilisateurs et les ACL par sujet après le déploiement via le CLI de ntfy
  (`ntfy user add`, `ntfy access`) ou les variables d'environnement
  `NTFY_AUTH_*`.
- **URL de base publique pour les pièces jointes / push web.** Si vous utilisez
  des pièces jointes ou le push web du navigateur, définissez `NTFY_BASE_URL`
  (via `environment_variables`) sur l'URL publique du service afin que les liens générés
  se résolvent correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
ntfy sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `application_name` | `ntfy` | Nom de base pour le service, le dépôt de registre et les secrets. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Ntfy` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version d'image ; `latest` correspond à une base `v2.11.0` épinglée. Épinglez un `v2.x.y` explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` déploie une image directement. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le minimum de la génération 2 est de 512 Mi). |
| `min_instance_count` | `1` | Instances minimales. |
| `max_instance_count` | `1` | **Gardez à 1** — les flux sont locaux à l'instance sans broker partagé. |
| `container_port` | `80` | ntfy écoute sur le port 80. |
| `container_protocol` | `http1` | Définissez `h2c` pour le streaming HTTP/2 de bout en bout. |
| `cpu_always_allocated` | `true` | Requis pour la livraison de flux en temps réel ; passez à `false` uniquement pour des économies de coûts en cas de faible trafic. |
| `enable_cloudsql_volume` | `false` | Désactivé — ntfy n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image ntfy dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour le trafic public de publication/abonnement. |
| `enable_iap` | `false` | Nécessite une connexion Google. **Bloque la publication/abonnement non authentifiée.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `NTFY_*` supplémentaires (par exemple `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Activez pour sauvegarder le cache SQLite avec NFS pour un **historique de messages durable**. |
| `nfs_mount_path` | `/var/cache/ntfy` | Chemin de montage NFS ; pointez `NTFY_CACHE_FILE` vers celui-ci pour la persistance. |
| `storage_buckets` | `[]` | Non requis — ntfy n'utilise pas de stockage d'objets. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inerte à moins qu'une base de données externe ne soit délibérément activée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | ntfy n'a pas besoin de job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/v1/health` 30s de délai | Sonde de démarrage. ntfy devient sain en quelques secondes. |
| `liveness_probe` | HTTP `/v1/health` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/v1/health" }` | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — ntfy n'a pas de dépendance Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS,
> une valeur `container_port`/`timeout_seconds` hors plage, une valeur de mémoire
> inférieure au minimum de la génération 2. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour un historique durable) | `true` lorsque l'historique est important | Élevé | Avec le cache éphémère par défaut, tout l'historique des messages est perdu à chaque redémarrage/redéploiement — acceptable pour un relais pur, surprenant si vous vous attendiez à une persistance. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 répartit les abonnés entre les instances sans bus partagé, de sorte qu'un message publié sur une instance n'est pas livré aux abonnés épinglés à une autre. |
| `cpu_always_allocated` | `true` | Élevé | Définir `false` permet à Cloud Run de limiter le CPU entre les requêtes, interrompant la livraison WebSocket/SSE en temps réel pendant que l'instance est inactive. |
| `ingress_settings` | `all` | Élevé | `internal` empêche les éditeurs et abonnés externes d'atteindre le service. |
| `enable_iap` | uniquement lorsque l'authentification est activée | Élevé | L'IAP nécessite une connexion Google pour chaque requête, bloquant la publication/abonnement non authentifiée — ce n'est généralement pas ce que souhaite un point de terminaison de notification. |
| `NTFY_BASE_URL` | URL de service réelle | Moyen | Non défini, les liens de pièces jointes et de push web se résolvent vers le mauvais hôte. |
| Contrôle d'accès ntfy | Configurer après le déploiement | Moyen | Par défaut, tout client peut publier et s'abonner à n'importe quel sujet sur une URL publique. |
| `container_protocol` | `http1` (ou `h2c`) | Moyen | Une incompatibilité avec les clients qui nécessitent le streaming HTTP/2 dégrade ou interrompt les flux de longue durée. |
| `memory_limit` | `512Mi` | Faible | L'environnement d'exécution de la génération 2 rejette les valeurs inférieures à 512 Mi au moment de l'application. |
| `application_version` | Épinglez `v2.x.y` en production | Faible | `latest` correspond à une base épinglée (`v2.11.0`) ; épinglez explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à ntfy partagée avec la variante GKE est décrite dans
**[Ntfy_Common](Ntfy_Common.md)**.

## Guides associés {#related-guides}

- [Labo pratique : Ntfy sur Cloud Run](../labs/Ntfy_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Ntfy sur GKE Autopilot](Ntfy_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ntfy Common — Configuration d'application partagée](Ntfy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [n8n sur Google Cloud Run](N8N_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Conversational Outreach**.
