---
title: "Gatus sur Google Cloud Run"
description: "Référence de configuration pour déployer Gatus sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gatus_CloudRun.md @ 3055034 sha256:030456713301 -->

# Gatus sur Google Cloud Run {#gatus-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gatus_CloudRun.png" alt="Gatus sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gatus est une page de statut et un moniteur de contrôles de santé open source, sous
licence Apache 2.0, orienté développeurs et écrit en Go. Il interroge des points de
terminaison HTTP, TCP, DNS, ICMP et autres, chacun selon sa propre planification,
évalue des conditions de résultat simples (code de statut, temps de réponse, contenu
du corps de la réponse, expiration du certificat TLS) et sert une page de statut
publique en direct ainsi que des alertes — sans base de données externe. Ce module
déploie Gatus sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Gatus et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle
de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gatus s'exécute comme un unique conteneur Go sur Cloud Run v2. Le déploiement
assemble un ensemble volontairement restreint de services Google Cloud — Gatus ne
dépend d'aucune base de données, d'aucun cache ni d'aucun stockage d'objets :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go unique, 1 vCPU / 512 MiB par défaut ; CPU toujours alloué afin que la boucle d'interrogation du watchdog ne soit jamais bridée |
| Base de données | **Aucune** | `database_type = "NONE"` ; le stockage d'historique facultatif est un fichier SQLite local, aucune instance Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut) ou NFS (facultatif, avec une réserve) | Historique SQLite dans `/data/data.db` ; lisez la réserve concernant le journal WAL ci-dessous avant d'activer NFS |
| Stockage d'objets | **Aucun** | Gatus ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; Gatus ne dépend d'aucun cache ni d'aucune file d'attente |
| Secrets | Secret Manager | Aucun secret généré automatiquement ; uniquement les `secret_environment_variables` fournies par l'utilisateur |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — le
  stockage d'historique facultatif de Gatus est un fichier SQLite local. Les
  variables liées à la base de données existent par souci d'exhaustivité, mais sont
  inertes sauf si vous choisissez délibérément une base de données externe.
- **La configuration repose entièrement sur un fichier.** Chaque point de
  terminaison surveillé, chaque intégration d'alerte et chaque paramètre de stockage
  se trouve dans un unique fichier YAML intégré à l'image au moment du build — il
  n'existe ni convention de variable d'environnement par paramètre, ni API de
  rechargement de la configuration à l'exécution. Modifiez les points de terminaison
  surveillés en éditant `modules/Gatus_Common/scripts/config.yaml` puis en
  redéployant.
- **Le stockage d'historique est éphémère par défaut, délibérément.** Gatus code en
  dur le mode de journalisation WAL de SQLite (confirmé en conditions réelles : aucune
  option de configuration ni aucun paramètre de chaîne de connexion ne le désactive),
  et la documentation de SQLite elle-même indique que WAL n'est pas pris en charge
  sur les systèmes de fichiers réseau. Cloud Run ne propose pour cela que le stockage
  éphémère ou NFS — aucun des deux n'est un emplacement véritablement sûr pour un
  fichier SQLite en mode WAL ; le module opte donc par défaut pour l'éphémère plutôt
  que de risquer une corruption silencieuse. Déployez `Gatus_GKE` avec
  `stateful_pvc_enabled = true` (un véritable périphérique bloc) si la persistance de
  l'historique compte pour vous.
- **Le CPU est toujours alloué (`cpu_always_allocated = true`).** La goroutine
  watchdog de Gatus interroge chaque point de terminaison configuré selon sa propre
  planification, indépendamment des requêtes HTTP entrantes. Une facturation basée
  sur les requêtes briderait le CPU entre les consultations de pages et
  bloquerait ou sauterait silencieusement les vérifications planifiées — la boucle
  de surveillance **est** le produit, selon la même logique que pour UptimeKuma.
- **Une seule instance par défaut** (`min_instance_count = 1`, `max_instance_count =
  1`). Plusieurs instances interrogeraient chacune
  indépendamment tous les points de terminaison et dupliqueraient les alertes —
  aucune coordination n'existe entre les instances Gatus.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin
  que la page de statut soit accessible publiquement. L'activation d'IAP exige une
  connexion Google et bloque la consultation non authentifiée.
- **Le point de terminaison de santé est `/health`**, qui renvoie HTTP 200 dès que
  le serveur se lie à son port.
- **Le contrôle d'accès, le cas échéant, se configure dans `config.yaml`.** Gatus
  est livré avec une page de statut ouverte par défaut ; une protection facultative
  par basic-auth ou OIDC se configure dans le bloc `security` de `config.yaml` et
  nécessite un nouveau build.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Gatus {#a-cloud-run--the-gatus-service}

Gatus s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs. Comme le CPU est toujours alloué, la boucle d'interrogation du
watchdog continue de s'exécuter entre les requêtes entrantes.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Persistance — le stockage d'historique SQLite {#b-persistence--the-sqlite-history-store}

Gatus ne possède **aucune instance Cloud SQL**. Son stockage d'historique facultatif
est un fichier SQLite local situé dans `/data/data.db`, dont l'arborescence est
intégrée à l'image au moment du build. Dans la configuration par défaut de Cloud
Run, ce répertoire est **éphémère** — l'historique ne survit ni à un redémarrage ni
à un redéploiement.

- **Console :** Filestore → Instances (lorsque `enable_nfs = true`).
- **CLI :**
  ```bash
  # Confirm the injected environment on the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Avant d'activer NFS pour un historique durable, lisez la réserve concernant le
journal WAL dans la [§1 Vue d'ensemble](#1-overview) et dans
[Gatus_Common](Gatus_Common.md) — Cloud Run ne propose aucune option de PVC en mode
bloc, si bien que NFS est ici le seul mécanisme de persistance facultatif, et il
présente un risque réel de corruption pour un fichier SQLite en mode WAL. Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle général de montage NFS (Filestore).

### C. Secret Manager {#c-secret-manager}

Gatus ne génère **aucun** secret au moment du déploiement — il n'y a ni mot de passe
de base de données ni clé de chiffrement à gérer. Secret Manager n'est utilisé que si
vous fournissez vos propres secrets via `secret_environment_variables` (par exemple
une `${VAR}` référencée dans la configuration des alertes de `config.yaml`).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`, ce qui permet l'accès
public dont une page de statut a généralement besoin. Un équilibreur de charge HTTPS
externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs. Gatus journalise le résultat de chaque vérification de
point de terminaison (réussite/échec, durée) au fil de son exécution.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Gatus {#3-gatus-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Gatus n'a ni
  base de données externe ni étape de migration. Il lit `config.yaml`, initialise
  son stockage d'historique SQLite (s'il est configuré) et commence immédiatement à
  servir. Aucun job d'initialisation n'existe par défaut.
- **Stockage d'historique éphémère par défaut.** `/data/data.db` réside sur le
  système de fichiers local accessible en écriture du conteneur, sans aucun montage
  sauf si vous choisissez NFS. Chaque redémarrage ou redéploiement réinitialise
  l'historique des vérifications (la page de statut elle-même et toutes les
  vérifications actuellement configurées ne sont pas affectées — seuls les résultats
  historiques et les pourcentages de disponibilité sont réinitialisés).
- **La boucle d'interrogation du watchdog a besoin d'un CPU alloué.** Chaque point
  de terminaison configuré est vérifié selon son propre intervalle indépendant par
  une goroutine interne au processus ; `cpu_always_allocated = true` garantit que
  celle-ci continue de s'exécuter entre les consultations de pages entrantes.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/health`, qui
  renvoie HTTP 200 dès que le serveur se lie au port 8080. Vérifiez :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s -o /dev/null -w '%{http_code}\n' "$SERVICE_URL/health"      # -> 200
  ```
- **Consulter la page de statut.**
  ```bash
  curl -s "$SERVICE_URL/" | head -20     # rendered HTML status page
  ```
- **Les modifications de configuration nécessitent un nouveau build.** Gatus n'a ni
  interface d'administration ni API pour modifier les points de terminaison
  surveillés. Éditez `modules/Gatus_Common/scripts/config.yaml` (ajoutez, supprimez
  ou modifiez des entrées `endpoints`) et redéployez pour appliquer les
  modifications.
- **L'accès est ouvert tant que vous ne le configurez pas.** Par défaut, la page de
  statut n'a aucune authentification. Configurez basic-auth ou OIDC dans le bloc
  `security` de `config.yaml` et redéployez pour restreindre la consultation.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gatus ou notables pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `application_name` | `gatus` | Nom de base du service, du dépôt du registre et des secrets. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Gatus` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base épinglée `v5.36.0`. Épinglez une version `v5.x.y` explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` déploie directement une image. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher de gen2 est de 512Mi). |
| `min_instance_count` | `1` | Nombre minimal d'instances. |
| `max_instance_count` | `1` | **Conservez 1** — des réplicas interrogeraient chacun indépendamment tous les points de terminaison et dupliqueraient les alertes. |
| `container_port` | `8080` | Gatus écoute sur le port 8080. |
| `container_protocol` | `http1` | HTTP/1.1 par défaut. |
| `cpu_always_allocated` | `true` | Requis pour que la boucle d'interrogation du watchdog ne soit jamais bridée entre les requêtes. |
| `enable_cloudsql_volume` | `false` | Désactivé — Gatus n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Gatus dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour une page de statut publique. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque la consultation non authentifiée.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Substitutions pour les références de type `${VAR}` dans `config.yaml` (p. ex. un jeton de webhook d'alerte), et non des surcharges par paramètre. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Montage facultatif pour un historique durable. **Attention :** présente un risque lié à WAL sur un système de fichiers réseau — voir la §1. |
| `nfs_mount_path` | `/data` | Chemin de montage NFS ; correspond au `storage.path` intégré dans `config.yaml`. |
| `storage_buckets` | `[]` | Non requis — Gatus n'utilise aucun stockage d'objets. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Gatus n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `gatus` | Inertes sauf si une base de données externe est délibérément activée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Gatus n'a besoin d'aucun job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health` 10s delay | Sonde de démarrage. Gatus devient sain en quelques secondes. |
| `liveness_probe` | HTTP `/health` 15s delay | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — Gatus ne dépend pas de Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyés lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de la base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs du point de terminaison de la base de données — inutilisés avec `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `container_port`/`timeout_seconds` hors limites, une valeur de mémoire inférieure au plancher de gen2. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour un historique durable) | Laissez `false` ; utilisez plutôt `Gatus_GKE` avec `stateful_pvc_enabled` | Critique | Gatus code en dur le mode de journalisation WAL de SQLite, que la documentation de SQLite elle-même indique comme non pris en charge sur les systèmes de fichiers réseau — un historique sur NFS risque une corruption silencieuse au fil du temps. |
| `max_instance_count` | `1` | Élevé | Au-delà de 1, chaque réplica interroge indépendamment tous les points de terminaison, ce qui duplique les notifications d'alerte sans aucune coordination entre les instances. |
| `cpu_always_allocated` | `true` | Élevé | Le définir sur `false` permet à Cloud Run de brider le CPU entre les requêtes, ce qui bloque ou saute silencieusement les vérifications planifiées des points de terminaison par le watchdog. |
| `ingress_settings` | `all` | Élevé | `internal` rend une page de statut publique inaccessible depuis l'extérieur du VPC. |
| `enable_iap` | uniquement si l'accès doit être authentifié | Élevé | IAP exige une connexion Google pour chaque requête, ce qui bloque la consultation non authentifiée de la page de statut — rarement ce que souhaite une page de statut publique. |
| Bloc `security` de Gatus dans `config.yaml` | À configurer si la page contient des noms de points de terminaison sensibles | Moyen | Laissée par défaut, la page de statut (y compris les noms de tous les points de terminaison configurés et leur historique de disponibilité) est visible publiquement par toute personne disposant de l'URL. |
| `container_port` | `8080` | Moyen | Le remplacer par une valeur sur laquelle Gatus n'écoute pas fait échouer toutes les sondes de santé. |
| `memory_limit` | `512Mi` | Faible | L'environnement d'exécution gen2 rejette les valeurs inférieures à 512Mi au moment de l'apply. |
| `application_version` | Épinglez `v5.x.y` en production | Faible | `latest` correspond à une base épinglée (`v5.36.0`) ; épinglez explicitement pour maîtriser les mises à niveau. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Gatus, partagée avec la variante GKE, est décrite dans
**[Gatus_Common](Gatus_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gatus sur Cloud Run](../labs/Gatus_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gatus sur GKE Autopilot](Gatus_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gatus Common — Configuration applicative partagée](Gatus_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Beszel sur Google Cloud Run](Beszel_CloudRun.md), [Netdata sur Google Cloud Run](Netdata_CloudRun.md) dans la solution **Monitoring & NOC**.
