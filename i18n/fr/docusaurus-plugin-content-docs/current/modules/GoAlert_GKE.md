---
title: "GoAlert sur GKE Autopilot"
description: "Référence de configuration pour déployer GoAlert sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/GoAlert_GKE.md @ 3055034 sha256:8c3c87bc38e4 -->

# GoAlert sur GKE Autopilot {#goalert-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/GoAlert_GKE.png" alt="GoAlert sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

GoAlert est une plateforme open source sous licence Apache 2.0 de planification
d'astreintes et d'escalade des alertes d'incident, créée à l'origine par Target et
exploitée en production à grande échelle. Elle permet aux équipes de définir des
politiques d'escalade, des rotations et des plannings d'astreinte, et d'envoyer des
notifications sortantes par e-mail, webhook ou (en option) SMS/appel vocal Twilio. Ce
module déploie GoAlert sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise GoAlert et sur la façon de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

GoAlert s'exécute sous la forme d'un pod contenant un unique binaire Go sur GKE
Autopilot. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod du binaire Go, 1 vCPU / 512 MiB par défaut, `min_instance_count = 1`, `max_instance_count = 1` |
| Base de données | Cloud SQL for PostgreSQL (`POSTGRES_17`) | Obligatoire — GoAlert ne prend en charge ni MySQL ni d'autres moteurs ; l'extension `pgcrypto` est installée automatiquement |
| Secrets | Secret Manager | Mot de passe administrateur et clé de chiffrement des données générés automatiquement ; mot de passe de la base de données géré par le socle |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut, domaine personnalisé + certificat géré en option |

Ce tableau ne comporte **aucune ligne de stockage d'objets** — la sortie
`storage_buckets` de `GoAlert_Common` vaut toujours `[]`. GoAlert ne dispose d'aucune
fonctionnalité de téléversement de fichiers ou de pièces jointes ; tout l'état de
l'application (politiques d'escalade, plannings, alertes, historique des notifications,
utilisateurs) réside dans PostgreSQL.

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est obligatoire.** `database_type = "POSTGRES_17"` est fixé par
  `GoAlert_Common` ; choisir un autre moteur empêche le démarrage.
- **`application_database_name` / `application_database_user` valent par défaut
  `"admin"`, et non `"goalert"`.** Cette variante alimente `db_name`/`db_user` dans
  `GoAlert_Common` à partir des variables génériques de niveau App_GKE
  `application_database_name` / `application_database_user`, dont les valeurs par
  défaut au niveau du module sont `"admin"` — ce qui est incohérent avec les variables
  `db_name`/`db_user` de la variante Cloud Run (par défaut `"goalert"`). C'est purement
  cosmétique, mais bon à savoir avant de chercher dans Cloud SQL une base de données nommée
  `goalert`.
- **Un seul pod, toujours actif.** `min_instance_count = 1`, `max_instance_count = 1`
  — GoAlert exécute en continu une boucle « moteur » intégrée au processus qui évalue le
  minutage des politiques d'escalade, l'état des rotations et l'envoi des notifications
  sortantes ; ce module ne connaît pas la notion de mise à l'échelle à zéro sur GKE, et une
  instance unique correspond à la recommandation propre à GoAlert, qui déconseille
  d'exécuter plusieurs instances de moteur en mode par défaut sans une topologie
  `--api-only` que ce module ne met pas en place.
- **Ni Redis, ni stockage d'objets.** L'état de GoAlert réside entièrement dans
  PostgreSQL ; il n'a besoin d'aucun cache, d'aucune file ni d'aucun stockage de fichiers
  externes.
- **`GOALERT_DB_URL` est assemblée au démarrage du conteneur, pas au moment du plan.**
  GoAlert n'accepte qu'une seule variable d'environnement de chaîne de connexion Postgres,
  et le `DB_PASSWORD` issu de Secret Manager à l'exécution ne peut être encodé pour une URL
  qu'au démarrage effectif du conteneur — `entrypoint.sh` (ainsi que chaque script de job
  d'initialisation) la construit à partir des valeurs `DB_*` distinctes injectées par le
  socle, selon que l'hôte résolu est l'interface de bouclage du cloud-sql-proxy
  (`127.0.0.1`, sans TLS) ou un véritable socket/une véritable IP.
- **`public_url` n'a pas de valeur par défaut calculée automatiquement sur GKE.**
  Contrairement à `GoAlert_CloudRun`, ce module transmet `public_url = var.public_url`
  telle quelle, sans calcul de repli — laissez-la vide et `GOALERT_PUBLIC_URL` se rabat sur
  la valeur propre à GoAlert, `http://localhost:8081`, ce qui casse les rappels OIDC et les
  liens des notifications sortantes. Définissez-la explicitement dès que l'IP du
  LoadBalancer externe ou le domaine personnalisé est connu.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail GoAlert {#a-gke-autopilot--the-goalert-workload}

GoAlert s'exécute sous la forme d'un unique pod toujours actif sur Autopilot
(`min = max = 1`), qui facture le CPU et la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail GoAlert
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot et le type de charge de
travail (Deployment ou StatefulSet) sont gérés.

### B. Cloud SQL for PostgreSQL {#b-cloud-sql-for-postgresql}

GoAlert stocke toutes les données de l'application — politiques d'escalade, plannings,
rotations, alertes, historique des notifications et utilisateurs — dans une instance gérée
Cloud SQL PostgreSQL. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy**
par une connexion TCP sur l'interface de bouclage (`127.0.0.1`) ; `entrypoint.sh` le
détecte et ignore la branche socket Unix utilisée sur Cloud Run.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et la
rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Deux secrets sont générés automatiquement par `GoAlert_Common` et stockés dans Secret
Manager : le **mot de passe administrateur** (consommé par le job d'initialisation
`admin-bootstrap`) et une **clé de chiffrement des données** (recommandée par la
documentation amont de GoAlert). Le mot de passe de la base de données est géré séparément
par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~goalert"
  gcloud secrets versions access latest --secret=<admin-password-secret-id> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google
peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application GoAlert {#3-goalert-application-behaviour}

- **La chaîne de jobs d'initialisation en 3 étapes est essentielle.** `GoAlert_Common`
  définit trois Jobs Kubernetes ordonnés, chacun dépendant du précédent, tous avec
  `execute_on_apply = true` :
  1. **`db-init`** (`postgres:15-alpine`) — crée le rôle et la base de données
     PostgreSQL.
  2. **`db-migrate`** (`goalert/goalert:<version>`, `depends_on_jobs = ["db-init"]`)
     — exécute `goalert migrate --db-url=...` et applique le schéma propre à GoAlert. Il
     **doit** s'exécuter avant `admin-bootstrap` : `goalert add-user` ne comporte aucune
     logique de migration et, sur une base de données vierge, échoue avec
     `relation "auth_basic_users" does not exist`.
  3. **`admin-bootstrap`** (`goalert/goalert:<version>`, `depends_on_jobs =
     ["db-migrate"]`) — exécute `goalert add-user --admin` directement sur Postgres pour
     créer le premier compte administrateur.

  Sur GKE, `execute_on_apply = false` empêche seulement Terraform d'**attendre** la fin
  d'un job — le Job/pod Kubernetes sous-jacent est de toute façon créé et planifié
  immédiatement. L'exactitude repose ici sur `depends_on_jobs` (le système de dépendances
  de jobs à 3 niveaux d'App_GKE), et non sur l'ordonnancement au moment de l'application.
  Les trois scripts réessaient également en interne (jusqu'à 10 tentatives, espacées de
  5s) pour absorber la latence de Cloud SQL et de la planification.

- **Aucun assistant de configuration à la première visite.** GoAlert ne propose aucun
  parcours web de création de l'administrateur initial — le job `admin-bootstrap` est le
  seul moyen de créer un compte administrateur. Récupérez le mot de passe généré :
  ```bash
  gcloud secrets versions access latest --secret=<admin_password_secret_id output>
  ```

- **Point de terminaison de santé.** `/health` est le point de terminaison public et non
  authentifié documenté de GoAlert (200 dès que le cycle de vie de l'application a quitté
  l'état « Starting »). Les sondes de démarrage et de vivacité de ce module effectuent par
  défaut une vérification de port **TCP** plutôt qu'une vérification de chemin HTTP —
  Kubernetes prend en charge `tcpSocket` pour les deux types de sondes (contrairement à
  Cloud Run, qui interdit une sonde de vivacité TCP) — et les deux se sont révélées
  correctes lors d'une vérification en conditions réelles (HTTP 200 sur `/health` avec de
  véritables lignes de journal « listening and serving HTTP »).

- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à GoAlert ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par ex. `gke`) de celle de tout `GoAlert_CloudRun` déployé en parallèle (`cr`) pour éviter une collision de noms. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `goalert` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `GoAlert` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image. `"latest"` correspond à un argument de build Dockerfile épinglé (`GOALERT_VERSION = v0.34.1`). |
| `admin_username` | `admin` | Nom d'utilisateur créé par le job d'initialisation `admin-bootstrap`. |
| `admin_email` | `admin@techequity.cloud` | Adresse e-mail du compte administrateur initial. |
| `public_url` | `""` | **Aucune valeur par défaut calculée automatiquement sur GKE.** Définissez-la explicitement dès que l'IP du LoadBalancer externe ou le domaine personnalisé est connu. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | Requêtes et limites de CPU/mémoire. |
| `container_port` | `8081` | Port HTTP natif de GoAlert. |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pod. |
| `max_instance_count` | `1` | Une seule instance de moteur en mode par défaut ; plusieurs instances nécessitent une topologie `--api-only` que ce module ne met pas en place. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. |
| `enable_image_mirroring` | `true` | Met en miroir l'image de base de GoAlert dans Artifact Registry. |

### Groupe 9 — Configuration du backend GKE {#group-9--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (résolu en `Deployment`) | `"Deployment"` ou `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Affinité de session du Service Kubernetes. |
| `namespace_name` | `""` (généré automatiquement) | Espace de noms Kubernetes. |

### Groupe 16/17 — Configuration de la base de données {#group-1617--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_17` | Moteur Cloud SQL. GoAlert nécessite PostgreSQL. |
| `application_database_name` | `admin` | Nom de la base de données PostgreSQL — voir la remarque sur l'incohérence de nommage dans la Vue d'ensemble. |
| `application_database_user` | `admin` | Utilisateur applicatif PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11/12 — Automatisation des charges de travail {#group-1112--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour la chaîne par défaut de 3 jobs de `GoAlert_Common` (`db-init` → `db-migrate` → `admin-bootstrap`). |
| `cron_jobs` | `[]` | GoAlert ne comporte par défaut aucune tâche récurrente planifiée par la plateforme. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | TCP, délai de 30s, 30 tentatives | Absorbe la latence des migrations au premier démarrage (`db-migrate`). |
| `health_check_config` | TCP, délai de 30s, 3 tentatives | Sonde de vivacité Kubernetes. |
| `uptime_check_config` | `{ enabled=false, path="/health" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis par GoAlert ; présent pour la compatibilité avec la plateforme. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | Réserve une IP statique globale stable pour l'équilibreur de charge — recommandé afin que `public_url` n'ait pas à changer après chaque redéploiement. |

Toutes les autres entrées (métadonnées du module, variables d'environnement et secrets,
CI/CD et intégration GitHub, SQL personnalisé, stockage et système de fichiers, IAP et
Cloud Armor, configuration StatefulSet, VPC Service Controls, règles de fiabilité)
sont héritées d'`App_GKE` avec leur comportement standard — consultez
[App_GKE](App_GKE.md) pour la liste complète, organisée par groupe.

---

## 5. Sorties {#5-outputs}

Renvoyées après un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne au cluster / IP externe du LoadBalancer. |
| `service_url` | URL pour accéder à GoAlert. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Toujours `[]` — GoAlert ne provisionne aucun bucket de stockage. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `db-migrate`, `admin-bootstrap`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources de la charge de travail sont déployées. `false` lors du premier apply d'un nouveau cluster inline — une nouvelle exécution termine le déploiement. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par
> le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs et leurs
> combinaisons au moment du plan. Une configuration invalide fait échouer le **plan**
> avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_17` | Critical | Tout autre moteur casse entièrement le schéma et le démarrage de GoAlert — `pgcrypto` et l'ensemble du flux `goalert migrate` sont propres à Postgres. |
| Ordre de `initialization_jobs` (`db-init` → `db-migrate` → `admin-bootstrap`) | Laissez `[]` sauf si vous maîtrisez parfaitement la chaîne de dépendances | Critical | Exécuter `admin-bootstrap` avant `db-migrate` échoue avec `relation "auth_basic_users" does not exist` sur une base de données vierge — `goalert add-user` ne comporte aucune logique de migration. Sur GKE, `execute_on_apply=false` ne retarde PAS la planification des pods, seulement l'attente de Terraform — la garantie d'ordre provient entièrement de `depends_on_jobs`. |
| `public_url` | À définir explicitement dès que l'IP du LoadBalancer ou le domaine est connu | High | Ce module ne calcule **pas** automatiquement d'URL de service (contrairement à la variante Cloud Run) — une `public_url` non définie se rabat sur la valeur propre à GoAlert, `http://localhost:8081`, ce qui casse les rappels d'authentification OIDC et tous les liens des e-mails de notification sortants. |
| `min_instance_count` | `1` | High | Le moteur de minutage des escalades de GoAlert est une boucle continue intégrée au processus — à zéro réplica, les escalades d'alertes réelles sont totalement manquées, sans aucun signal. |
| `application_database_name` / `application_database_user` | Vérifiez les valeurs réelles (`admin`/`admin` par défaut, et non `goalert`) | Medium | Chercher dans Cloud SQL une base de données littéralement nommée `goalert` ne donnera rien avec les valeurs par défaut de cette variante. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |
| `reserve_static_ip` | `true` | Medium | Sans IP statique réservée, l'adresse du LoadBalancer externe peut changer d'un redéploiement à l'autre, ce qui casse toute `public_url` que vous avez configurée. |
| `admin_username` / `admin_email` | À définir une seule fois ; récupérez le mot de passe dans Secret Manager | Medium | GoAlert n'offre aucun parcours de réinitialisation du mot de passe en libre-service visible depuis Terraform ; perdre la trace de l'identifiant administrateur amorcé oblige à utiliser directement la CLI `goalert` sur la base de données pour en créer un nouveau. |
| `max_instance_count` | `1`, sauf si vous mettez en place une topologie `--api-only` | Medium | GoAlert prend en charge plusieurs instances de moteur sans risque (il ne s'agit pas d'un bug de double déclenchement selon la documentation amont), mais ce module ne dispose d'aucun mécanisme intégré pour désigner des réplicas `--api-only`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à GoAlert, partagée avec la variante Cloud Run, est
décrite dans **[GoAlert_Common](GoAlert_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : GoAlert sur GKE Autopilot](../labs/GoAlert_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [GoAlert Common — Configuration applicative partagée](GoAlert_Common.md) — la configuration partagée par les deux cibles de déploiement.
