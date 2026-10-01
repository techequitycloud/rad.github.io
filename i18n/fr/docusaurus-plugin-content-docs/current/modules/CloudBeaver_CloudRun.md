---
title: "CloudBeaver sur Google Cloud Run"
description: "Référence de configuration pour déployer CloudBeaver sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CloudBeaver_CloudRun.md @ 3055034 sha256:450e65949041 -->

# CloudBeaver sur Google Cloud Run {#cloudbeaver-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CloudBeaver_CloudRun.png" alt="CloudBeaver sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

CloudBeaver est un gestionnaire de bases de données web, accessible depuis un navigateur, issu du projet DBeaver
— une console d'administration unique pour se connecter à PostgreSQL, MySQL, SQL Server,
Oracle, SQLite et de nombreux autres moteurs, et les interroger. Ce module déploie
CloudBeaver sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par CloudBeaver et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

CloudBeaver s'exécute sous la forme d'un unique conteneur JVM sur Cloud Run v2. Comme CloudBeaver conserve
tout son état dans un espace de travail persistant et ne provisionne aucune base de données applicative,
le déploiement assemble un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Un seul service JVM, 1 vCPU / 1 GiB par défaut, port 8978 |
| Espace de travail persistant | Cloud Storage (GCS FUSE) | Un bucket dédié monté sur `/opt/cloudbeaver/workspace` contient tout l'état de CloudBeaver |
| Base de données | **Aucune provisionnée** | `database_type = "NONE"` — CloudBeaver stocke son propre état ; il *se connecte* aux bases de données que vous configurez dans l'interface |
| Cache et file d'attente | **Aucun** | CloudBeaver n'utilise pas Redis ; `enable_redis` est forcé à désactivé |
| Secrets | Secret Manager | Aucun secret applicatif n'est généré — le compte administrateur est créé via l'assistant de configuration au premier lancement |
| Entrée | URL Cloud Run / Cloud Load Balancing | **`all` par défaut** (Internet public) ; définissez `ingress_settings = "internal"` pour restreindre l'accès au VPC, ou placez-le derrière un équilibreur de charge HTTPS externe |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données applicative n'est provisionnée.** `database_type = "NONE"`. CloudBeaver
  conserve ses métadonnées dans un magasin H2 intégré à l'intérieur du volume de l'espace de travail. Les
  bases de données qu'il *gère* sont ajoutées par un opérateur dans l'interface après le déploiement.
- **Tout l'état réside dans un unique espace de travail adossé à GCS.** Le bucket `storage` est monté via
  GCS FUSE sur `/opt/cloudbeaver/workspace`. Si vous perdez ou remplacez ce bucket, vous perdez
  toutes les connexions, tous les utilisateurs et tous les paramètres enregistrés.
- **Une seule instance par conception.** `min_instance_count = 1` (évite les démarrages à froid lents de la JVM)
  et `max_instance_count = 1` (l'espace de travail est un magasin à écrivain unique). **N'augmentez pas**
  `max_instance_count` — des écrivains concurrents corrompent la base H2 intégrée.
- **L'entrée vaut `all` par défaut.** Le service est accessible depuis l'Internet public
  dès l'installation — un point réellement important pour une console d'administration de bases de données. Pour restreindre
  l'accès à l'intérieur du VPC, définissez `ingress_settings = "internal"`, ou placez-le derrière un
  équilibreur de charge HTTPS externe (et IAP) pour un accès public contrôlé.
- **Le compte administrateur revient au premier visiteur.** CloudBeaver n'a pas d'administrateur
  préconfiguré — terminez l'assistant de configuration immédiatement dès que le service est accessible.
- **`application_version = "latest"` est transmis sans problème.** L'image est construite à partir de
  `dbeaver/cloudbeaver:<version>` via un ARG de build propre à l'application, `CLOUDBEAVER_VERSION` ;
  épinglez un tag précis pour des déploiements reproductibles.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service CloudBeaver {#a-cloud-run--the-cloudbeaver-service}

CloudBeaver s'exécute en tant que service Cloud Run v2 écoutant sur le port **8978**. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements
progressifs sûrs. Comme l'espace de travail est à écrivain unique, maintenez le service à une seule
instance.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the container port and image:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].ports[0].containerPort, spec.template.spec.containers[0].image)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution
et la répartition du trafic.

### B. Cloud Storage — le volume de l'espace de travail {#b-cloud-storage--the-workspace-volume}

L'intégralité de l'état de CloudBeaver — sa base de métadonnées H2 intégrée, les connexions enregistrées,
les utilisateurs et la configuration — persiste sous `/opt/cloudbeaver/workspace`, qui est un
montage **GCS FUSE** d'un bucket Cloud Storage dédié (le bucket `storage` déclaré
par CloudBeaver_Common). Ce bucket est le cœur durable du déploiement.

- **Console :** Cloud Storage → Buckets → le bucket `storage` de CloudBeaver.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  gcloud storage ls -r gs://<workspace-bucket>/       # inspect workspace contents
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS FUSE (qui nécessite l'environnement d'exécution
gen2) et les options CMEK.

### C. Connectivité aux bases de données (aucune instance gérée) {#c-database-connectivity-no-managed-instance}

Ce module ne provisionne **aucune instance Cloud SQL** — `gcloud sql instances list`
n'en affichera aucune créée par CloudBeaver. CloudBeaver se connecte plutôt aux
bases de données que vous enregistrez dans son interface. Pour atteindre le Cloud SQL partagé du déploiement (ou
toute base de données privée), le service doit disposer d'une sortie VPC configurée (gérée par le
socle) et la cible doit être accessible sur le VPC.

- **CLI (vérifiez que le chemin de sortie existe, puis testez depuis l'intérieur du VPC) :**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.metadata.annotations)'   # VPC connector / egress annotations
  ```

### D. Secret Manager {#d-secret-manager}

CloudBeaver ne génère **aucun secret applicatif** — il n'y a ni clé de chiffrement,
ni secret JWT, ni mot de passe de base de données à gérer (il n'y a pas de base de données). Le compte
administrateur est créé via l'assistant de configuration au premier lancement, et tout l'état réside dans
l'espace de travail. Les secrets éventuels du socle suivent le modèle standard.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le service utilise par défaut **`ingress_settings = "all"`** — il est accessible depuis l'Internet
public sur l'URL `run.app` dès l'installation, un point réellement important pour une console
d'administration de bases de données. Dans ce mode, l'output `cloudbeaver_url` est cette URL publique du service.
Pour restreindre l'accès à l'intérieur du VPC, définissez `ingress_settings = "internal"`,
ou placez le service derrière un équilibreur de charge HTTPS externe (éventuellement avec un domaine
personnalisé, Cloud CDN, Cloud Armor et IAP) pour un accès public contrôlé.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour l'équilibrage de charge, les domaines personnalisés et IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec
des tests de disponibilité et des règles d'alerte facultatifs (`uptime_check_config.enabled` vaut par défaut
`false` ; aucun n'est donc créé dès l'installation). Si vous l'activez, notez qu'un test de disponibilité Cloud
Monitoring n'est provisionné que lorsque le point de terminaison est accessible publiquement —
l'entrée `all` par défaut rend l'URL `run.app` éligible ; définir
`ingress_settings = "internal"` supprime le point de terminaison public et, avec lui, la possibilité
de provisionner un test de disponibilité.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application CloudBeaver {#3-cloudbeaver-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni job db-init ni base de données
  applicative. CloudBeaver initialise son propre magasin de métadonnées intégré à l'intérieur de
  l'espace de travail au premier démarrage.
- **L'état réside entièrement dans le volume de l'espace de travail.** La base H2 intégrée, les connexions
  enregistrées, les utilisateurs gérés et la configuration résident tous sous
  `/opt/cloudbeaver/workspace`, adossé au bucket GCS `storage`. Conservez ce
  bucket d'un redéploiement à l'autre pour garder tout l'état de CloudBeaver.
- **Assistant de configuration au premier lancement.** Au premier accès, CloudBeaver présente un assistant de configuration pour
  créer la configuration du serveur et le compte administrateur. Il n'y a pas d'administrateur
  préconfiguré — la première personne qui termine l'assistant devient l'administrateur. Faites-le immédiatement,
  et gardez l'entrée restreinte tant que ce n'est pas fait.
- **Ajouter des bases de données à gérer.** Après vous être connecté en tant qu'administrateur, ajoutez des connexions dans
  l'interface (New Connection → choisissez le pilote → indiquez l'hôte, le port et les identifiants). Pour atteindre
  des bases de données privées sur le VPC, assurez-vous que la sortie VPC est configurée (gérée par le socle).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` (l'interface web de CloudBeaver),
  qui renvoie HTTP 200 une fois que la JVM a fini de démarrer. La sonde de démarrage par défaut
  prévoit un délai initial de 15 secondes plus une fenêtre de 10 échecs — le démarrage de la JVM de CloudBeaver
  est rapide mais pas instantané.
- **Mise à l'échelle à écrivain unique.** Gardez `max_instance_count = 1`. Le magasin de l'espace de travail ne peut pas
  être partagé sans risque par des instances concurrentes.
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à CloudBeaver ou notables pour lui sont listés ; toutes les autres entrées sont héritées
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
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `cloudbeaver` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | _(défini)_ | Nom lisible affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag de l'image CloudBeaver (construite à partir de `dbeaver/cloudbeaver:<version>`) ; épinglez-le pour la reproductibilité. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance. CloudBeaver s'exécute sur la JVM — ne descendez pas en dessous de 512Mi. |
| `min_instance_count` | `1` | Gardez 1 instance à chaud pour éviter les démarrages à froid lents de la JVM. |
| `max_instance_count` | `1` | **Gardez 1.** L'espace de travail est un magasin à écrivain unique ; des instances concurrentes le corrompent. |
| `container_port` | `8978` | Port de l'interface web de CloudBeaver. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Internet public par défaut. Définissez `internal` pour restreindre une console de bases de données au VPC, ou placez-la derrière un équilibreur de charge HTTPS + IAP pour un accès externe contrôlé. |
| `vpc_egress_setting` | _(défini)_ | Détermine quel trafic sortant passe par le VPC — nécessaire pour atteindre des bases de données privées. |
| `enable_iap` | `false` | Exige une connexion Google devant le service (nécessite un équilibreur de charge externe). |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets transmis au conteneur. CloudBeaver n'en a besoin d'aucun pour le premier démarrage. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. Aucun secret applicatif n'est généré par défaut. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne les buckets GCS, y compris le bucket de l'espace de travail CloudBeaver. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket de l'espace de travail provisionné automatiquement. |
| `enable_nfs` | `false` | NFS est désactivé — l'espace de travail de CloudBeaver se trouve sur GCS, pas sur NFS. |
| `gcs_volumes` | `[]` | Montages de volumes GCS FUSE supplémentaires (le montage de l'espace de travail est ajouté automatiquement). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Vide — CloudBeaver n'a besoin d'aucun job d'amorçage (pas de base de données applicative). |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 15s, 10 échecs | Sonde de démarrage ciblant l'interface de CloudBeaver. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de vivacité ciblant l'interface de CloudBeaver. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring — provisionné uniquement lorsque le point de terminaison est accessible publiquement. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md). Notez que
`enable_redis` est forcé à `false` et que `database_type` vaut `NONE` dans ce module ; ces valeurs
ne sont pas destinées à être surchargées.

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `cloudbeaver_url` | URL du service pour l'interface web de CloudBeaver (port 8978). URL publique `run.app` avec la valeur par défaut `ingress_settings = "all"` ; URL VPC interne lorsqu'elle vaut `"internal"`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation (vide par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un environnement d'exécution `gen1` avec des montages GCS FUSE, IAP sans identités autorisées, une valeur de mémoire hors limites inférieure au plancher de 512Mi de gen2. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket `storage` de l'espace de travail | À conserver d'un redéploiement à l'autre | Critical | Le bucket contient tout l'état de CloudBeaver (base H2 intégrée, connexions, utilisateurs, configuration). Le supprimer ou le remplacer efface tous les paramètres. |
| `max_instance_count` | `1` | Critical | L'espace de travail est à écrivain unique ; deux instances écrivant simultanément dans le magasin H2 intégré le corrompent. |
| Assistant de configuration au premier lancement | À terminer immédiatement | High | Il n'y a pas d'administrateur préconfiguré — quiconque atteint l'interface en premier peut s'approprier le compte administrateur. |
| `ingress_settings` | `internal` (ou équilibreur de charge + IAP) | High | Vaut `all` par défaut — une console d'administration de bases de données est accessible depuis l'Internet public dès l'installation, sauf si vous définissez `internal` ou la placez derrière IAP/Cloud Armor. |
| `memory_limit` | `1Gi` (≥ 512Mi) | High | CloudBeaver repose sur la JVM ; une mémoire insuffisante provoque des arrêts pour OOM. gen2 refuse les valeurs inférieures à 512Mi au moment du plan. |
| `min_instance_count` | `1` | Medium | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid lent de la JVM à la première requête après une période d'inactivité. |
| `application_version` | Épingler un tag en production | Medium | `latest` peut faire changer la version de CloudBeaver d'un build à l'autre ; épinglez-le pour la reproductibilité. |
| `enable_redis` / `database_type` | Laisser tels quels (désactivé / `NONE`) | Low | CloudBeaver n'utilise ni l'un ni l'autre ; les surcharger n'apporte rien et n'est pas pris en charge ici. |

---

Pour le comportement du socle mentionné tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à CloudBeaver,
partagée avec la variante GKE, est décrite dans
**[CloudBeaver_Common](CloudBeaver_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : CloudBeaver sur Cloud Run](../labs/CloudBeaver_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [CloudBeaver sur GKE Autopilot](CloudBeaver_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [CloudBeaver Common — Configuration applicative partagée](CloudBeaver_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Django sur Cloud Run](Django_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md) et [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md) dans la solution **Custom Application Starter**.
