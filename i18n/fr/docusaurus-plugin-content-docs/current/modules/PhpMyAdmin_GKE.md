---
title: "PhpMyAdmin sur GKE Autopilot"
description: "Référence de configuration pour déployer PhpMyAdmin sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PhpMyAdmin_GKE.md @ 3055034 sha256:60f59f7f17ee -->

# PhpMyAdmin sur GKE Autopilot {#phpmyadmin-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PhpMyAdmin_GKE.png" alt="PhpMyAdmin sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

phpMyAdmin est l'outil web open source (GPLv2) le plus populaire pour administrer des
bases de données MySQL et MariaDB depuis le navigateur — parcourir et modifier des
tables, exécuter du SQL, gérer les utilisateurs et importer/exporter des données. Ce
module déploie phpMyAdmin sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise phpMyAdmin et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

phpMyAdmin s'exécute comme une charge de travail web **PHP + Apache sans état** sur
GKE Autopilot. C'est l'un des déploiements les plus légers de ce dépôt — il n'assemble
que les services dont il a réellement besoin :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache, mise à l'échelle automatique ; facturation du CPU et de la mémoire demandés |
| Base de données | **Aucune provisionnée** | phpMyAdmin n'a pas de base de données propre ; il se connecte à un serveur MySQL/MariaDB *externe* que vous lui indiquez |
| Stockage objet | **Aucun** | Sans état — aucun bucket GCS n'est créé |
| Cache | Redis (facultatif, désactivé) | Uniquement pour la limitation de débit/détection de bots sur les déploiements publics ; non requis |
| Secrets | **Aucun généré** | phpMyAdmin ne détient aucun secret ; les utilisateurs se connectent avec les identifiants propres du serveur MySQL cible |
| Image de conteneur | Artifact Registry | Build personnalisé minimal `FROM phpmyadmin/phpmyadmin`, dupliqué et épinglé par tag |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée pour phpMyAdmin.** `database_type = "NONE"`
  est fixé et imposé par un garde-fou de validation au moment du plan. phpMyAdmin est un
  *client* — il administre un serveur MySQL situé ailleurs (l'IP privée Cloud SQL de la
  plateforme, une autre instance Cloud SQL ou tout hôte MySQL/MariaDB joignable). Rien
  ici ne crée ce serveur.
- **La cible MySQL est choisie par des variables d'environnement, pas par du code.**
  `PMA_ARBITRARY = "1"` (la valeur par défaut) affiche un champ de saisie du serveur
  sur la page de connexion afin que les utilisateurs saisissent n'importe quel hôte.
  Définissez `pma_host` (et `PMA_ARBITRARY = "0"`) pour épingler un seul serveur.
- **Aucun secret n'est généré.** Il n'y a ni clé de chiffrement, ni secret JWT, ni mot
  de passe applicatif à protéger. L'authentification s'effectue avec les comptes
  propres de la *base de données cible* (authentification par cookie).
- **Deployment sans état, au moins 1 réplica.** `workload_type` vaut par défaut un
  `Deployment` (pas un StatefulSet — il n'y a pas d'état par pod) et GKE maintient au
  moins un réplica en cours d'exécution (pas de mise à zéro) afin que la console soit
  toujours joignable.
- **Exposé via un LoadBalancer externe** (`service_type = "LoadBalancer"`). phpMyAdmin
  étant un puissant outil d'administration de bases de données, envisagez sérieusement
  de le placer derrière **IAP** (via un Ingress) ou de restreindre le LoadBalancer avant
  de l'exposer à Internet.
- **NFS et Redis sont désactivés par défaut.** phpMyAdmin ne conserve aucun état ;
  n'activez Redis que pour la protection contre les abus sur un déploiement public.
- **Le conteneur écoute sur le port 80** (Apache `apache2-foreground`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail phpMyAdmin {#a-gke-autopilot--the-phpmyadmin-workload}

Les pods phpMyAdmin sont planifiés sur Autopilot, qui facture le CPU et la mémoire
demandés par les pods. L'autoscaling horizontal des pods dimensionne le Deployment
entre le nombre minimal et maximal de réplicas. Le conteneur écoute sur le
**port 80**.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail phpMyAdmin pour voir les pods et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # Confirm the MySQL-target env vars injected into the running pod:
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep PMA_
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

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
  gcloud sql instances list --project "$PROJECT" --filter="databaseVersion~MYSQL"
  gcloud sql instances describe <instance-name> --project "$PROJECT" \
    --format='value(ipAddresses[0].ipAddress)'
  ```

Les pods atteignent directement un serveur MySQL à IP privée via le réseau VPC du
cluster (aucun sidecar Auth Proxy n'est nécessaire — `enable_cloudsql_volume` vaut
`false` pour phpMyAdmin, car il n'utilise pas l'intégration Cloud SQL propre à la
plateforme). Les utilisateurs s'authentifient sur la page de connexion de phpMyAdmin
avec les comptes MySQL propres à cette base.

### C. Cloud Storage {#c-cloud-storage}

**Non utilisé.** phpMyAdmin est sans état et ne déclare aucun bucket GCS. L'import et
l'export dans l'interface de phpMyAdmin transitent par le navigateur, pas par GCS.

### D. Redis (protection facultative contre les abus) {#d-redis-optional-abuse-protection}

Redis est **désactivé par défaut** (`enable_redis = false`). Il n'est utile que si vous
activez la limitation de débit/détection de bots de phpMyAdmin sur un déploiement
public. Désactivé, phpMyAdmin fonctionne pleinement — Redis n'est pas requis pour un
fonctionnement normal.

- **CLI (uniquement s'il est activé) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep REDIS
  ```

### E. Secret Manager {#e-secret-manager}

**Ce module ne génère aucun secret.** phpMyAdmin ne détient ni clé de chiffrement, ni
secret JWT, ni mot de passe applicatif — la connexion s'effectue avec les identifiants
propres du serveur MySQL cible, saisis sur la page de connexion de phpMyAdmin et jamais
stockés. Vous pouvez néanmoins ajouter vos propres `secret_environment_variables`, que
le socle matérialise via l'intégration Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~phpmyadmin"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = "LoadBalancer"`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique peut être réservée afin que l'adresse
survive aux redéploiements. IAP (via un Ingress) peut conditionner l'accès à une
connexion Google — vivement recommandé pour un outil d'administration de bases de
données.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour le détail des domaines personnalisés, de Cloud
CDN et des IP statiques.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE
vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs
sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application PhpMyAdmin {#3-phpmyadmin-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a ni job
  `db-init` ni schéma à créer — phpMyAdmin n'a pas de base de données propre. Le pod
  est prêt dès qu'Apache/PHP démarre.
- **Ni migrations, ni clés immuables.** phpMyAdmin ne stocke rien entre les
  redémarrages ; il n'y a donc aucun schéma à migrer et aucune clé cryptographique qui
  puisse se corrompre lors d'un redéploiement. Les mises à jour progressives et les
  montées de version présentent peu de risques.
- **Deployment sans état.** `workload_type` se résout en un `Deployment` et
  `stateful_pvc_enabled` est désactivé — il n'y a aucun état par pod à préserver. Une
  mise à jour progressive est sûre, car les pods ne partagent ni volume ni verrou.
- **Connexion par cookie.** Les utilisateurs se connectent sur la page de phpMyAdmin
  avec le **nom d'utilisateur et le mot de passe propres au serveur MySQL cible** ; la
  session réside dans un cookie de courte durée. phpMyAdmin ne conserve jamais ces
  identifiants, et il n'y a pas de « compte administrateur » phpMyAdmin à créer après
  le déploiement.
- **Choix de la cible MySQL.** Vérifiez les variables d'environnement `PMA_*` injectées
  dans le pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep PMA_
  ```
  Avec `PMA_ARBITRARY = "1"`, la page de connexion affiche un champ serveur ; avec un
  `pma_host` fixe, les utilisateurs ne voient que le nom d'utilisateur et le mot de
  passe pour ce seul serveur.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent
  `/` — Apache y sert la page de connexion avec un `200` dès que PHP est prêt. Le
  premier démarrage est rapide ; aucune longue fenêtre de migration n'est nécessaire.
- **Posture de sécurité.** phpMyAdmin expose l'administration complète des bases de
  données à quiconque peut atteindre le LoadBalancer *et* détient des identifiants
  MySQL valides. Protégez-le par IAP ou restreignez le Service, et définissez
  `PMA_ARBITRARY = "0"` avec un `pma_host` fixe si les utilisateurs ne doivent atteindre
  qu'un seul serveur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à phpMyAdmin ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 3 — Identité de l'application et cible MySQL {#group-3--application-identity--mysql-target}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `phpmyadmin` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image phpMyAdmin ; `latest` se résout en la version épinglée `5.2.2`. Épinglez-la explicitement en production. |
| `pma_arbitrary` | `"1"` | `"1"` affiche un champ de saisie du serveur (les utilisateurs saisissent n'importe quel hôte) ; `"0"` restreint à `pma_host`. |
| `pma_host` | `""` | Hôte MySQL/MariaDB fixe (injecté en tant que `PMA_HOST`). Laissez vide en mode arbitraire ; indiquez une IP privée Cloud SQL pour épingler un serveur. |
| `pma_port` | `"3306"` | Port MySQL cible (injecté en tant que `PMA_PORT`). |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 4 — Image de conteneur et exécution {#group-4--container-image--runtime}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `custom` | phpMyAdmin est livré sous forme de build personnalisé minimal (`FROM phpmyadmin/phpmyadmin`) ; conservez `custom`. |
| `container_port` | `80` | Apache écoute sur le port 80. **Codé en dur** — l'output de configuration de `PhpMyAdmin_Common` fixe `container_port = 80` sans qu'aucune entrée `container_port` ne soit transmise depuis cette variable ; définir une autre valeur dans `deploy.tfvars` n'a donc aucun effet sur la charge de travail déployée. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE n'a pas de mise à zéro, conservez ≥ 1 afin que la console soit joignable. **Codé en dur** — `phpmyadmin.tf` fusionne `min_instance_count = 1` directement dans la configuration applicative que déploie `App_GKE` (`local.selected_module.min_instance_count`, et non la variable de premier niveau `var.min_instance_count`) ; cette entrée est donc insensible aux surcharges de l'utilisateur. |
| `max_instance_count` | `3` | Nombre maximal de réplicas. |
| `enable_cloudsql_volume` | `false` | phpMyAdmin n'utilise pas l'intégration Cloud SQL de la plateforme ; il se connecte directement à un hôte MySQL externe. |
| `enable_image_mirroring` | `true` | Met en miroir l'image phpMyAdmin dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. `PMA_HOST` / `PMA_PORT` / `PMA_ARBITRARY` sont définis à partir des entrées du groupe 3. |
| `secret_environment_variables` | `{}` | Facultatif — phpMyAdmin ne génère aucun secret propre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | LoadBalancer externe par défaut. Envisagez `ClusterIP` derrière un Ingress protégé par IAP pour un outil d'administration de bases de données. |
| `workload_type` | `null` → `Deployment` | Deployment sans état ; aucun StatefulSet n'est nécessaire. |
| `session_affinity` | `None` | Non requis — phpMyAdmin ne détient aucun état de session par pod au-delà du cookie du navigateur. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe et imposé par un garde-fou de validation au moment du plan. phpMyAdmin n'a pas de base de données propre. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | phpMyAdmin est sans état — NFS n'est pas requis. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Limitation de débit/détection de bots facultative pour les déploiements publics ; non requis. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Point de terminaison Redis s'il est activé. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre phpMyAdmin. |
| `storage_buckets` | Buckets Cloud Storage créés (vide pour phpMyAdmin). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour phpMyAdmin). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md) et à un garde-fou local au module (`validation.tf`), qui valident les valeurs *et leurs combinaisons* au moment du plan — un `database_type` autre que `NONE`, IAP sans identifiants OAuth, un `min_instance_count` supérieur à `max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `service_type` / `enable_iap` | Restreindre ou protéger par IAP | Critical | phpMyAdmin offre l'administration complète des bases de données ; un LoadBalancer externe non authentifié expose chaque serveur MySQL joignable au bourrage d'identifiants et aux attaques par force brute. |
| `pma_host` + `PMA_ARBITRARY = "0"` | Épingler un serveur pour un accès circonscrit | High | Avec `PMA_ARBITRARY = "1"`, les utilisateurs peuvent cibler *n'importe quel* hôte MySQL joignable, ce qui élargit le rayon d'impact d'une session compromise. |
| `database_type` | `NONE` (fixe) | High | Toute autre valeur fait échouer le garde-fou de validation du module au moment du plan — sinon, elle provisionnerait une instance Cloud SQL inutilisée et engendrerait un coût. |
| `min_instance_count` | `1` | High | GKE exige min ≥ 1 ; le garde-fou de validation rejette `min > max`. Conserver 1 garantit que la console est toujours joignable. |
| `enable_iap` sans identifiants OAuth | Fournir `iap_oauth_client_id`/`_secret` | High | Activer IAP sans identifiants le désactive silencieusement, exposant phpMyAdmin sans authentification — bloqué par un garde-fou au moment du plan. |
| `application_version` | Épingler explicitement (par ex. `5.2.2`) | Medium | `latest` se résout aujourd'hui en la version épinglée `5.2.2` ; épinglez-la en production afin qu'un changement de tag en amont ne modifie jamais l'image à votre insu. |
| `enable_cloudsql_volume` | `false` | Low | phpMyAdmin se connecte directement à un hôte MySQL externe et n'utilise pas l'intégration Cloud SQL de la plateforme ; le laisser désactivé est correct. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization et VPC-SC — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à phpMyAdmin, partagée avec la variante Cloud Run, est décrite dans
**[PhpMyAdmin_Common](PhpMyAdmin_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PhpMyAdmin sur GKE Autopilot](../labs/PhpMyAdmin_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PhpMyAdmin sur Google Cloud Run](PhpMyAdmin_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [PhpMyAdmin Common — Configuration applicative partagée](PhpMyAdmin_Common.md) — la configuration partagée par les deux cibles de déploiement.
