---
title: "GoAlert sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de GoAlert sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/GoAlert_GKE.md @ 15fd4c7 sha256:cbcc985ae63f -->

# GoAlert sur GKE Autopilot {#goalert-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_GKE.png" alt="GoAlert sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert est une plateforme open source, sous licence Apache 2.0, de planification
d'astreintes et d'escalade d'alertes d'incidents, initialement conçue par Target
et exécutée en production à grande échelle. Elle permet aux équipes de définir
des politiques d'escalade, des rotations et des plannings d'astreinte, et
d'envoyer des notifications par e-mail, webhook ou (en option) Twilio SMS/voix.
Ce module déploie GoAlert sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée Google
Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par GoAlert et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— reportez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoAlert s'exécute sous la forme d'un pod binaire Go unique sur GKE Autopilot. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod binaire Go, 1 vCPU / 512 Mio par défaut, `min_instance_count = 1`, `max_instance_count = 1` |
| Base de données | Cloud SQL pour PostgreSQL (`POSTGRES_17`) | Requis — GoAlert ne prend pas en charge MySQL ou d'autres moteurs ; extension `pgcrypto` installée automatiquement |
| Secrets | Secret Manager | Mot de passe administrateur et clé de chiffrement des données générés automatiquement ; mot de passe de la base de données géré par la fondation |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut, domaine personnalisé facultatif + certificat géré |

Il n'y a **pas de ligne de stockage d'objets** dans ce tableau — la sortie
`storage_buckets` de `GoAlert_Common` est toujours `[]`. GoAlert n'a pas de
fonctionnalité de téléchargement de fichiers/pièces jointes ; chaque élément de
l'état de l'application (politiques d'escalade, plannings, alertes, historique
des notifications, utilisateurs) réside dans PostgreSQL.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES_17"` est fixé par `GoAlert_Common` ;
  la sélection de tout autre moteur interrompt le démarrage.
- **`application_database_name` / `application_database_user` par défaut à `"admin"`, pas
  `"goalert"`.** Cette variante relie `db_name`/`db_user` dans
  `GoAlert_Common` à partir des variables génériques `application_database_name` /
  `application_database_user` au niveau App_GKE, dont les valeurs par défaut au niveau du
  module sont `"admin"` — incohérent avec les variables
  `db_name`/`db_user` de la variante Cloud Run (par défaut
  `"goalert"`). Cosmétique, mais bon à savoir avant de chercher dans Cloud SQL
  une base de données nommée `goalert`.
- **Un seul pod, toujours actif.** `min_instance_count = 1`, `max_instance_count = 1` — GoAlert
  exécute une boucle continue de "moteur" in-process qui évalue le timing des
  politiques d'escalade, l'état de rotation et l'envoi des notifications
  sortantes ; il n'y a pas de concept de mise à l'échelle à zéro sur GKE dans ce
  module, et une seule instance correspond à la propre recommandation de GoAlert
  contre l'exécution de plusieurs instances de moteur en mode par défaut sans
  une topologie `--api-only` que ce module ne connecte pas.
- **Pas de Redis, pas de stockage d'objets.** L'état de GoAlert réside
  entièrement dans PostgreSQL ; il n'a pas besoin de cache externe, de file
  d'attente ou de stockage de fichiers.
- **`GOALERT_DB_URL` est assemblé au démarrage du conteneur, pas au moment du plan.**
  GoAlert n'accepte qu'une seule variable d'environnement de chaîne de connexion
  Postgres, et le `DB_PASSWORD` provenant de Secret Manager au moment de
  l'exécution ne peut pas être encodé en URL tant que le conteneur ne démarre
  pas réellement — `entrypoint.sh` (et chaque script de job d'initialisation) le
  construit à partir des valeurs discrètes `DB_*` injectées par la
  Fondation, en se basant sur le fait que l'hôte résolu est la boucle de rappel
  cloud-sql-proxy (`127.0.0.1`, pas de TLS) ou un socket/IP réel.
- **`public_url` est résolu au démarrage lorsqu'il est laissé vide.** Ce module
  transmet `public_url = var.public_url` directement sans aucun mécanisme de secours côté
  Terraform ; lorsqu'il est vide, le point d'entrée définit `GOALERT_PUBLIC_URL` à
  partir du `GKE_SERVICE_URL` injecté par la plateforme. Cette valeur pilote la
  validation OIDC/CSRF-referer et les URL de clé d'intégration que GoAlert
  transmet à vos systèmes de surveillance, donc définissez `public_url`
  explicitement uniquement lorsque les utilisateurs accèdent à GoAlert à une
  adresse différente (par exemple, un domaine personnalisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté `gcloud container clusters get-credentials <cluster> --region <region> --project <project>` et que
`PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et
les autres identifiants sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. GKE Autopilot — la charge de travail GoAlert {#a-gke-autopilot--the-goalert-workload}

GoAlert s'exécute sous la forme d'un seul pod toujours actif sur Autopilot
(`min = max = 1`), qui facture le CPU/la mémoire que le pod demande
réellement.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail GoAlert pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot et le type de charge de
travail (Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour PostgreSQL {#b-cloud-sql-for-postgresql}

GoAlert stocke toutes les données de l'application — politiques d'escalade,
plannings, rotations, alertes, historique des notifications et utilisateurs —
dans une instance PostgreSQL gérée de Cloud SQL. Les pods y accèdent en privé
via le sidecar **Cloud SQL Auth Proxy** sur une connexion TCP en boucle de rappel
(`127.0.0.1`) ; `entrypoint.sh` le détecte et ignore la branche de socket Unix
utilisée sur Cloud Run.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatisées et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont générés automatiquement par `GoAlert_Common` et stockés dans
Secret Manager : le **mot de passe administrateur** (consommé par le job
d'initialisation `admin-bootstrap`) et une **clé de chiffrement des données**
(recommandée par la documentation GoAlert en amont). Le mot de passe de la base
de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Réseau et Ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud
Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré
par Google peut être activé, et une adresse IP statique peut être réservée afin
que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses
  IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests
de disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GoAlert {#3-goalert-application-behaviour}

- **La chaîne de jobs d'initialisation en 3 étapes est essentielle.**
  `GoAlert_Common` définit trois Jobs Kubernetes ordonnés, chacun dépendant du
  précédent, tous avec `execute_on_apply = true` :
  1. **`db-init`** (`postgres:15-alpine`) — crée le rôle et la base de
     données PostgreSQL.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`) — exécute
     `goalert migrate --db-url=...`, appliquant le propre schéma de GoAlert. Cela **doit**
     s'exécuter avant `admin-bootstrap` : `goalert add-user` n'a pas de logique de
     migration propre, et sur une base de données vierge, il échoue avec
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — exécute
     `goalert add-user --admin` directement contre Postgres pour créer la première
     connexion administrateur.

  Sur GKE, `execute_on_apply = false` empêche seulement Terraform d'**attendre** qu'un job
  se termine — le Job/pod Kubernetes sous-jacent est toujours créé et planifié
  immédiatement dans les deux cas. La correction ici repose sur
  `depends_on_jobs` (le système de dépendance de jobs à 3 niveaux d'App_GKE), et
  non sur le séquençage au moment de l'apply. Les trois scripts réessayent
  également en interne (jusqu'à 10 tentatives, espacées de 5 secondes) pour
  absorber la latence de Cloud SQL/planification.

- **Pas d'assistant de configuration à la première visite.** GoAlert n'a pas de
  flux d'administration initial basé sur le web — le job `admin-bootstrap` est le
  seul moyen de créer un compte administrateur. Récupérez le mot de passe
  généré :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Point de terminaison de santé.** `/health` est le point de terminaison
  public non authentifié documenté de GoAlert (200 une fois que le cycle de vie
  de l'application quitte l'état "Starting"). Les sondes de démarrage et de
  vivacité de ce module utilisent par défaut une vérification de port **TCP**
  plutôt qu'une vérification de chemin HTTP — Kubernetes prend en charge
  `tcpSocket` pour les deux types de sondes (contrairement à Cloud Run, qui
  interdit une sonde de vivacité TCP) — et les deux se sont avérées correctes
  lors de la vérification en direct (HTTP 200 sur `/health` avec de
  véritables lignes de journal "listening and serving HTTP").

- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
GoAlert sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut
standards.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par exemple `gke`) de tout `GoAlert_CloudRun` (`cr`) co-déployé pour éviter une collision de noms. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `goalert` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `GoAlert` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image. `"latest"` correspond à un argument de build Dockerfile épinglé (`GOALERT_VERSION = v0.34.1`). |
| `admin_username` | `admin` | Nom d'utilisateur créé par le job d'initialisation `admin-bootstrap`. |
| `admin_email` | `admin@techequity.cloud` | E-mail pour le compte administrateur initial. |
| `public_url` | `""` | Laissé vide, résolu au démarrage à partir de `GKE_SERVICE_URL` injecté par la plateforme. Définir explicitement uniquement si les utilisateurs accèdent à GoAlert à une autre adresse (par exemple, un domaine personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Requêtes et limites CPU/mémoire. |
| `container_port` | `8081` | Port HTTP natif de GoAlert. |
| `min_instance_count` | `1` | Réplicas de pod minimum. |
| `max_instance_count` | `1` | Instance de moteur unique en mode par défaut ; plusieurs instances nécessitent une topologie `--api-only` que ce module ne connecte pas. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base GoAlert dans Artifact Registry. |

### Groupe 9 — Configuration du backend GKE {#group-9--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (résout en `Deployment`) | `"Deployment"` ou `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Affinité de session pour le service Kubernetes. |
| `namespace_name` | `""` (généré automatiquement) | Espace de noms Kubernetes. |

### Groupe 16/17 — Configuration de la base de données {#group-1617--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Moteur Cloud SQL. GoAlert nécessite PostgreSQL. |
| `application_database_name` | `admin` | Nom de la base de données PostgreSQL — voir la note d'incohérence de nommage dans la Vue d'ensemble. |
| `application_database_user` | `admin` | Utilisateur de l'application PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11/12 — Automatisation de la charge de travail {#group-1112--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour la chaîne de 3 jobs par défaut de `GoAlert_Common` (`db-init` → `db-migrate` → `admin-bootstrap`). |
| `cron_jobs` | `[]` | GoAlert n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, délai de 30s, 30 tentatives | S'adapte à la latence de migration au premier démarrage (`db-migrate`). |
| `health_check_config` | TCP, délai de 30s, 3 tentatives | Sonde de vivacité Kubernetes. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis par GoAlert ; présent pour la compatibilité de la plateforme. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés. |
| `reserve_static_ip` | `true` | Réserver une IP statique globale stable pour l'équilibreur de charge — recommandé pour que `public_url` n'ait pas besoin de changer après chaque redéploiement. |

Toutes les autres entrées (Métadonnées du module, Variables d'environnement et
secrets, Intégration CI/CD et GitHub, SQL personnalisé, Stockage et système de
fichiers, IAP et Cloud Armor, Configuration StatefulSet, Contrôles de service
VPC, Politiques de fiabilité) sont héritées de `App_GKE` avec son
comportement standard — voir **[App_GKE](App_GKE.md)** pour la liste complète,
organisée par groupe.

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP intra-cluster / IP externe de l'équilibreur de charge. |
| `service_url` | URL pour atteindre GoAlert. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données de l'application / utilisateur. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Toujours `[]` — GoAlert ne provisionne pas de buckets de stockage. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources de la charge de travail sont déployées. `false` lors du premier apply d'un nouveau cluster inline — une nouvelle exécution complète le déploiement. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs et
> les combinaisons au moment du plan. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit
> créée.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critique | Tout autre moteur rompt entièrement le schéma et le démarrage de GoAlert — `pgcrypto` et l'ensemble du flux `goalert migrate` sont spécifiques à Postgres. |
| Ordre `initialization_jobs` (`db-init` → `db-migrate` → `admin-bootstrap`) | Laisser `[]` sauf si vous comprenez parfaitement la chaîne de dépendances | Critique | L'exécution de `admin-bootstrap` avant `db-migrate` échoue avec `relation "auth_basic_users" does not exist` sur une base de données vierge — `goalert add-user` n'a pas de logique de migration propre. Sur GKE, `execute_on_apply=false` ne retarde PAS la planification du pod, seulement l'attente de Terraform — la garantie d'ordre provient entièrement de `depends_on_jobs`. |
| `public_url` | Laisser `""` (résolu au démarrage à partir de `GKE_SERVICE_URL`) ou définir l'URL externe réelle | Élevé | Un `GOALERT_PUBLIC_URL` erroné rompt les rappels d'authentification OIDC, chaque lien dans les notifications sortantes et les URL de clé d'intégration vers lesquelles vos systèmes de surveillance publient des alertes. |
| `min_instance_count` | `1` | Élevé | Le moteur de synchronisation d'escalade de GoAlert est une boucle continue en cours de processus — à zéro réplica, les escalades pour les alertes réelles sont silencieusement manquées entièrement. |
| `application_database_name` / `application_database_user` | Confirmer les valeurs réelles (`admin`/`admin` par défaut, pas `goalert`) | Moyen | La recherche d'une base de données littéralement nommée `goalert` dans Cloud SQL ne la trouvera pas avec les valeurs par défaut de cette variante. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `reserve_static_ip` | `true` | Moyen | Sans IP statique réservée, l'adresse externe de l'équilibreur de charge peut changer lors des redéploiements, rompant tout `public_url` que vous avez configuré. |
| `admin_username` / `admin_email` | Définir une fois, récupérer le mot de passe de Secret Manager | Moyen | GoAlert n'a pas de flux de réinitialisation de mot de passe en libre-service visible depuis Terraform ; perdre la trace des identifiants administrateur amorcés signifie utiliser la CLI `goalert` directement contre la base de données pour en créer un nouveau. |
| `max_instance_count` | `1` sauf si vous connectez une topologie `--api-only` | Moyen | GoAlert prend en charge plusieurs instances de moteur en toute sécurité (pas de bug de double déclenchement selon la documentation en amont), mais ce module n'a pas de mécanisme intégré pour désigner les réplicas `--api-only`. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à GoAlert
partagée avec la variante Cloud Run est décrite dans
**[GoAlert_Common](GoAlert_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : GoAlert sur GKE Autopilot](../labs/GoAlert_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoAlert Common — Configuration d'application partagée](GoAlert_Common.md) — la configuration partagée par les deux cibles de déploiement.
