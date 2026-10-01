---
title: "Netdata sur Google Cloud Run"
description: "Référence de configuration pour déployer Netdata sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Netdata_CloudRun.md @ 3055034 sha256:229a0529ab75 -->

# Netdata sur Google Cloud Run {#netdata-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netdata_CloudRun.png" alt="Netdata sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Netdata est un agent open source de supervision en temps réel de l'infrastructure et
des applications, qui collecte des milliers de métriques par seconde et sert des
tableaux de bord d'une granularité d'une seconde ainsi qu'une API REST. Ce module
déploie Netdata sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Netdata et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Netdata s'exécute dans un seul conteneur sur Cloud Run v2, à l'écoute sur le port
**19999**. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur unique, 1 vCPU / 1 GiB par défaut ; écoute sur le port 19999 |
| Base de données | _Aucune_ | Netdata n'a pas de base de données SQL — les métriques sont stockées sur disque sous `/var/lib/netdata` |
| Stockage d'objets | Cloud Storage | Un bucket de données, monté comme volume **GCS FUSE** sur `/var/lib/netdata` |
| Cache et file d'attente | _Aucun_ | Netdata n'utilise pas Redis (`enable_redis` est forcé à `false`) |
| Secrets | Secret Manager | `NETDATA_ADMIN_PASSWORD` de 32 caractères, généré par défaut (`enable_admin_password = true`) |
| Entrée | URL Cloud Run / Cloud Load Balancing | **`all` par défaut** — public ; une garde au moment du plan exige `enable_admin_password = true` en association |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données.** Netdata est un agent autonome ; il n'y a ni instance
  Cloud SQL, ni job `db-init`, ni migration de schéma. `database_type = NONE`.
- **L'entrée est `all` (publique) par défaut, associée à un identifiant de mot de passe
  administrateur généré.** Le tableau de bord de Netdata ne possède pas
  d'authentification intégrée ; une garde au moment du plan **rejette donc
  `ingress_settings = "all"` sauf si `enable_admin_password =
  true`** — les deux ont
  ces valeurs par défaut ensemble, de sorte qu'un nouveau déploiement passe le plan
  d'emblée.
- **Le tableau de bord n'est pas authentifié, quelle que soit la valeur de
  `enable_admin_password`.** Cet indicateur (activé par défaut) génère seulement un
  `NETDATA_ADMIN_PASSWORD` stocké dans Secret Manager pour une couche d'authentification
  côté opérateur (reverse proxy / rattachement à Netdata Cloud) — il n'ajoute pas, à
  lui seul, de page de connexion au tableau de bord brut. Restreignez
  `ingress_settings` à `internal` ou placez le service derrière `enable_iap` si le
  tableau de bord exposé et non authentifié pose problème.
- **Une seule instance par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Chaque instance Netdata détient sa propre base de métriques locale ; elle ne
  s'étend donc pas horizontalement vers un stockage partagé — conservez une seule
  instance.
- **Les métriques persistent dans un bucket GCS FUSE.** `/var/lib/netdata` s'appuie
  sur un bucket Cloud Storage (`enable_gcs_storage_volume = true`), de sorte que la
  base de métriques survit aux redémarrages et aux événements de mise à l'échelle.
  Cela exige l'environnement d'exécution **gen2**.
- **Pas de Redis.** `enable_redis` est explicitement désactivé ; Netdata n'a besoin
  d'aucun cache ni d'aucune file d'attente.
- **Le chemin de santé est `/api/v1/info`.** Les sondes de démarrage et de vivacité
  interrogent ce point de terminaison, qui renvoie un corps JSON `200` une fois l'agent
  initialisé.
- **L'image est épinglée à une version via `NETDATA_VERSION`.**
  `application_version = "latest"` est résolu en `v2.2.6` au moment du build plutôt
  qu'en un wrapper `latest` inexistant.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Netdata {#a-cloud-run--the-netdata-service}

Netdata s'exécute en tant que service Cloud Run v2 à l'écoute sur le port 19999.
Chaque déploiement crée une révision immuable ; comme Netdata conserve ses métriques
dans une base unique locale/adossée à GCS, il est normalement exécuté sur une seule
instance plutôt qu'avec mise à l'échelle automatique.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~netdata"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the injected listener port / admin password env:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — persistance des métriques {#b-cloud-storage--metrics-persistence}

Un bucket **Cloud Storage** dédié est provisionné et monté comme volume **GCS FUSE**
sur `/var/lib/netdata`, où Netdata conserve sa base de métriques, son journal
d'alarmes et son état de santé. L'historique de supervision persiste ainsi d'un
redémarrage de révision et d'un redéploiement à l'autre. GCS FUSE exige
l'environnement d'exécution gen2.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~netdata"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### C. Secret Manager {#c-secret-manager}

Par défaut (`enable_admin_password = true`), un unique secret de 32 caractères
(`secret-<prefix>-netdata-admin-password`) est généré et injecté en tant que
`NETDATA_ADMIN_PASSWORD`. Aucun autre secret applicatif n'est créé (il n'y a pas de
mot de passe de base de données puisqu'il n'y a pas de base de données).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~netdata-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, le service utilise `ingress_settings = "all"` (public) associé à
`enable_admin_password = true` — la garde de validation du module exige l'indicateur
de mot de passe dès que l'entrée vaut `all`, et les deux ont ces valeurs par défaut
ensemble. Le tableau de bord lui-même n'a de toute façon pas de connexion intégrée ;
pour un déploiement réellement verrouillé, définissez `ingress_settings = "internal"`
(VPC uniquement) ou placez le service public derrière `enable_iap` / un équilibreur de
charge HTTPS externe + une authentification basique. L'output `netdata_url` indique
l'URL du service (port 19999).

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec un test de disponibilité facultatif (ciblant
`/api/v1/info`) et des règles d'alerte.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Netdata {#3-netdata-application-behaviour}

- **Aucune initialisation de base de données.** Il n'y a ni job `db-init` ni migration
  de schéma. L'agent écrit sa base de métriques round-robin directement dans
  `/var/lib/netdata` (le volume GCS FUSE) au premier démarrage.
- **Persistance des métriques.** L'historique de supervision ne survit aux
  redémarrages que parce que `/var/lib/netdata` s'appuie sur le bucket Cloud Storage.
  Si vous désactivez `enable_gcs_storage_volume` (ou si le bucket est vide), chaque
  nouvelle révision démarre avec une base de métriques vierge.
- **Tableau de bord non authentifié.** Le tableau de bord local et l'API REST de
  Netdata sur le port 19999 n'ont pas de connexion intégrée, même si
  `ingress_settings = "all"` et `enable_admin_password = true` sont tous deux les
  valeurs par défaut du module. Définissez `ingress_settings = "internal"` ou placez
  un proxy d'authentification en amont si le tableau de bord exposé publiquement et
  non authentifié pose problème. `enable_admin_password` fournit un identifiant stable
  pour ce proxy / pour le flux de rattachement à Netdata Cloud — il ne verrouille pas
  à lui seul le tableau de bord brut.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  **`/api/v1/info`**, qui renvoie un corps JSON `200` une fois l'agent initialisé.
  Vérifiez-le :
  ```bash
  # from within the VPC (or after port-forwarding / LB):
  curl -s "$NETDATA_URL/api/v1/info" | head
  ```
- **Fonctionnement sur une seule instance.** Comme chaque instance possède sa propre
  base de métriques locale, conservez `min_instance_count = max_instance_count = 1`.
  Une extension horizontale produit des agents indépendants et non fédérés, et non un
  tableau de bord partagé.
- **Netdata Cloud (facultatif).** Pour centraliser plusieurs agents, rattachez cette
  instance à Netdata Cloud après le déploiement (via un jeton de rattachement / des
  variables d'environnement de rooms) — une étape opérateur, non provisionnée par le
  module.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Netdata ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `netdata` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Netdata ; `latest` est résolu en `v2.2.6` au moment du build. Épinglez un tag précis en production. |
| `enable_admin_password` | `true` | Génère un `NETDATA_ADMIN_PASSWORD` de 32 caractères dans Secret Manager. **Doit valoir `true` dès que `ingress_settings = "all"`** (l'association par défaut du module). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmentez-la si vous supervisez de nombreuses collections. |
| `min_instance_count` | `1` | Conservez 1 — Netdata détient une base de métriques locale par instance. |
| `max_instance_count` | `1` | Conservez 1 ; une extension horizontale produit des agents indépendants et non fédérés. |
| `container_port` | `19999` | Port d'écoute de Netdata (tableau de bord + API REST). |
| `enable_cloudsql_volume` | `false` | Pas de Cloud SQL — Netdata n'a pas de base de données. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut, associé à `enable_admin_password = true` (une garde au moment du plan exige cette association). Définissez `internal` pour un accès limité au VPC, car le tableau de bord lui-même n'a pas de connexion intégrée, quel que soit l'indicateur de mot de passe. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Connexion Google devant un équilibreur de charge externe — la méthode recommandée pour exposer Netdata publiquement. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket de données GCS (le montage FUSE `/var/lib/netdata`). |
| `storage_buckets` | `[]` | Buckets supplémentaires en plus du bucket de données provisionné automatiquement. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires (exige gen2). Le montage `/var/lib/netdata` est ajouté automatiquement. |
| `enable_nfs` | `false` | Désactivé par défaut ; Netdata n'a pas besoin de NFS. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Netdata_Common — Netdata n'a pas de base de données SQL. Non référencé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info`, délai de 15s, 10 tentatives | Sonde de démarrage ; `/api/v1/info` renvoie un JSON 200 lorsque l'agent est prêt. |
| `liveness_probe` | HTTP `/api/v1/info`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/api/v1/info` | Test de disponibilité Cloud Monitoring facultatif (ne se déclenche que si le point de terminaison est accessible publiquement). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Outputs {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `netdata_url` | URL du service pour le tableau de bord/l'API Netdata (port 19999) — accessible publiquement par défaut (`ingress_settings = "all"`) ; limitée au VPC si `ingress_settings = "internal"`. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket de données `/var/lib/netdata`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la supervision, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs de configuration (vide par défaut — Netdata n'en a aucun). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. En outre, `Netdata_CloudRun` ajoute ses propres gardes : `min_instance_count ≤ max_instance_count`, et `ingress_settings = "all"` est rejeté sauf si `enable_admin_password = true`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ingress_settings` + `enable_admin_password` | `all` + `enable_admin_password = true` par défaut ; utilisez `internal` pour un déploiement réellement verrouillé | Critical | Le tableau de bord/l'API REST n'a pas de connexion intégrée, quelle que soit la valeur de `enable_admin_password` — l'entrée `all` par défaut expose publiquement l'ensemble des métriques de l'hôte, sauf si le service est placé derrière `enable_iap` ou une autre couche d'authentification. La garde du plan ne bloque `all` que *sans* identifiant de mot de passe ; elle ne sécurise pas à elle seule le tableau de bord. |
| `enable_gcs_storage_volume` (Common) / bucket de données | Conservez le montage GCS FUSE activé | High | Sans le bucket `/var/lib/netdata`, chaque révision démarre avec une base de métriques vide — tout l'historique est perdu au redémarrage. |
| `max_instance_count` | `1` | High | Dépasser 1 crée des agents indépendants avec des bases de métriques locales distinctes, et non un tableau de bord partagé — des données confuses et non fédérées. |
| `application_name` | À définir une seule fois | High | Immuable après le premier déploiement ; le renommer recrée le service, le secret et le bucket. |
| `container_port` | `19999` | High | Netdata n'écoute que sur 19999 ; changer le port sans changer `NETDATA_LISTENER_PORT` casse la sonde de démarrage. |
| `execution_environment` | `gen2` | High | GCS FUSE pour `/var/lib/netdata` exige gen2 ; gen1 ne peut pas le monter. |
| `enable_iap` | À activer en cas d'exposition externe | High | Un équilibreur de charge externe sans IAP (ou autre couche d'authentification) laisse le tableau de bord non authentifié accessible. |
| `memory_limit` | `1Gi` (à augmenter pour de nombreuses collections) | Medium | Une mémoire sous-dimensionnée peut provoquer un OOM de l'agent lors de la supervision d'un grand nombre de graphiques. |
| `application_version` | Épinglez un tag en production | Medium | `latest` suit `v2.2.6` au moment du build ; épinglez-le pour maîtriser les mises à niveau. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Netdata, partagée avec la variante GKE, est décrite dans
**[Netdata_Common](Netdata_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Netdata sur Cloud Run](../labs/Netdata_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Netdata sur GKE Autopilot](Netdata_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Netdata Common — Configuration applicative partagée](Netdata_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Beszel sur Google Cloud Run](Beszel_CloudRun.md) dans la solution **Monitoring & NOC**.
