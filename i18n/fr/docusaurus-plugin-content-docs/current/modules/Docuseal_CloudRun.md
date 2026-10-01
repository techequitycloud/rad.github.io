---
title: "Docuseal sur Google Cloud Run"
description: "Référence de configuration pour déployer Docuseal sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Docuseal_CloudRun.md @ 3055034 sha256:18649515d250 -->

# Docuseal sur Google Cloud Run {#docuseal-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docuseal_CloudRun.png" alt="Docuseal sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DocuSeal est une plateforme open source de signature de documents — une alternative
auto-hébergée à DocuSign pour créer, remplir et signer des documents PDF, avec un
générateur de formulaires visuel, des modèles réutilisables et des pistes d'audit.
Ce module déploie DocuSeal sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise DocuSeal et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

DocuSeal s'exécute comme un conteneur Ruby on Rails (Puma) unique sur Cloud Run v2.
Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — DocuSeal ne prend pas en charge MySQL ni d'autres moteurs |
| Documents persistants | Filestore / NFS | `enable_nfs = true` ; les documents téléversés résident dans `/data/docuseal` |
| Stockage objet | Cloud Storage | Un bucket provisionné automatiquement (ce n'est pas le stockage de documents par défaut) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` généré automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **DocuSeal se connecte en TCP sur IP privée, et non via le socket Cloud SQL.** Le
  parseur d'URI de Ruby ne sait pas analyser le DSN de socket Unix de Cloud SQL ;
  `enable_cloudsql_volume` vaut donc `false` par défaut et le point d'entrée compose
  une `DATABASE_URL` pointant vers l'IP privée de l'instance avec `sslmode=require`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il
  ne doit jamais faire l'objet d'une rotation après le premier démarrage — cela
  invaliderait tous les cookies de session signés et déconnecterait tous les
  utilisateurs.
- **Les documents téléversés résident sur NFS, pas dans le conteneur.**
  `enable_nfs = true` monte le volume NFS partagé sur `/data/docuseal` ; sans lui,
  chaque document téléversé est perdu à la révision ou au démarrage à froid suivant.
- **Une instance est maintenue active par défaut** (`min_instance_count = 1`,
  `cpu_always_allocated = true`). DocuSeal est une application requête/réponse dont
  les documents résident sur un NFS durable ; elle peut donc sans risque être mise à
  zéro — définissez `min_instance_count = 0` pour échanger la latence de la première
  requête contre une réduction des coûts.
- **Pas de Redis.** DocuSeal utilise une file d'attente / un cache adossés à
  PostgreSQL ; aucun Redis n'est donc requis ni câblé (`enable_redis = false`).
- **Entrée publique par défaut.** `ingress_settings = "all"` afin que l'interface de
  signature et tous les liens de signataires / d'API soient accessibles. Activer IAP
  place une barrière de connexion Google devant ces liens.
- **Les migrations s'exécutent au démarrage.** DocuSeal applique ses propres
  migrations ActiveRecord à chaque démarrage ; le seul job d'initialisation crée le
  rôle et la base de données PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service DocuSeal {#a-cloud-run--the-docuseal-service}

DocuSeal s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~docuseal"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

DocuSeal stocke toutes les données applicatives (modèles, soumissions, signataires,
utilisateurs, piste d'audit) dans une instance gérée Cloud SQL for PostgreSQL 15.
Comme Ruby ne sait pas analyser le DSN de socket Cloud SQL, le service se connecte
via l'**IP privée** de l'instance avec `sslmode=require` (le `DB_IP` injecté par le
socle), joignable via la sortie VPC ; aucune IP publique n'est exposée. Lors du
premier déploiement, un Job d'initialisation crée la base de données et le rôle de
l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore / NFS — documents persistants {#c-filestore--nfs--persistent-documents}

DocuSeal écrit les documents téléversés et les pièces jointes sur le système de
fichiers local, dans `/data/docuseal`. `enable_nfs = true` y monte le volume NFS
partagé (de type Filestore) afin que les documents survivent aux révisions et aux
démarrages à froid.

- **Console :** Filestore → Instances (ou Compute Engine pour la VM NFS autogérée,
  selon la configuration de la plateforme).
- **CLI :**
  ```bash
  # Confirm the NFS mount and WORKDIR on the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='yaml(spec.template.spec.volumes, spec.template.spec.containers[0].volumeMounts)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour savoir comment le serveur NFS partagé
est découvert et monté.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe de nom `storage`) est provisionné
automatiquement et le compte de service de la charge de travail y reçoit l'accès. Le
stockage de documents de DocuSeal utilise par défaut le volume NFS ci-dessus ; ce
bucket est donc disponible pour un usage auxiliaire plutôt que comme stockage
principal des documents.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`SECRET_KEY_BASE` (utilisé par Rails pour signer les cookies de session et d'autres
valeurs signées). Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docuseal"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut via son URL `run.app`, ce qui permet l'accès
public nécessaire aux liens de signataires et à l'interface de signature. Un
équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté par-dessus ; les paramètres d'entrée et la sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur (Rails journalise sur stdout) sont envoyés vers Cloud
Logging ; les métriques Cloud Run et Cloud SQL sont envoyées vers Cloud Monitoring,
avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Docuseal {#3-docuseal-application-behaviour}

- **Configuration de la base au premier déploiement.** Un Job d'initialisation
  exécute `db-init.sh` avec `postgres:15-alpine`. Il crée de manière idempotente le
  rôle et la base de données `docuseal`, accorde tous les privilèges et réattribue la
  propriété du schéma `public` au rôle de l'application (PostgreSQL 15 n'accorde plus
  `CREATE` sur `public` par défaut). Le job peut être relancé sans risque.
- **Migrations au démarrage.** DocuSeal exécute automatiquement ses propres
  migrations ActiveRecord à chaque démarrage sous le rôle de l'application ; la mise à
  niveau de la version de l'application applique donc les changements de schéma sans
  étape de migration distincte.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager. Le faire tourner invalide tous les cookies
  de session signés, obligeant chaque utilisateur à se reconnecter. Ne le faites
  tourner que pendant une fenêtre de maintenance planifiée.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `/up` — le point de terminaison de santé intégré de Rails, qui renvoie un
  `200` non authentifié dès que l'application est prête. La sonde de démarrage par
  défaut prévoit un délai initial de 60 secondes et une large fenêtre de nouvelles
  tentatives pour les migrations du premier démarrage.
- **Configuration au premier lancement.** DocuSeal n'a pas d'identifiants par défaut.
  Lors du premier accès, ouvrez l'URL du service et remplissez l'écran de
  configuration pour créer le compte administrateur initial (e-mail + mot de passe)
  avant d'inviter d'autres utilisateurs ou de créer des modèles.
- **Documents persistants.** Les documents téléversés résident dans `/data/docuseal`
  sur le volume NFS. Vérifiez la connexion injectée et le répertoire de travail sur
  la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à DocuSeal ou notables pour lui sont
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
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docuseal` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DocuSeal (`FROM docuseal/docuseal:<tag>`) ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance (2 vCPU). |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `1` | Instances maintenues actives. DocuSeal tolère `0` (mise à zéro), puisque les documents résident sur NFS. |
| `max_instance_count` | `5` | Nombre maximal d'instances. |
| `container_port` | `3000` | Puma écoute sur 3000. Ne le modifiez pas. |
| `cpu_always_allocated` | `true` | **Incohérence entre la valeur par défaut et la description :** la description de la variable indique qu'elle est « Defaulted FALSE for DocuSeal: it is a request/response Rails app with no background scheduler or queue worker … so request-based billing … is cheaper with no functional loss », mais la valeur par défaut codée est `true` (facturation à l'instance). DocuSeal n'a effectivement aucun worker, beat ou planificateur intégré au processus (voir [§3](#3-docuseal-application-behaviour)) ; les opérateurs qui veulent le comportement décrit, moins coûteux, doivent donc définir explicitement `cpu_always_allocated = false`. |
| `container_resources` | `null` | Surcharge structurée du CPU / de la mémoire ; lorsqu'elle est définie, elle remplace `cpu_limit`/`memory_limit`. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages NFS (et impose un plancher de mémoire de 512 MiB). |
| `timeout_seconds` | `300` | Durée maximale d'une requête (0–3600 secondes). |
| `enable_image_mirroring` | `true` | Met en miroir l'image DocuSeal dans Artifact Registry. |
| `container_image_source` | `custom` | Enveloppe légère construite à partir de `docuseal/docuseal`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés dans le conteneur. Les valeurs essentielles (`RAILS_LOG_TO_STDOUT`, `WORKDIR`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte le volume NFS partagé sur `/data/docuseal` pour des documents persistants. **Laissez-le activé**, sinon les fichiers téléversés sont perdus au redéploiement. |
| `nfs_mount_path` | `/data/docuseal` | Chemin de montage — doit correspondre au `WORKDIR` de DocuSeal. |
| `create_cloud_storage` | `true` | Crée le ou les buckets GCS déclarés. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse facultatifs (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `docuseal` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `docuseal` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `enable_cloudsql_volume` | `false` | **Laissez `false`** — Ruby ne sait pas analyser le DSN de socket Cloud SQL ; DocuSeal utilise le TCP sur IP privée avec `sslmode=require`. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` (crée le rôle + la base de données). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai de 60 s | Sonde de démarrage. Prévoyez le temps nécessaire aux migrations du premier démarrage. |
| `liveness_probe` | HTTP `/up`, délai de 60 s | Sonde de vivacité sur le point de terminaison de santé de Rails. |
| `uptime_check_config` | désactivé, chemin `/` | Test de disponibilité Cloud Monitoring (points de terminaison publics uniquement) ; définissez `enabled = true` pour le provisionner. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | DocuSeal utilise une file d'attente / un cache adossés à PostgreSQL ; laissez-le désactivé. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison / port de la base. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un réplica en lecture sans son instance principale, IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critical | Une rotation invalide tous les cookies de session signés — chaque utilisateur est déconnecté. |
| `enable_nfs` | `true` | Critical | Le désactiver stocke les documents sur le disque éphémère du conteneur ; chaque document téléversé est perdu à la révision ou au démarrage à froid suivant. |
| `nfs_mount_path` | `/data/docuseal` | Critical | Doit correspondre au `WORKDIR` de DocuSeal ; un chemin différent signifie que les documents sont écrits sur un stockage non persistant. |
| `db_name` / `db_user` | À définir une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base / l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `false` | High | Ruby ne sait pas analyser le DSN de socket Cloud SQL ; activer le sidecar de socket casse la `DATABASE_URL` et le démarrage échoue. |
| `container_port` | `3000` | High | Puma écoute sur 3000 ; un port différent fait viser un port mort aux sondes et la révision ne devient jamais Ready. |
| `execution_environment` | `gen2` | High | Gen1 ne peut pas monter NFS ; l'application perd le stockage persistant des documents. |
| `enable_iap` | uniquement pour un usage interne | High | IAP place chaque requête derrière une connexion Google, ce qui bloque les liens publics des signataires. |
| `memory_limit` | `4Gi` | Medium | Le rendu et la signature des PDF sont gourmands en mémoire ; trop réduire expose à des arrêts OOM en charge. |
| `min_instance_count` | `1` (ou `0` pour réduire les coûts) | Medium | La mise à zéro ajoute un délai de démarrage à froid à la première requête après une période d'inactivité ; les documents sur NFS sont en sécurité dans les deux cas. |
| `application_version` | À épingler en production | Medium | `latest` peut récupérer une nouvelle version majeure au redéploiement et appliquer des migrations que vous n'avez pas examinées. |
| `cpu_always_allocated` | `false` (à la requête) | Medium | La valeur par défaut codée est `true` (facturation à l'instance), ce que la propre description de la variable juge inutile pour la charge de travail requête/réponse de DocuSeal — la laisser par défaut revient à payer du CPU inactif sans aucun bénéfice fonctionnel. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à DocuSeal partagée avec la variante GKE est décrite dans
**[Docuseal_Common](Docuseal_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Docuseal sur Cloud Run](../labs/Docuseal_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docuseal sur GKE Autopilot](Docuseal_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Docuseal Common — Configuration applicative partagée](Docuseal_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md) dans la solution **Small Business Suite**.
