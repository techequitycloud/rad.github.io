---
title: "Ntfy sur Google Cloud Run"
description: "Référence de configuration pour déployer Ntfy sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ntfy_CloudRun.md @ 3055034 sha256:60fb1ac267c9 -->

# Ntfy sur Google Cloud Run {#ntfy-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ntfy_CloudRun.png" alt="Ntfy sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ntfy est un serveur open source de notifications push pub/sub sous licence Apache 2.0, écrit
en Go. Les applications publient des messages via une API REST/HTTP simple et les clients les reçoivent
instantanément via des flux WebSocket ou Server-Sent-Events (SSE) — aucune base de données
externe n'est requise. Ce module déploie ntfy sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud utilisés par ntfy et sur la manière de les explorer et de
les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ntfy s'exécute sous forme d'un unique conteneur Go sur Cloud Run v2. Le déploiement assemble un
ensemble volontairement restreint de services Google Cloud — ntfy ne dépend lui-même d'aucune base de données,
d'aucun cache ni d'aucun stockage d'objets :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Go unique, 1 vCPU / 512 MiB par défaut ; CPU toujours allouée pour les flux de longue durée |
| Base de données | **Aucune** | `database_type = "NONE"` ; le cache de messages est un fichier SQLite local, aucune instance Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut) ou NFS (facultatif) | Cache SQLite dans `/var/cache/ntfy/cache.db` ; activez NFS pour un historique des messages durable |
| Stockage d'objets | **Aucun** | ntfy ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; ntfy utilise un bus de messages interne au processus |
| Secrets | Secret Manager | Aucun secret généré automatiquement ; uniquement les `secret_environment_variables` fournies par l'utilisateur |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — ntfy conserve son cache
  de messages dans un fichier SQLite local. Les variables liées à la base de données existent par
  souci d'exhaustivité mais restent inertes, sauf si vous optez délibérément pour une base de données externe.
- **Le cache de messages est éphémère par défaut.** Il se trouve dans
  `/var/cache/ntfy/cache.db`. Le système de fichiers racine de Cloud Run est en lecture seule ; le
  point d'entrée se rabat donc sur `/tmp/ntfy` lorsque le répertoire configuré n'est pas accessible
  en écriture. L'historique des messages est par conséquent perdu à chaque redémarrage/redéploiement, sauf si vous
  activez NFS (`enable_nfs = true`) et faites pointer le répertoire de cache vers le point de montage.
- **La CPU est toujours allouée (`cpu_always_allocated = true`).** ntfy maintient ouverts des flux
  WebSocket/SSE de longue durée pour envoyer en temps réel les messages aux abonnés connectés ;
  la CPU ne doit donc pas être bridée entre les requêtes. Passer cette valeur à `false` réduit les coûts
  sur une instance peu sollicitée, mais suspend la distribution en temps réel pendant les périodes d'inactivité.
- **Instance unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Comme le flux d'un abonné est ancré à l'instance qui le détient et qu'il n'existe
  aucun bus de messages partagé, le scale-out n'est pas le comportement par défaut. Conservez un maximum de 1, sauf si vous
  placez un cache/broker partagé derrière ntfy.
- **L'entrée publique est la valeur par défaut** (`ingress_settings = "all"`) afin que les éditeurs et
  les abonnés puissent atteindre le service. L'activation d'IAP impose une connexion Google et bloque
  les appels de publication/abonnement non authentifiés.
- **Le point de terminaison de santé est `/v1/health`**, qui renvoie `{"healthy":true}` avec un HTTP
  200 dès que le serveur s'est lié à son port.
- **Le contrôle d'accès est une étape postérieure au déploiement.** ntfy est livré en accès ouvert ; configurez
  ensuite les utilisateurs et les ACL de sujets via sa CLI ou les variables d'environnement `NTFY_AUTH_*`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources
figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service ntfy {#a-cloud-run--the-ntfy-service}

ntfy s'exécute comme un service Cloud Run v2. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre plusieurs révisions pour des déploiements progressifs sûrs. Comme la CPU est toujours
allouée, une instance active maintient les flux de ses abonnés entre les requêtes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les
  métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Persistance — le cache de messages SQLite {#b-persistence--the-sqlite-message-cache}

ntfy n'a **aucune instance Cloud SQL**. Son cache de messages est un fichier SQLite local situé à
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), créé par le point d'entrée au démarrage.
Sur le système de fichiers racine en lecture seule de Cloud Run, le point d'entrée se rabat sur `/tmp/ntfy`
lorsque ce chemin n'est pas accessible en écriture — avec la configuration par défaut, le cache est donc
**éphémère** et l'historique des messages ne survit pas à un redémarrage.

Pour un historique durable, activez NFS et montez-le à l'emplacement du cache :

- **Console :** Filestore → Instances (lorsque `enable_nfs = true`).
- **CLI :**
  ```bash
  # Confirm the cache path injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de montage NFS (Filestore).

### C. Secret Manager {#c-secret-manager}

ntfy ne génère **aucun** secret au moment du déploiement — il n'y a ni mot de passe de base de données ni
clé de chiffrement à gérer. Secret Manager n'est utilisé que si vous fournissez vos propres secrets via
`secret_environment_variables` (par exemple une valeur `NTFY_AUTH_*` ou un identifiant
de push en amont).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est accessible par défaut à son URL `run.app`, ce qui permet l'accès public
dont ntfy a besoin pour le trafic de publication/abonnement. Un équilibreur de charge HTTPS externe
avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté ; les paramètres d'entrée
et la sortie VPC contrôlent la connectivité. Si les clients utilisent le streaming HTTP/2, définissez
`container_protocol = "h2c"`.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run vers Cloud Monitoring,
avec des tests de disponibilité et des règles d'alerte facultatifs. ntfy journalise son adresse d'écoute et
le chemin de cache résolu au démarrage.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Ntfy {#3-ntfy-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** ntfy n'a ni base de données externe ni
  étape de migration. Le point d'entrée prépare le répertoire du cache SQLite et lance immédiatement
  `ntfy serve` via exec. Il n'y a pas de tâche `db-init` par défaut.
- **Cache éphémère avec repli automatique.** Le point d'entrée crée le répertoire de
  `NTFY_CACHE_FILE` ; sur le rootfs en lecture seule de Cloud Run, il se rabat sur
  `/tmp/ntfy` et journalise un avertissement. Cela maintient en bonne santé un déploiement de base (sans NFS).
  Activez NFS pour un historique des messages durable.
- **La distribution en temps réel exige une CPU allouée.** Les abonnés maintiennent ouverts des flux WebSocket/SSE ;
  `cpu_always_allocated = true` garantit que le bus de messages interne au processus continue de
  distribuer entre les requêtes entrantes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/v1/health`, qui renvoie
  `{"healthy":true}` et un HTTP 200 dès que le serveur s'est lié au port 80. Vérification :
  ```bash
  SERVICE_URL=$(gcloud run services describe <service-name> \
    --project "$PROJECT" --region "$REGION" --format='value(status.url)')
  curl -s "$SERVICE_URL/v1/health"      # -> {"healthy":true}
  ```
- **Test rapide de publication / abonnement.**
  ```bash
  curl -d "hello from ntfy" "$SERVICE_URL/mytopic"     # publish
  curl -s "$SERVICE_URL/mytopic/json"                   # subscribe (streaming JSON)
  ```
- **L'accès reste ouvert tant que vous ne le verrouillez pas.** Par défaut, n'importe quel client peut publier sur
  n'importe quel sujet et s'y abonner. Configurez les utilisateurs et les ACL par sujet après le déploiement via la
  CLI de ntfy (`ntfy user add`, `ntfy access`) ou les variables d'environnement `NTFY_AUTH_*`.
- **URL de base publique pour les pièces jointes / le web push.** Si vous utilisez les pièces jointes ou le web push
  du navigateur, définissez `NTFY_BASE_URL` (via `environment_variables`) sur l'URL publique
  du service afin que les liens générés soient résolus correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à ntfy ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `application_name` | `ntfy` | Nom de base du service, du dépôt du registre et des secrets. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Ntfy` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base épinglée `v2.11.0`. Épinglez une version `v2.x.y` explicite en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure de support. |
| `container_image_source` | `custom` | `custom` construit l'image d'encapsulation via Cloud Build ; `prebuilt` déploie directement une image. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512Mi). |
| `min_instance_count` | `1` | Nombre minimal d'instances. |
| `max_instance_count` | `1` | **Conservez 1** — les flux sont locaux à l'instance, sans broker partagé. |
| `container_port` | `80` | ntfy écoute sur le port 80. |
| `container_protocol` | `http1` | Définissez `h2c` pour un streaming HTTP/2 de bout en bout. |
| `cpu_always_allocated` | `true` | Requis pour la distribution des flux en temps réel ; passez à `false` uniquement pour réduire les coûts d'une instance peu sollicitée. |
| `enable_cloudsql_volume` | `false` | Désactivé — ntfy n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Met en miroir l'image ntfy dans Artifact Registry. |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour le trafic public de publication/abonnement. |
| `enable_iap` | `false` | Impose une connexion Google. **Bloque les publications/abonnements non authentifiés.** |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `NTFY_*` supplémentaires (par ex. `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | À activer pour adosser le cache SQLite à NFS afin d'obtenir un **historique des messages durable**. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS ; faites pointer `NTFY_CACHE_FILE` vers celui-ci pour la persistance. |
| `storage_buckets` | `[]` | Non requis — ntfy n'utilise aucun stockage d'objets. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy n'a pas de base de données externe ; conservez `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inertes, sauf si une base de données externe est délibérément activée. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | ntfy n'a besoin d'aucun job d'initialisation ; laissez vide. |
| `cron_jobs` | `[]` | Jobs Cloud Run planifiés facultatifs. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/v1/health` délai de 30s | Sonde de démarrage. ntfy devient sain en quelques secondes. |
| `liveness_probe` | HTTP `/v1/health` délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/v1/health" }` | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — ntfy ne dépend pas de Redis. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

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
| `initialization_jobs` | Noms des éventuelles tâches de configuration (aucune par défaut). |
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

> **Validation au moment du plan héritée.** Ce module fait transiter sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identités autorisées, environnement d'exécution `gen1` avec montages NFS/GCS, `container_port`/`timeout_seconds` hors plage, valeur de mémoire inférieure au plancher gen2. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour un historique durable) | `true` lorsque l'historique compte | Élevé | Avec le cache éphémère par défaut, tout l'historique des messages est perdu à chaque redémarrage/redéploiement — acceptable pour un simple relais, surprenant si vous attendiez de la persistance. |
| `max_instance_count` | `1` | Élevé | Monter au-delà de 1 répartit les abonnés entre plusieurs instances sans bus partagé : un message publié sur une instance n'est pas distribué aux abonnés rattachés à une autre. |
| `cpu_always_allocated` | `true` | Élevé | La valeur `false` permet à Cloud Run de brider la CPU entre les requêtes, ce qui suspend la distribution WebSocket/SSE en temps réel lorsque l'instance est inactive. |
| `ingress_settings` | `all` | Élevé | `internal` empêche les éditeurs et abonnés externes d'atteindre le service. |
| `enable_iap` | uniquement si un accès authentifié est voulu | Élevé | IAP impose une connexion Google pour chaque requête, bloquant les publications/abonnements non authentifiés — ce qui n'est généralement pas souhaitable pour un point de terminaison de notification. |
| `NTFY_BASE_URL` | URL réelle du service | Moyen | Si elle n'est pas définie, les liens des pièces jointes et du web push pointent vers le mauvais hôte. |
| Contrôle d'accès ntfy | À configurer après le déploiement | Moyen | Laissé par défaut, n'importe quel client peut publier sur n'importe quel sujet d'une URL publique et s'y abonner. |
| `container_protocol` | `http1` (ou `h2c`) | Moyen | Une incompatibilité avec des clients exigeant le streaming HTTP/2 dégrade ou rompt les flux de longue durée. |
| `memory_limit` | `512Mi` | Faible | L'environnement d'exécution gen2 rejette les valeurs inférieures à 512Mi au moment de l'application. |
| `application_version` | Épingler `v2.x.y` en production | Faible | `latest` correspond à une base épinglée (`v2.11.0`) ; épinglez explicitement pour maîtriser les mises à niveau. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à ntfy partagée
avec la variante GKE est décrite dans **[Ntfy_Common](Ntfy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ntfy sur Cloud Run](../labs/Ntfy_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ntfy sur GKE Autopilot](Ntfy_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ntfy Common — Configuration applicative partagée](Ntfy_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés d'[EvolutionAPI sur Google Cloud Run](EvolutionAPI_CloudRun.md), de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), de [n8n sur Google Cloud Run](N8N_CloudRun.md) et de [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md) dans la solution **Conversational Outreach**.
