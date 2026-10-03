---
title: "Fider sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Fider sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Fider_CloudRun.md @ 15fd4c7 sha256:fabec4b55b84 -->

# Fider sur Google Cloud Run {#fider-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Fider_CloudRun.png" alt="Fider sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Fider est un tableau de feedback et de vote de fonctionnalités open-source et auto-hébergé — les clients
publient des idées, votent et commentent, et vous priorisez en fonction de la demande. Ce module déploie
Fider sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Fider utilise et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Fider s'exécute comme un conteneur Go unique sur Cloud Run v2. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 2 vCPU / 4 GiB par défaut, autoscaling sans serveur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Fider ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Stockage de fichiers | Aucun par défaut | Fider stocke les pièces jointes sous forme de blobs dans PostgreSQL ; le montage NFS optionnel (`enable_nfs`) est désactivé par défaut et inutilisé |
| Secrets | Secret Manager | `JWT_SECRET` auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; LB HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  d'application partagée (`database_type = POSTGRES_15`) ; la sélection de tout autre moteur
  entraîne un échec au démarrage.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager. Il signe
  tous les jetons d'authentification et de session (y compris les liens de connexion magiques envoyés par e-mail) et
  **ne doit jamais être renouvelé après le premier démarrage** — cela invaliderait toutes les sessions actives
  et les liens de connexion en attente.
- **Fider est un binaire Go unique sans worker en arrière-plan.** Tout l'état réside dans
  PostgreSQL, il n'y a donc pas de processus de file d'attente à maintenir actif. Le module livre
  `min_instance_count = 1` avec `cpu_always_allocated = true` pour un service constamment actif ;
  puisqu'il n'y a pas de travail en arrière-plan, la définition de `min_instance_count = 0`
  (mise à l'échelle à zéro) est sûre pour les données si vous préférez échanger un démarrage à froid contre un coût inférieur.
- **Pas de Redis.** Fider utilise une file d'attente et un cache basés sur PostgreSQL (`VALKEY_URL` vide),
  donc `enable_redis` est par défaut à `false`. Laissez-le désactivé
  sauf si vous externalisez délibérément vers Redis.
- **NFS est désactivé par défaut** (`enable_nfs = false`). Fider stocke les pièces jointes sous forme de
  blobs dans PostgreSQL (son comportement par défaut), et ce module ne le bascule jamais en
  mode système de fichiers, donc un partage NFS ne recevrait rien.
- **Le conteneur écoute sur le port 3000.** Le point d'entrée exporte `PORT = 3000` ;
  Cloud Run injecte également automatiquement `PORT = <container_port>`.
- **Les migrations de schéma s'exécutent au démarrage.** Le point d'entrée personnalisé exécute `./fider migrate`
  avant de démarrer le serveur, de sorte que la mise à niveau de la version applique les modifications de schéma sans
  étape séparée.
- **L'e-mail est désactivé pour la démo.** Des valeurs SMTP de remplacement permettent à l'application de démarrer ;
  les liens d'inscription / d'invitation sont imprimés dans le journal du conteneur jusqu'à ce qu'un véritable SMTP soit configuré via
  `environment_variables`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Fider {#a-cloud-run--the-fider-service}

Fider s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~fider"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Fider stocke toutes les données d'application (publications, votes, commentaires, utilisateurs, paramètres) dans une
instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte en privé via le
**Cloud SQL Auth Proxy** via un socket Unix ; aucune IP publique n'est exposée. Lors du premier
déploiement, le job `db-init` crée le rôle et la base de données de l'application et accorde
les privilèges ; Fider exécute ensuite ses propres migrations au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `storage`) est provisionné automatiquement.
Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

NFS est **désactivé par défaut** (`enable_nfs = false`) : Fider conserve les pièces jointes sous forme de blobs
dans PostgreSQL, il n'a donc pas besoin de système de fichiers partagé. Si vous l'activez quand même, la VM de serveur NFS partagée (gérée par `Services_GCP`) doit être `RUNNING` avant le déploiement de l'application,
et le partage reste vide à moins que vous ne basculiez également Fider vers le stockage de blobs par système de fichiers.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount path injected into the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Fider n'utilise **pas** Redis — ne vous attendez pas à un point de terminaison Memorystore ou Redis.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`JWT_SECRET` (signe les jetons d'authentification et de session). Le mot de passe de la base de données est
géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~fider"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent
être superposés ; les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité. Définissez un `BASE_URL` personnalisé
via `environment_variables` lors de la diffusion depuis un domaine personnalisé.

> **Utilisez l'URL du projet numérique, pas `status.url`.** Chaque service Cloud Run est
> accessible à deux noms d'hôte également valides : une forme de projet numérique
> (`https://<service>-<project-number>.<region>.run.app`) et une forme de suffixe aléatoire
> (`https://<service>-<random8>-<regioncode>.a.run.app`, ce que `gcloud run services
> describe --format='value(status.url)'` rapporte). L'en-tête Content-Security-Policy
> de Fider est limité au nom d'hôte contre lequel il a été démarré — normalement la
> forme de projet numérique — donc un navigateur atterrissant sur le suffixe aléatoire `status.url` voit
> chaque requête d'actif (CSS, JS) bloquée par la CSP et affiche une page complètement vide.
> Partagez/visitez toujours la forme de projet numérique.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud
Monitoring, avec des vérifications de disponibilité et des stratégies d'alerte optionnelles. Notez que lorsque l'e-mail est
désactivé, les liens d'inscription / d'invitation apparaissent dans les journaux.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Fider {#3-fider-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le Cloud SQL Auth Proxy et crée de manière idempotente
  le rôle et la base de données `fider`, accorde les privilèges et réaffecte la propriété du
  schéma `public` au rôle de l'application. Le job peut être réexécuté en toute sécurité.
- **Migrations de schéma au démarrage.** Le point d'entrée personnalisé exécute `./fider migrate` avant
  de lancer le serveur (le `CMD` de l'image est remplacé par `./fider` uniquement). Les migrations
  sont idempotentes, de sorte que la mise à niveau de la version de l'application applique les modifications de schéma au
  prochain démarrage sans étape de migration séparée.
- **`JWT_SECRET` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager. Le modifier invalide toutes les sessions utilisateur actives et tous les liens de connexion
  envoyés par e-mail en attente. Ne le faites pivoter que pendant une fenêtre de maintenance planifiée.
- **Configuration initiale.** Il n'y a pas d'identifiants par défaut. La première visite à l'URL
  du service guide un opérateur dans la création du site et de son propriétaire administrateur. Effectuez
  cette opération immédiatement après le déploiement — utilisez l'URL du **projet numérique**, pas la
  forme de suffixe aléatoire `status.url` (voir l'avertissement CSP/page blanche sous
  [Réseau et ingress](#f-networking--ingress)) :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(metadata.annotations."run.googleapis.com/urls")'
  ```
- **L'e-mail est désactivé par défaut.** Des valeurs SMTP de remplacement permettent à Fider de démarrer avec
  `EMAIL_NOEMAIL = true` ; les liens d'inscription et d'invitation sont imprimés dans le journal du conteneur.
  Pour envoyer de vrais e-mails, définissez les variables SMTP de Fider (`EMAIL_SMTP_HOST`, `EMAIL_SMTP_PORT`,
  `EMAIL_SMTP_USERNAME`, `EMAIL_SMTP_PASSWORD`, `EMAIL_NOREPLY`) via
  `environment_variables` et supprimez `EMAIL_NOEMAIL`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/_health` — un point de terminaison non authentifié
  renvoyant `200`. Prévoyez environ 7 minutes au premier démarrage (la sonde de démarrage par défaut
  fournit un délai initial de 30 secondes plus une fenêtre de nouvelle tentative de 30 échecs avec une période de 15 secondes).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour Fider sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `fider` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Fider` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image Fider (`getfider/fider:<tag>`), mappé à l'ARG de build `FIDER_VERSION`. `latest` est épinglé à `stable` (il n'y a pas de tag `:latest`) ; épinglez à un tag SHA spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro. Fider n'a pas de worker en arrière-plan, donc l'inactivité à zéro est sûre pour les données ; définissez `1` si vous voulez une base de référence chaude et que vous accepterez le coût permanent. |
| `max_instance_count` | `5` | Plafond de coût ; doit être ≥ `min_instance_count`. |
| `cpu_always_allocated` | `false` | Facturation par instance pour un service constamment actif ; il est sûr de définir `false` pour la facturation basée sur les requêtes puisque Fider n'effectue aucun travail en arrière-plan. |
| `container_port` | `3000` | Fider écoute sur le port 3000 ; Cloud Run injecte automatiquement `PORT`. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Fider dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public ; requis pour atteindre le site depuis les navigateurs. |
| `enable_iap` | `false` | Exiger la connexion Google devant Fider. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Connectez un vrai SMTP (`EMAIL_SMTP_*`, `EMAIL_NOREPLY`) ou un `BASE_URL` personnalisé ici. Ne définissez pas `DATABASE_URL`, `JWT_SECRET` ou `PORT`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS définis dans `storage_buckets`. |
| `enable_nfs` | `false` | Laisser désactivé — Fider stocke les pièces jointes dans PostgreSQL, pas sur un système de fichiers. |
| `nfs_mount_path` | `/opt/fider/storage` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Fider nécessite PostgreSQL. |
| `db_name` | `fider` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `fider` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/_health`, délai de 30s | Prévoir environ 7 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/_health`, période de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring optionnelle. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Fider est basé sur Postgres ; laisser désactivé sauf si externalisation vers Redis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Pertinent uniquement si Redis est activé. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `JWT_SECRET` (auto-généré) | Ne jamais renouveler après le premier démarrage | Critique | Le renouveler invalide toutes les sessions actives et les liens de connexion envoyés par e-mail en attente. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommer recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Tout moteur non PostgreSQL entraîne un échec au démarrage — Fider est uniquement PostgreSQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans source de sauvegarde valide fait échouer le job d'importation. |
| `container_port` | `3000` | Élevé | Un port non concordant fait que les sondes atteignent un port mort et la révision ne devient jamais prête. |
| `application_version` | épingler un tag SHA ; `latest` → `stable` | Élevé | `getfider/fider` n'a pas de tag `:latest` ; le module épingle `latest` à `stable`, mais épinglez explicitement pour des mises à niveau reproductibles. |
| `memory_limit` | `4Gi` (par défaut) | Moyen | Un sous-dimensionnement risque un OOM sous charge ; Fider lui-même est léger. |
| `enable_nfs` | `false` (par défaut) | Moyen | Fider stocke les pièces jointes dans PostgreSQL, donc l'activation de NFS ajoute une dépendance de démarrage à la VM NFS partagée (qui doit être `RUNNING`) et ne stocke rien. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` (par défaut) | Faible | Fider n'a pas de worker en arrière-plan — `0` / `false` est sûr pour les données et moins cher, au prix de démarrages à froid. |
| SMTP (`EMAIL_SMTP_*`) | Configurer pour un vrai courrier | Moyen | Laissés comme espaces réservés, les liens d'inscription / d'invitation n'apparaissent que dans les journaux — aucun e-mail n'est envoyé. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris la navigation anonyme sur le tableau. |
| Quelle URL Cloud Run visiter | forme de projet numérique, pas `status.url` | Élevé | La CSP de Fider est limitée au nom d'hôte du projet numérique ; la visite de la forme de suffixe aléatoire `status.url` fait que chaque actif est bloqué par le navigateur, affichant une page blanche. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Fider partagée
avec la variante GKE est décrite dans **[Fider_Common](Fider_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Fider sur Cloud Run](../labs/Fider_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Fider sur GKE Autopilot](Fider_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Fider Common — Configuration d'application partagée](Fider_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [FreeScout sur Google Cloud Run](FreeScout_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Customer Support Desk**.
