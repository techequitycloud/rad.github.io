---
title: "PhpMyAdmin sur Google Cloud Run"
description: "Référence de configuration pour déployer PhpMyAdmin sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PhpMyAdmin_CloudRun.md @ 3055034 sha256:636063d8fd04 -->

# PhpMyAdmin sur Google Cloud Run {#phpmyadmin-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhpMyAdmin_CloudRun.png" alt="PhpMyAdmin sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

phpMyAdmin est l'outil web open source (GPLv2) le plus populaire pour administrer des
bases de données MySQL et MariaDB depuis le navigateur — parcourir et modifier des
tables, exécuter du SQL, gérer les utilisateurs et importer/exporter des données. Ce
module déploie phpMyAdmin sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud
partagée.

Ce guide se concentre sur les services cloud qu'utilise phpMyAdmin et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls et cycle de vie du
déploiement — reportez-vous au [guide du socle App_CloudRun](App_CloudRun.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

phpMyAdmin s'exécute comme un conteneur **PHP + Apache sans état** sur Cloud Run v2.
C'est l'un des déploiements les plus légers de ce dépôt — il n'assemble que les
services dont il a réellement besoin :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 512 MiB par défaut, mise à l'échelle automatique serverless ; mise à zéro |
| Base de données | **Aucune provisionnée** | phpMyAdmin n'a pas de base de données propre ; il se connecte à un serveur MySQL/MariaDB *externe* que vous lui indiquez |
| Stockage objet | **Aucun** | Sans état — aucun bucket GCS n'est créé |
| Cache | Redis (facultatif, désactivé) | Uniquement pour la limitation de débit/détection de bots sur les déploiements publics ; non requis |
| Secrets | **Aucun généré** | phpMyAdmin ne détient aucun secret ; les utilisateurs se connectent avec les identifiants propres du serveur MySQL cible |
| Image de conteneur | Artifact Registry | Build personnalisé minimal `FROM phpmyadmin/phpmyadmin`, dupliqué et épinglé par tag |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée pour phpMyAdmin.** `database_type = "NONE"`
  est fixé par la couche applicative partagée. phpMyAdmin est un *client* — il
  administre un serveur MySQL situé ailleurs (l'IP privée Cloud SQL de la plateforme,
  une autre instance Cloud SQL ou tout hôte MySQL/MariaDB joignable). Rien ici ne crée
  ce serveur.
- **La cible MySQL est choisie par des variables d'environnement, pas par du code.**
  `PMA_ARBITRARY = "1"` (la valeur par défaut) affiche un champ de saisie du serveur
  sur la page de connexion afin que les utilisateurs saisissent n'importe quel hôte.
  Définissez `pma_host` (et `PMA_ARBITRARY = "0"`) pour épingler un seul serveur.
- **Aucun secret n'est généré.** Il n'y a ni clé de chiffrement, ni secret JWT, ni mot
  de passe applicatif à protéger — et donc rien qui puisse se corrompre lors d'un
  redéploiement. L'authentification s'effectue avec les comptes propres de la *base de
  données cible* (authentification par cookie).
- **La mise à zéro est activée** (`min_instance_count = 0`, imposé par le module).
  phpMyAdmin est une console d'administration interactive sans travail en
  arrière-plan ; il ne devrait donc rien coûter au repos. Les démarrages à froid
  ajoutent quelques secondes à la première requête après une période d'inactivité.
- **Facturation à la requête** (`cpu_always_allocated = false`). phpMyAdmin n'effectue
  aucun travail en arrière-plan dans le processus ; le CPU n'est donc facturé que
  pendant le traitement d'une requête.
- **Entrée publique par défaut** (`ingress_settings = "all"`). phpMyAdmin étant un
  puissant outil d'administration de bases de données, envisagez sérieusement de le
  placer derrière **IAP** ou de restreindre l'entrée avant de l'exposer à Internet.
- **NFS et Redis sont désactivés par défaut.** phpMyAdmin ne conserve aucun état ;
  n'activez Redis que pour la protection contre les abus sur un déploiement public.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service phpMyAdmin {#a-cloud-run--the-phpmyadmin-service}

phpMyAdmin s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre le nombre minimal (0) et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements progressifs sûrs. Le conteneur écoute
sur le **port 80**.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~phpmyadmin"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  # Confirm the MySQL-target env vars injected into the running revision:
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Le serveur MySQL/MariaDB cible (externe) {#b-the-target-mysqlmariadb-server-external}

phpMyAdmin ne provisionne **pas** de base de données — il se connecte à une base que
vous possédez déjà. Cette cible est choisie via `pma_host` / `pma_port` (fixe) ou
`PMA_ARBITRARY = "1"` (l'utilisateur saisit l'hôte à la connexion). Une pratique
courante consiste à pointer phpMyAdmin vers l'IP privée Cloud SQL partagée de la
plateforme :

- **Console :** SQL → sélectionnez l'instance pour trouver son **IP privée** et son nom
  de connexion.
- **CLI :**
  ```bash
  # Find a MySQL instance's private IP to use as pma_host:
  gcloud sql instances list --project "$PROJECT" \
    --filter="databaseVersion~MYSQL"
  gcloud sql instances describe <instance-name> --project "$PROJECT" \
    --format='value(ipAddresses[0].ipAddress)'
  ```

Pour que phpMyAdmin atteigne un serveur MySQL à IP privée, le service doit disposer
d'une sortie VPC vers le VPC partagé (assurée par le socle lorsque
`vpc_egress_setting` achemine les plages privées). Les utilisateurs s'authentifient
sur la page de connexion de phpMyAdmin avec les comptes MySQL propres à cette base.

### C. Cloud Storage {#c-cloud-storage}

**Non utilisé.** phpMyAdmin est sans état et ne déclare aucun bucket GCS. (L'import et
l'export dans l'interface de phpMyAdmin transitent par le navigateur, pas par GCS.)

### D. Redis (protection facultative contre les abus) {#d-redis-optional-abuse-protection}

Redis est **désactivé par défaut** (`enable_redis = false`). Il n'est utile que si vous
activez la limitation de débit/détection de bots de phpMyAdmin sur un déploiement
public. Désactivé, phpMyAdmin fonctionne pleinement — Redis n'est pas requis pour un
fonctionnement normal.

- **CLI (uniquement s'il est activé) :**
  ```bash
  redis-cli -h <redis-host> ping
  ```

### E. Secret Manager {#e-secret-manager}

**Ce module ne génère aucun secret.** phpMyAdmin ne détient ni clé de chiffrement, ni
secret JWT, ni mot de passe applicatif — la connexion s'effectue avec les identifiants
propres du serveur MySQL cible, saisis sur la page de connexion de phpMyAdmin et jamais
stockés. Vous pouvez néanmoins ajouter vos propres `secret_environment_variables` (par
exemple pour injecter un `PMA_PASSWORD`/`PMA_USER` fixe pour une cible en
authentification unique), que le socle monte depuis Secret Manager.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~phpmyadmin"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le détail de l'injection des secrets.

### F. Réseau et entrée {#f-networking--ingress}

Le service est joignable par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud
Armor peut être ajouté ; IAP peut conditionner l'accès à une connexion Google —
vivement recommandé pour un outil d'administration de bases de données.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur Apache/PHP sont envoyés vers Cloud Logging ; les métriques
Cloud Run vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PhpMyAdmin {#3-phpmyadmin-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni job
  `db-init` ni schéma à créer — phpMyAdmin n'a pas de base de données propre. Le
  service est prêt dès qu'Apache/PHP démarre.
- **Ni migrations, ni clés immuables.** phpMyAdmin ne stocke rien entre les
  redémarrages ; il n'y a donc aucun schéma à migrer et aucune clé cryptographique qui
  puisse se corrompre lors d'un redéploiement. Redéployer ou changer la version de
  l'image présente peu de risques.
- **Connexion sans état, par cookie.** Les utilisateurs se connectent sur la page de
  phpMyAdmin avec le **nom d'utilisateur et le mot de passe propres au serveur MySQL
  cible** ; la session réside dans un cookie de courte durée. phpMyAdmin ne conserve
  jamais ces identifiants. Il n'y a pas de « compte administrateur » phpMyAdmin à créer
  après le déploiement.
- **Choix de la cible MySQL.** Vérifiez les variables d'environnement `PMA_*` injectées
  dans la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```
  Avec `PMA_ARBITRARY = "1"`, la page de connexion affiche un champ serveur ; avec un
  `pma_host` fixe, les utilisateurs ne voient que le nom d'utilisateur et le mot de
  passe pour ce seul serveur.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  `/` — Apache y sert la page de connexion avec un `200` dès que PHP est prêt. Le
  premier démarrage est rapide (quelques secondes) ; aucune longue fenêtre de migration
  n'est nécessaire.
- **Posture de sécurité.** phpMyAdmin expose l'administration complète des bases de
  données à quiconque peut l'atteindre *et* détient des identifiants MySQL valides. Le
  service étant public par défaut, protégez-le par IAP ou par un équilibreur de charge
  HTTPS + Cloud Armor, et restreignez `PMA_ARBITRARY` à `"0"` avec un `pma_host` fixe si
  les utilisateurs ne doivent atteindre qu'un seul serveur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à phpMyAdmin ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 3 — Identité de l'application et cible MySQL {#group-3--application-identity--mysql-target}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `phpmyadmin` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image phpMyAdmin ; `latest` se résout en la version épinglée `5.2.2`. Épinglez-la explicitement en production. |
| `pma_arbitrary` | `"1"` | `"1"` affiche un champ de saisie du serveur (les utilisateurs saisissent n'importe quel hôte) ; `"0"` restreint à `pma_host`. |
| `pma_host` | `""` | Hôte MySQL/MariaDB fixe (injecté en tant que `PMA_HOST`). Laissez vide en mode arbitraire ; indiquez une IP privée Cloud SQL pour épingler un serveur. |
| `pma_port` | `"3306"` | Port MySQL cible (injecté en tant que `PMA_PORT`). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Image de conteneur et exécution {#group-4--container-image--runtime}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | phpMyAdmin est livré sous forme de build personnalisé minimal (`FROM phpmyadmin/phpmyadmin`) ; conservez `custom`. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `cpu_limit` | `1000m` | CPU par instance ; phpMyAdmin est léger. |
| `memory_limit` | `512Mi` | Mémoire par instance (le plancher gen2 est de 512 MiB). |
| `cpu_always_allocated` | `false` | Facturation à la requête — aucun travail en arrière-plan à maintenir actif. |
| `min_instance_count` | `0` | Imposé à `0` par le module (mise à zéro). |
| `max_instance_count` | `3` | Plafond de coût / limite de concurrence. |
| `execution_environment` | `gen2` | gen2 recommandé. |
| `container_protocol` | `http1` | phpMyAdmin sert en HTTP/1.1. |
| `enable_image_mirroring` | `true` | Met en miroir l'image phpMyAdmin dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut. Envisagez `internal-and-cloud-load-balancing` ou IAP pour un outil d'administration de bases de données. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Nécessaire pour atteindre un serveur MySQL à IP privée. |
| `enable_iap` | `false` | Exige une connexion Google — **vivement recommandé** pour phpMyAdmin. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | phpMyAdmin est sans état — aucun bucket n'est créé, sauf si vous activez ce paramètre et ajoutez des `storage_buckets`. |
| `enable_nfs` | `false` | phpMyAdmin est sans état — NFS n'est pas requis. |
| `gcs_volumes` | `[]` | Inutile pour phpMyAdmin. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — phpMyAdmin n'a pas de base de données propre. Ne définissez pas de moteur. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` | La page de connexion renvoie `200` dès que PHP est prêt. |
| `liveness_probe` | HTTP `/` | Sonde de vivacité. |
| `uptime_check_config` | _(défini)_ | Test de disponibilité Cloud Monitoring (uniquement s'il est joignable publiquement). |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Limitation de débit/détection de bots facultative pour les déploiements publics ; non requis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis s'il est activé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL des services par étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (s'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour phpMyAdmin). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État du monitoring, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour phpMyAdmin). |
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

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un runtime `gen1` avec des montages NFS/GCS, un `redis_port` hors limites, un `min_instance_count` supérieur à `max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `ingress_settings` / `enable_iap` | Restreindre ou protéger par IAP | Critique | phpMyAdmin offre l'administration complète des bases de données ; le laisser public sans IAP expose chaque serveur MySQL joignable au bourrage d'identifiants et aux attaques par force brute. |
| `pma_host` + `PMA_ARBITRARY = "0"` | Épingler un serveur pour un accès circonscrit | Élevé | Avec `PMA_ARBITRARY = "1"`, les utilisateurs peuvent cibler *n'importe quel* hôte MySQL joignable, ce qui élargit le rayon d'impact d'une session compromise. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Élevé | Sans sortie VPC vers les plages privées, phpMyAdmin ne peut pas atteindre un serveur Cloud SQL à IP privée — la page de connexion ne se connecte à rien. |
| `database_type` | `NONE` (fixe) | Moyen | Définir un moteur provisionne une instance Cloud SQL inutilisée et engendre un coût superflu ; la variante GKE le bloque au moment du plan, Cloud Run gaspille simplement la ressource. |
| `application_version` | Épingler explicitement (par ex. `5.2.2`) | Moyen | `latest` se résout aujourd'hui en la version épinglée `5.2.2` ; épinglez-la en production afin qu'un changement de tag en amont ne modifie jamais l'image à votre insu. |
| `memory_limit` | `512Mi` | Faible | En dessous du plancher gen2 de 512 MiB, le plan est rejeté ; phpMyAdmin n'a guère besoin de plus. |
| `min_instance_count` | `0` (par défaut) | Faible | La mise à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après une période d'inactivité — acceptable pour un outil interactif. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à phpMyAdmin,
partagée avec la variante GKE, est décrite dans
**[PhpMyAdmin_Common](PhpMyAdmin_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhpMyAdmin sur Cloud Run](../labs/PhpMyAdmin_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PhpMyAdmin sur GKE Autopilot](PhpMyAdmin_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [PhpMyAdmin Common — Configuration applicative partagée](PhpMyAdmin_Common.md) — la configuration partagée par les deux cibles de déploiement.
