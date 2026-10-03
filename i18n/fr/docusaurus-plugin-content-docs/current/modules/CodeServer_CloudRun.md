---
title: "code-server sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de code-server sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/CodeServer_CloudRun.md @ 15fd4c7 sha256:f65c835f3856 -->

# code-server sur Google Cloud Run {#code-server-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/CodeServer_CloudRun.png" alt="code-server sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

code-server est la version open-source (MIT) de Visual Studio Code de Coder qui
s'exécute sur un serveur distant et est entièrement accessible via le navigateur — un
IDE complet avec la place de marché des extensions VS Code, un terminal intégré et
des serveurs de langage, le tout soutenu par un espace de travail persistant. Ce
module déploie code-server sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud que code-server utilise et sur la
manière de les explorer et de les exploiter à partir de la console Google Cloud et
de la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

code-server s'exécute comme un conteneur autonome unique sur Cloud Run v2. Contrairement
aux applications basées sur une base de données, il relie un ensemble délibérément
minimal de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur unique écoutant sur le port **8080** ; 1 vCPU / 1 GiB par défaut |
| Espace de travail persistant | Cloud Filestore (NFS) | `/home/coder` est sur le partage NFS par défaut ; le bucket de l'espace de travail y est monté via GCS FUSE uniquement si NFS est désactivé |
| Base de données | _Aucune_ | `database_type = NONE` — code-server n'a pas de base de données SQL |
| Cache et file d'attente | _Aucun_ | Redis est explicitement désactivé (`enable_redis = false`) |
| Secrets | Secret Manager | `PASSWORD` de l'éditeur auto-généré (lorsque `enable_password = true`) |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | **L'entrée par défaut est `all`** — accessible publiquement par défaut ; le `PASSWORD` auto-généré protège la page de connexion |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données et pas de Redis.** code-server est un conteneur unique ;
  tout l'état réside dans le volume de l'espace de travail. `database_type` est fixé à
  `NONE` par la couche d'application partagée et Redis est désactivé.
- **L'entrée est `all` (publique) par défaut.** Le service est accessible depuis
  l'internet public dès sa sortie de l'emballage, protégé par le `PASSWORD`
  auto-généré. Conservez `enable_password = true` chaque fois que `ingress_settings = "all"`, ou passez à
  `ingress_settings = "internal"` pour restreindre l'accès au VPC.
- **Un `PASSWORD` d'éditeur aléatoire est généré automatiquement** et stocké dans
  Secret Manager. Il protège la page de connexion. La désactivation de `enable_password`
  sert l'éditeur sans authentification — uniquement en toute sécurité derrière
  l'entrée `internal`.
- **L'espace de travail est sur NFS à `/home/coder`.** Les paramètres, les extensions
  et les projets ouverts y persistent. Conservez `enable_nfs = true` : sur le repli GCS FUSE,
  l'installation d'une extension échoue, car GCS FUSE ne peut pas renommer un
  répertoire. Nécessite l'environnement d'exécution `gen2` (par défaut).
- **Instance unique par conception.** `min_instance_count = max_instance_count = 1`. code-server conserve l'état de
  l'éditeur par session en mémoire et possède un volume d'espace de travail ; la
  mise à l'échelle au-delà d'une instance diviserait les sessions et risquerait
  des écritures concurrentes sur le même volume.
- **Les sondes de santé atteignent `/healthz`, pas `/health`.** `/healthz` n'est pas
  authentifié et renvoie `200` une fois que le serveur écoute ; `/health` renvoie
  `401` lorsqu'un mot de passe est défini et ferait échouer la sonde.
- **L'image est un mince wrapper sur `codercom/code-server`**, construite et mise en miroir dans
  Artifact Registry via Cloud Build ; `latest` se fixe à `4.99.1` au moment de la
  construction.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service code-server {#a-cloud-run--the-code-server-service}

code-server s'exécute comme un service Cloud Run v2 écoutant sur le port 8080. Chaque
déploiement crée une révision immuable ; comme l'application est à instance unique
et avec état, conservez `min = max = 1` et évitez le fractionnement du trafic entre les
révisions concurrentes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~codeserver"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et le fractionnement du trafic.

### B. Cloud Storage — le volume de l'espace de travail {#b-cloud-storage--the-workspace-volume}

Le seul emplacement avec état est `/home/coder` — l'espace de travail de l'utilisateur,
les paramètres VS Code et les extensions installées. Par défaut, il s'agit du chemin
de montage NFS, qui survit aux redéploiements de révision et aux événements de mise
à l'échelle. Un bucket **Cloud Storage** dédié est également provisionné ; il est
monté comme un volume **GCS FUSE** à `/home/coder` uniquement lorsque `enable_nfs = false`, où les
installations d'extensions échouent.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~codeserver"
  gcloud storage ls gs://<workspace-bucket>/          # bucket name is in the Outputs
  ```

NFS et GCS FUSE nécessitent tous deux l'environnement d'exécution `gen2` (par
défaut). Voir [App_CloudRun](App_CloudRun.md) pour les options GCS FUSE et CMEK.

### C. Secret Manager — le mot de passe de l'éditeur {#c-secret-manager--the-editor-password}

Lorsque `enable_password = true` (par défaut), un `PASSWORD` aléatoire de 24 caractères est généré et
stocké dans Secret Manager, puis injecté comme variable d'environnement `PASSWORD` du
conteneur pour protéger la page de connexion. Il n'y a pas de mot de passe de base
de données (pas de base de données).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~codeserver AND name~password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation des secrets.

### D. Réseau et entrée {#d-networking--ingress}

Le service utilise par défaut **l'entrée `all`** — accessible depuis l'internet
public, avec le `PASSWORD` auto-généré protégeant la page de connexion. Pour
restreindre l'accès au VPC, définissez `ingress_settings = "internal"`, ou superposez un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run
sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des
stratégies d'alerte facultatifs. Un point de terminaison public est requis pour
qu'un test de disponibilité atteigne le service.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application code-server {#3-code-server-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** code-server
  n'a pas de base de données SQL et pas de job d'initialisation. Le service démarre
  dès que le conteneur démarre et se lie à `0.0.0.0:8080` (défini via `BIND_ADDR`).
- **Pas de migrations.** La mise à niveau de `application_version` déploie simplement une nouvelle
  révision sur la nouvelle image ; il n'y a pas de schéma à migrer.
- **L'espace de travail est le seul état durable.** Tout ce qui se trouve sous
  `/home/coder` — dossiers ouverts, `settings.json`, raccourcis clavier et chaque extension
  installée — persiste sur le partage NFS. Le supprimer efface l'espace de travail.
- **La connexion est protégée par le secret `PASSWORD`.** Avec `enable_password = true`, l'éditeur
  demande le mot de passe généré. Récupérez-le depuis Secret Manager (§2C). S'il
  est désactivé, toute personne atteignant l'URL obtient un IDE non authentifié —
  ne l'exécutez ainsi que derrière l'entrée `internal`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent le point de
  terminaison non authentifié `/healthz` (renvoie `200` une fois que le serveur HTTP
  écoute). Ne **pas** pointer les sondes vers `/health` lorsqu'un mot de passe est
  défini — il renvoie `401` et la révision ne devient jamais prête. Vérifiez
  l'environnement et le port de la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Mise à l'échelle à instance unique.** Conservez `min = max = 1`. Les sessions de
  l'éditeur sont conservées en mémoire et le volume de l'espace de travail a un
  seul rédacteur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres spécifiques ou notables pour code-server sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `codeserver` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `code-server` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image code-server ; `latest` se fixe à `4.99.1` au moment de la construction. Fixez-le à une version spécifique en production. |
| `enable_password` | `true` | Génère un `PASSWORD` d'éditeur aléatoire et le demande à la connexion. **Laissez activé pour tout déploiement accessible publiquement.** |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez pour les serveurs de langage lourds. |
| `memory_limit` | `1Gi` | Mémoire par instance ; dimensionnez en fonction des espaces de travail et des extensions que vous exécutez. |
| `min_instance_count` | `1` | Gardez à 1 — éditeur à instance unique ; évite les retards de démarrage à froid pendant le chargement de l'index. |
| `max_instance_count` | `1` | Gardez à 1 — un volume d'espace de travail, session en mémoire. |
| `container_port` | `8080` | code-server écoute sur le port 8080. |
| `execution_environment` | `gen2` | Requis pour GCS FUSE (montage de l'espace de travail) et NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | code-server n'a pas de Cloud SQL — gardez false. |
| `enable_image_mirroring` | `true` | Mettez en miroir l'image code-server dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut (protégé par le secret `PASSWORD`). Définissez `internal` pour restreindre l'accès au VPC. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant l'éditeur. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple `{ TZ = "UTC" }`). `BIND_ADDR` est défini automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Doit rester `true` sur Cloud Run : `/home/coder` contient les paramètres, les extensions et les projets, et l'installation d'une extension échoue sur GCS FUSE (il ne peut pas renommer un répertoire). |
| `nfs_mount_path` | `/home/coder` | Chemin de montage si NFS est activé. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires ; le bucket de l'espace de travail est ajouté automatiquement à `/home/coder` uniquement lorsque `enable_nfs = false`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non référencé — code-server n'a pas de base de données SQL ; fixé à `NONE` par CodeServer_Common. |
| `database_password_length` | `32` | Non référencé — transmis à la fondation pour compatibilité. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz` 15s de délai | Sonde de démarrage ; utilise le point de terminaison non authentifié. |
| `liveness_probe` | HTTP `/healthz` 30s de délai | Sonde de vivacité ; utilise le point de terminaison non authentifié. |
| `health_check_config` | HTTP `/health` | Sonde structurée alternative (point de terminaison authentifié). |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring facultatif (nécessite un point de terminaison public). |
| `alert_policies` | `[]` | Stratégies d'alerte métrique. |

### Groupe 23 — VPC Service Controls et Audit Logging {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `codeserver_url` | URL de l'éditeur code-server (port 8080). Accessible uniquement au sein du VPC lorsque l'entrée est `internal`. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket de l'espace de travail). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs d'initialisation fournis par l'utilisateur (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de l'audit logging et CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> environnement d'exécution `gen1` avec des montages GCS FUSE/NFS, IAP sans
> identités autorisées, un `timeout_seconds` hors de portée, et ainsi de suite. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs
> ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_password` | `true` (garder activé pour l'entrée publique) | Critique | La désactivation avec `ingress_settings = "all"` expose un IDE entièrement non authentifié — y compris un terminal — à Internet. |
| `enable_nfs` | `true` (par défaut) | Critique | Le partage NFS à `/home/coder` est le seul état persistant. La désactivation de NFS déplace l'espace de travail sur GCS FUSE, où les installations d'extensions échouent. |
| `startup_probe` / chemin `liveness_probe` | `/healthz` | Élevé | Pointer les sondes vers `/health` alors qu'un mot de passe est défini renvoie `401` ; la révision ne devient jamais prête. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 divise les sessions de l'éditeur entre les instances et risque des écritures concurrentes sur le volume d'espace de travail unique. |
| `min_instance_count` | `1` | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid et remonte l'espace de travail à la prochaine requête. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter NFS ou GCS FUSE — le volume de l'espace de travail échoue et l'état est perdu au redémarrage. |
| `ingress_settings` | `all` + mot de passe (ou `internal`) | Élevé | `all` sans mot de passe publie un IDE ouvert ; `internal` bloque tout accès au navigateur depuis l'extérieur du VPC. |
| `enable_cloudsql_volume` | `false` | Faible | code-server n'a pas de base de données ; l'activation ajoute un sidecar Auth Proxy inutilisé. |
| `memory_limit` | `1Gi`+ | Moyen | Les serveurs/extensions de langage lourds peuvent manquer de mémoire en dessous de 1 GiB. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à
code-server partagée avec la variante GKE est décrite dans
**[CodeServer_Common](CodeServer_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : code-server sur Cloud Run](../labs/CodeServer_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [code-server sur GKE Autopilot](CodeServer_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [CodeServer Common — Configuration d'application partagée](CodeServer_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Coder sur Google Cloud Run](Coder_CloudRun.md), [Gitea sur Google Cloud Run](Gitea_CloudRun.md), [Hoppscotch sur Google Cloud Run](Hoppscotch_CloudRun.md) dans la solution **Environnements de développement cloud**.
