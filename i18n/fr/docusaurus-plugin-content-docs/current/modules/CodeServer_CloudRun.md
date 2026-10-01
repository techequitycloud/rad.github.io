---
title: "code-server sur Google Cloud Run"
description: "Référence de configuration pour déployer code-server sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/CodeServer_CloudRun.md @ 3055034 sha256:4776afde0c0c -->

# code-server sur Google Cloud Run {#code-server-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_CloudRun.png" alt="code-server sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server est la version open source (MIT) de Visual Studio Code proposée par Coder,
qui s'exécute sur un serveur distant et s'utilise entièrement depuis le navigateur —
un IDE complet avec la place de marché des extensions VS Code, un terminal intégré et
des serveurs de langage, adossé à un espace de travail persistant. Ce module déploie
code-server sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise code-server et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

code-server s'exécute comme un unique conteneur autonome sur Cloud Run v2.
Contrairement aux applications adossées à une base de données, il assemble un
ensemble volontairement minimal de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Un seul conteneur à l'écoute sur le port **8080** ; 1 vCPU / 1 GiB par défaut |
| Espace de travail persistant | Cloud Storage (GCS FUSE) | Bucket de l'espace de travail monté sur `/home/coder` ; provisionné automatiquement |
| Base de données | _Aucune_ | `database_type = NONE` — code-server n'a pas de base SQL |
| Cache et file d'attente | _Aucun_ | Redis est explicitement désactivé (`enable_redis = false`) |
| Secrets | Secret Manager | `PASSWORD` de l'éditeur généré automatiquement (lorsque `enable_password = true`) |
| Entrée | URL Cloud Run / Cloud Load Balancing | **L'entrée par défaut est `all`** — accessible publiquement par défaut ; le `PASSWORD` généré automatiquement protège la page de connexion |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données ni de Redis.** code-server est un conteneur unique ; tout
  l'état réside dans le volume de l'espace de travail. `database_type` est fixé à
  `NONE` par la couche applicative partagée et Redis est désactivé.
- **L'entrée est `all` (publique) par défaut.** Le service est accessible depuis
  l'internet public dès l'installation, protégé par le `PASSWORD` généré
  automatiquement. Conservez `enable_password = true` dès que
  `ingress_settings = "all"`, ou passez à `ingress_settings = "internal"` pour
  restreindre l'accès au VPC.
- **Un `PASSWORD` d'éditeur aléatoire est généré automatiquement** et stocké dans
  Secret Manager. Il protège la page de connexion. Désactiver `enable_password` sert
  l'éditeur sans aucune authentification — ce n'est sûr que derrière une entrée
  `internal`.
- **L'espace de travail est sur GCS FUSE à `/home/coder`.** Les paramètres, les
  extensions et les projets ouverts y sont conservés. Nécessite l'environnement
  d'exécution `gen2` (la valeur par défaut).
- **Instance unique par conception.** `min_instance_count = max_instance_count = 1`.
  code-server conserve en mémoire l'état des sessions de l'éditeur et possède un seul
  volume d'espace de travail ; dépasser une instance scinderait les sessions et
  exposerait à des écritures concurrentes sur le même volume.
- **Les sondes de santé interrogent `/healthz`, et non `/health`.** `/healthz` n'est
  pas authentifié et renvoie `200` dès que le serveur écoute ; `/health` renvoie
  `401` lorsqu'un mot de passe est défini et ferait échouer la sonde.
- **L'image est une fine surcouche de `codercom/code-server`**, construite et
  répliquée dans Artifact Registry via Cloud Build ; `latest` est épinglé à `4.99.1`
  au moment du build.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service code-server {#a-cloud-run--the-code-server-service}

code-server s'exécute comme un service Cloud Run v2 à l'écoute sur le port 8080.
Chaque déploiement crée une révision immuable ; l'application étant à instance unique
et stateful, conservez `min = max = 1` et évitez de répartir le trafic entre des
révisions simultanées.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~codeserver"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le volume de l'espace de travail {#b-cloud-storage--the-workspace-volume}

La seule ressource stateful. Un bucket **Cloud Storage** dédié est provisionné
automatiquement et monté comme volume **GCS FUSE** sur `/home/coder` ; il contient
l'espace de travail de l'utilisateur, les paramètres VS Code et les extensions
installées. Il survit aux redéploiements de révisions et aux événements de mise à
l'échelle.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  ```

GCS FUSE nécessite l'environnement d'exécution `gen2` (la valeur par défaut).
Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK.

### C. Secret Manager — le mot de passe de l'éditeur {#c-secret-manager--the-editor-password}

Lorsque `enable_password = true` (valeur par défaut), un `PASSWORD` aléatoire de
24 caractères est généré et stocké dans Secret Manager, puis injecté comme variable
d'environnement `PASSWORD` du conteneur pour protéger la page de connexion. Il n'y a
pas de mot de passe de base de données (pas de base de données).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation
des secrets.

### D. Réseau et entrée {#d-networking--ingress}

Le service utilise par défaut une **entrée `all`** — accessible depuis l'internet
public, avec le `PASSWORD` généré automatiquement qui protège la page de connexion.
Pour restreindre l'accès au VPC, définissez `ingress_settings = "internal"`, ou
ajoutez un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et
Cloud Armor.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run sont
envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte
facultatifs. Un point de terminaison public est nécessaire pour qu'un test de
disponibilité puisse atteindre le service.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application code-server {#3-code-server-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** code-server n'a
  ni base SQL ni job d'initialisation. Le service est disponible dès que le conteneur
  démarre et se lie à `0.0.0.0:8080` (défini via `BIND_ADDR`).
- **Aucune migration.** Mettre à niveau `application_version` déploie simplement une
  nouvelle révision sur l'image plus récente ; il n'y a aucun schéma à migrer.
- **L'espace de travail est le seul état durable.** Tout ce qui se trouve sous
  `/home/coder` — dossiers ouverts, `settings.json`, raccourcis clavier et chaque
  extension installée — est conservé dans le bucket GCS FUSE. Supprimer le bucket
  efface l'espace de travail.
- **La connexion est protégée par le secret `PASSWORD`.** Avec
  `enable_password = true`, l'éditeur demande le mot de passe généré. Récupérez-le
  dans Secret Manager (§2C). S'il est désactivé, quiconque atteint l'URL obtient un
  IDE sans authentification — ne l'exécutez ainsi que derrière une entrée `internal`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent le point de
  terminaison non authentifié `/healthz` (qui renvoie `200` dès que le serveur HTTP
  écoute). Ne pointez **pas** les sondes vers `/health` lorsqu'un mot de passe est
  défini — il renvoie `401` et la révision ne devient jamais Ready. Vérifiez
  l'environnement et le port de la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Mise à l'échelle à instance unique.** Conservez `min = max = 1`. Les sessions de
  l'éditeur sont conservées en mémoire et le volume de l'espace de travail n'a qu'un
  seul écrivain.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à code-server ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `codeserver` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `code-server` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image code-server ; `latest` est épinglé à `4.99.1` au moment du build. Épinglez une version précise en production. |
| `enable_password` | `true` | Génère un `PASSWORD` d'éditeur aléatoire et l'exige à la connexion. **Laissez-le activé pour tout déploiement accessible publiquement.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez-le pour des serveurs de langage gourmands. |
| `memory_limit` | `1Gi` | Mémoire par instance ; dimensionnez-la selon les espaces de travail et les extensions que vous utilisez. |
| `min_instance_count` | `1` | Laissez à 1 — éditeur à instance unique ; évite les délais de démarrage à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | Laissez à 1 — un seul volume d'espace de travail, session en mémoire. |
| `container_port` | `8080` | code-server écoute sur le port 8080. |
| `execution_environment` | `gen2` | Requis pour GCS FUSE (montage de l'espace de travail) et NFS. |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | code-server n'a pas de Cloud SQL — laissez à false. |
| `enable_image_mirroring` | `true` | Met en miroir l'image code-server dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut (protégé par le secret `PASSWORD`). Définissez `internal` pour restreindre l'accès au VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google en amont de l'éditeur. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Personnes autorisées à accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par ex. `{ TZ = "UTC" }`). `BIND_ADDR` est défini automatiquement. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé par défaut ; l'espace de travail utilise GCS FUSE, et non NFS. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage si NFS est activé. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le bucket de l'espace de travail est ajouté automatiquement sur `/home/coder`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non utilisée — code-server n'a pas de base SQL ; fixée à `NONE` par CodeServer_Common. |
| `database_password_length` | `32` | Non utilisée — transmise au socle pour compatibilité. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, délai de 15 s | Sonde de démarrage ; utilise le point de terminaison non authentifié. |
| `liveness_probe` | HTTP `/healthz`, délai de 30 s | Sonde de vivacité ; utilise le point de terminaison non authentifié. |
| `health_check_config` | HTTP `/health` | Sonde structurée alternative (point de terminaison authentifié). |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring facultatif (nécessite un point de terminaison public). |
| `alert_policies` | `[]` | Règles d'alerte sur métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyés lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `codeserver_url` | URL de l'éditeur code-server (port 8080). Accessible uniquement depuis le VPC lorsque l'entrée est `internal`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un runtime `gen1` avec des montages GCS FUSE/NFS, IAP sans identité autorisée, un `timeout_seconds` hors limites, etc. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_password` | `true` (à conserver pour une entrée publique) | Critique | Le désactiver avec `ingress_settings = "all"` expose à internet un IDE entièrement non authentifié — terminal compris. |
| Bucket de l'espace de travail | Ne jamais le supprimer | Critique | Le bucket GCS FUSE sur `/home/coder` est le seul état persistant ; le supprimer efface tous les paramètres, extensions et fichiers. |
| Chemin de `startup_probe` / `liveness_probe` | `/healthz` | Élevé | Pointer les sondes vers `/health` alors qu'un mot de passe est défini renvoie `401` ; la révision ne devient jamais Ready. |
| `max_instance_count` | `1` | Élevé | Dépasser 1 répartit les sessions de l'éditeur entre instances et expose à des écritures concurrentes sur l'unique volume d'espace de travail. |
| `min_instance_count` | `1` | Moyen | La mise à zéro (`0`) ajoute une latence de démarrage à froid et remonte l'espace de travail à la requête suivante. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter GCS FUSE — le volume de l'espace de travail échoue et l'état est perdu au redémarrage. |
| `ingress_settings` | `all` + mot de passe (ou `internal`) | Élevé | `all` sans mot de passe publie un IDE ouvert ; `internal` bloque tout accès par navigateur depuis l'extérieur du VPC. |
| `enable_cloudsql_volume` | `false` | Faible | code-server n'a pas de base de données ; l'activer ajoute un sidecar Auth Proxy inutile. |
| `memory_limit` | `1Gi`+ | Moyen | Des serveurs de langage ou des extensions gourmands peuvent provoquer un OOM en dessous de 1 GiB. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à code-server
et partagée avec la variante GKE est décrite dans
**[CodeServer_Common](CodeServer_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : code-server sur Cloud Run](../labs/CodeServer_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [code-server sur GKE Autopilot](CodeServer_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [CodeServer Common — Configuration applicative partagée](CodeServer_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Coder sur Google Cloud Run](Coder_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Cloud Development Environments**.
