---
title: "Beszel sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Beszel sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Beszel_CloudRun.md @ 15fd4c7 sha256:68bacf9f8a68 -->

# Beszel sur Google Cloud Run {#beszel-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Beszel_CloudRun.png" alt="Beszel sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Beszel est un hub de surveillance de serveurs léger et open source — métriques
historiques des ressources, statistiques des conteneurs Docker et alertes
configurables, basé sur PocketBase (Go plus une base de données SQLite
embarquée). Ce module déploie le hub Beszel sur **Cloud Run v2** au-dessus de
la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Beszel et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Beszel s'exécute comme un conteneur Go unique sur Cloud Run v2, servant son
interface web et son API REST sur le port 8090. Il conserve tout son état dans
une base de données SQLite embarquée sous `/beszel_data`, qui est montée à partir du
volume NFS (Filestore) partagé. Le déploiement relie un ensemble
délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Go unique, 1 vCPU / 1 GiB par défaut, port 8090 |
| Base de données | **Aucune** | Beszel embarque sa propre base de données PocketBase/SQLite — aucune instance Cloud SQL n'est provisionnée |
| Stockage de fichiers | Cloud Filestore (NFS) | Monté à `/beszel_data` pour toute la persistance ; le volume de données GCS est désactivé tant que NFS possède ce chemin |
| Cache et file d'attente | **Aucun** | Beszel n'utilise pas Redis ; `enable_redis` est forcé à l'arrêt |
| Secrets | Secret Manager | Aucun secret d'application injecté — le premier administrateur est créé dans l'interface utilisateur |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app` (`ingress_settings = "all"`) ; LB HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données, pas de Redis.** Beszel est autonome — `database_type = "NONE"`,
  `enable_cloudsql_volume = false`, et `enable_redis = false`. Tout l'état est la base de données SQLite
  embarquée sous `/beszel_data`.
- **La persistance est NFS, pas GCS FUSE.** `enable_nfs = true` monte le partage NFS à
  `/beszel_data`, de sorte que la base de données SQLite et les métriques
  historiques survivent aux remplacements de révision et aux événements de
  mise à l'échelle. GCS FUSE ne peut pas héberger les bases de données SQLite
  en mode WAL de Beszel (il lui manque le verrouillage dont SQLite a besoin),
  donc le volume de données GCS est désactivé chaque fois que NFS est monté à
  `/beszel_data`. Gardez `enable_nfs = true`.
- **L'instance unique est délibérée.** `min_instance_count = max_instance_count = 1`. Beszel est une application
  à écrivain unique (un seul fichier SQLite) ; exécuter plus d'une instance
  sur la même base de données risque des conflits de verrouillage et une
  corruption. N'augmentez **pas** `max_instance_count`.
- **`min_instance_count = 1` (pas de scale-to-zero).** Le hub est maintenu chaud afin que la
  base de données SQLite reste ouverte et que les agents puissent signaler en
  continu ; il s'agit d'un backend de surveillance, pas d'une application de
  requête/réponse en rafale.
- **Port 8090.** Le hub de Beszel écoute sur 8090 ; le port du conteneur et
  les sondes sont configurés en conséquence.
- **Ingress public par défaut.** `ingress_settings = "all"` expose l'URL `run.app` afin que
  les agents distants et les navigateurs puissent atteindre le hub. L'activation
  d'IAP bloquera le signalement des agents depuis les machines qui ne peuvent
  pas présenter une identité Google.
- **Chemin de santé `/api/health`.** Les sondes de démarrage et de vivacité
  atteignent le point de terminaison de santé public et non authentifié du hub
  (200 lorsque prêt).
- **L'administrateur initial est créé dans l'interface utilisateur.** Aucun mot
  de passe administrateur n'est stocké dans Secret Manager ; ouvrez le hub
  après le déploiement et complétez la configuration du superutilisateur de
  PocketBase lors de la première exécution.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Beszel {#a-cloud-run--the-beszel-service}

Beszel s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable ; comme l'application est à écrivain unique, le service est
épinglé à une seule instance plutôt que de s'auto-adapter.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~beszel"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. NFS — le volume `/beszel_data` {#b-nfs--the-beszel_data-volume}

Le volume NFS partagé (Cloud Filestore ou le serveur NFS Services_GCP) contient
tout l'état de Beszel (la base de données SQLite, la configuration et les
métriques historiques). Il est monté à `/beszel_data` (nécessite l'environnement
d'exécution `gen2`, qui est le défaut). Un bucket Cloud Storage est
toujours créé pour le déploiement, mais il n'est pas monté à `/beszel_data` tant que
NFS possède ce chemin — GCS FUSE ne peut pas fournir le verrouillage dont le
mode WAL de SQLite a besoin.

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format="yaml(spec.template.spec.volumes)"
  ```

> **Attention :** Ce volume **est** la base de données. Ne le videz pas — cela
> effacerait tout l'historique de surveillance et le compte administrateur.
> Voir [App_CloudRun](App_CloudRun.md) pour les options NFS.

### C. Secret Manager {#c-secret-manager}

Beszel n'injecte **aucun** secret d'application — il n'y a pas de clé de
chiffrement, de secret JWT ou de mot de passe de base de données à gérer (la
base de données est SQLite embarquée, et l'administrateur est créé dans
l'interface utilisateur). Une liste de secrets ne montre que ce que la
fondation elle-même crée.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~beszel"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour savoir comment les variables d'environnement
secrètes seraient injectées si vous en ajoutiez via `secret_environment_variables`.

### D. Réseau et ingress {#d-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`), ce
qui permet aux agents distants de POSTer leurs métriques au hub. Un
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

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et
des politiques d'alerte optionnelles. (Notez que Beszel lui-même est un
produit de surveillance — la surveillance GCP observe ici le *hub*, pas les
machines que Beszel surveille.)

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Beszel {#3-beszel-application-behaviour}

- **Pas de job d'initialisation ; le schéma est auto-géré.** Beszel crée et
  migre sa base de données PocketBase/SQLite embarquée automatiquement au
  premier démarrage (et à chaque mise à niveau de version). Il n'y a pas de
  job `db-init` car il n'y a pas de base de données externe.
- **L'état réside sur le volume NFS.** Tout ce qui se trouve sous `/beszel_data` —
  la base de données SQLite, la configuration et les métriques historiques —
  est persisté sur le partage NFS. Les révisions et les redémarrages
  réutilisent le même partage, de sorte que l'historique survit.
- **La configuration initiale se fait dans l'interface utilisateur.** Ouvrez
  l'URL du service et complétez la création du compte superutilisateur
  (administrateur) de PocketBase lors de la première exécution. Il n'y a pas
  de credential administrateur auto-généré dans Secret Manager. Après avoir
  créé l'administrateur, ajoutez les systèmes que vous souhaitez surveiller et
  installez l'agent Beszel sur chacun (le hub affiche la commande
  d'installation de l'agent et la clé publique).
- **Écrivain unique — ne pas mettre à l'échelle.** Avec un seul fichier
  SQLite sur un montage partagé, une seule instance peut écrire. `min = max = 1` est
  appliqué intentionnellement ; une garde au moment de la planification rejette
  également `min_instance_count > max_instance_count`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/health`, qui renvoie `200` une fois le hub prêt. Inspectez la
  révision en cours d'exécution et ses env/montages :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Maintenu chaud.** `min_instance_count = 1` évite les démarrages à froid afin que les
  agents signalent en continu et que la base de données SQLite reste ouverte.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Beszel sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `beszel` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Beszel. `latest` résout l'image de base vers le `0.9.1` épinglé ; définissez un tag explicite (par exemple `0.9.1`) pour contrôler les mises à niveau. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; Beszel est léger, 1 vCPU est amplement suffisant. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 512 Mi-1 Gi est typique (le plancher gen2 est 512 Mi). |
| `min_instance_count` | `1` | Maintenu à 1 — un écrivain SQLite, pas de scale-to-zero. |
| `max_instance_count` | `1` | **Ne pas augmenter.** Plus d'une instance corrompt la base de données SQLite partagée. |
| `container_port` | `8090` | Le hub de Beszel écoute sur 8090. |
| `execution_environment` | `gen2` | Requis pour le montage NFS `/beszel_data`. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Beszel dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` permet aux agents distants d'atteindre le hub. `internal` bloque le signalement des agents hors VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque les agents qui ne peuvent pas présenter une identité Google.** |

### Groupe — Stockage et système de fichiers {#group--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Garder activé : NFS contient `/beszel_data` (la base de données SQLite). GCS FUSE ne peut pas l'héberger. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires (nécessite gen2). Ne pas en monter un à `/beszel_data`. |
| `create_cloud_storage` | `true` | Provisionner les buckets de stockage déclarés. |

### Groupe — Backend de base de données {#group--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Beszel n'a pas de base de données externe — laisser comme `NONE`. |
| `enable_cloudsql_volume` | `false` | Pas de proxy d'authentification Cloud SQL ; Beszel utilise SQLite embarqué. |

### Groupe — Cache et file d'attente Redis {#group--redis-cache--queue}

Beszel n'utilise pas Redis. `enable_redis` n'est pas exposé comme une variable sur ce
module — le wrapper `main.tf` code en dur `enable_redis = false` dans son appel à
`App_CloudRun` (dont la valeur par défaut est `true`), il n'y a donc rien à
configurer ici.

### Groupe — Observabilité et santé {#group--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health` 15s de délai | Sonde de démarrage ; fenêtre de 10 tentatives pour la création du schéma au premier démarrage. |
| `liveness_probe` | HTTP `/api/health` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/health" }` | Vérification de disponibilité Cloud Monitoring optionnelle contre le hub. |

Toutes les autres entrées suivent le comportement standard de
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `beszel_url` | URL du service pour l'interface utilisateur/API du hub Beszel. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — IAP
> sans identités autorisées, un runtime `gen1` avec des montages GCS, un
> `backup_retention_days` hors de portée, `min_instance_count > max_instance_count`. Une configuration invalide fait
> échouer le **plan** avec une erreur claire et nommée avant la création de
> toute ressource, de sorte que la plupart des erreurs ci-dessous sont
> détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Partage NFS à `/beszel_data` | Ne jamais vider ; garder `enable_nfs = true` | Critique | Le partage **est** la base de données SQLite — le vider efface tout l'historique de surveillance et le compte administrateur. |
| `max_instance_count` | `1` | Critique | Exécuter >1 instance sur la base de données SQLite partagée provoque des conflits de verrouillage et une corruption de la base de données. |
| `enable_cloudsql_volume` / `database_type` | `false` / `NONE` | Élevé | Beszel n'a pas de base de données externe ; l'activation de Cloud SQL provisionne une instance inutilisée et configure mal le démarrage. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter le volume NFS `/beszel_data`, donc l'état n'est pas persisté. |
| `ingress_settings` | `all` | Élevé | `internal` bloque les agents extérieurs au VPC pour qu'ils ne signalent pas au hub. |
| `enable_iap` | uniquement pour l'interface utilisateur, jamais avec des agents hors Google | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris le signalement des métriques des agents. |
| `min_instance_count` | `1` | Moyen | Le scale-to-zero (`0`) supprime l'écrivain SQLite chaud et interrompt le signalement continu des agents ; également bloqué par la garde min/max lorsqu'il est défini au-dessus de `max`. |
| `container_port` | `8090` | Moyen | Le hub n'écoute que sur 8090 ; le modifier sans faire correspondre l'image rompt les sondes et l'ingress. |
| `application_version` | épingler explicitement | Moyen | `latest` résout l'image de base vers le `0.9.1` épinglé ; épingler un vrai tag pour contrôler les mises à niveau et éviter les migrations de schéma surprises. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Beszel partagée avec la variante GKE est décrite
dans **[Beszel_Common](Beszel_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Beszel sur Cloud Run](../labs/Beszel_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Beszel sur GKE Autopilot](Beszel_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Beszel Common — Configuration d'application partagée](Beszel_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Netdata sur Google Cloud Run](Netdata_CloudRun.md) dans la solution **Surveillance et NOC**.
