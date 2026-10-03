---
title: "Planka sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Planka sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Planka_GKE.md @ 15fd4c7 sha256:5718aafb59d0 -->

# Planka sur GKE Autopilot {#planka-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Planka_GKE.png" alt="Planka sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Planka est une application de tableau kanban open-source, auto-hébergée,
similaire à Trello, avec un backend Node.js (Sails.js) et un frontend React,
utilisée pour la gestion de projets d'équipe et personnels — tableaux, listes,
cartes, dates d'échéance, étiquettes et pièces jointes. Ce module déploie
Planka sur **GKE Autopilot** en s'appuyant sur la fondation
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée
Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Planka et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE
— Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au
[guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Planka s'exécute comme une seule charge de travail web Node.js, servant à la
fois son API et son frontend React depuis un seul port. Le déploiement
assemble un ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Le constructeur de requêtes Knex de Planka ne supporte aucun autre moteur |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est créé et monté à `/app/data` pour les pièces jointes, les avatars et les arrière-plans |
| Cache et file d'attente | aucun | Planka n'a pas de dépendance Redis ou de file d'attente — les mises à jour en temps réel passent par Socket.io in-process |
| Secrets | Secret Manager | `SECRET_KEY` et `DEFAULT_ADMIN_PASSWORD` — deux secrets réels et fonctionnels — plus le mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, IP statique réservée, domaine personnalisé optionnel |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le seul moteur supporté.** `Planka_Common` corrige
  `database_type = "POSTGRES_15"`.
- **Une build personnalisée légère, pas l'image pré-construite.** Planka a
  besoin d'un point d'entrée cloud pour composer `DATABASE_URL` et dériver
  `BASE_URL`, donc `container_image_source = "custom"` construit `FROM
  ghcr.io/plankanban/planka:<version>` via
  Cloud Build.
- **`DATABASE_URL` est une chaîne de connexion d'autorité URL, mais SSL est
  défini via des variables d'environnement séparées — jamais un paramètre de
  requête `?sslmode=`.** Planka a deux chemins de connexion DB
  indépendants (le CLI de migration et l'ORM Sails du serveur en cours
  d'exécution), chacun nécessitant une configuration SSL différente, et chacun
  ignorant un `?sslmode=` intégré à l'URL pour sa propre raison
  non liée. Sur GKE, le sidecar Cloud SQL Auth Proxy écoute sur `127.0.0.1`
  et termine le TLS lui-même, donc le point d'entrée ne définit **ni**
  `PGSSLMODE` **ni** `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` pour cette connexion en
  boucle — aucune configuration SSL n'est nécessaire. Voir le
  [guide commun](Planka_Common.md) pour l'explication complète des deux
  chemins et la branche TCP IP privée.
- **Deux secrets d'application réels et fonctionnels.** `SECRET_KEY`
  (signature de session/jeton, requise au démarrage) et `DEFAULT_ADMIN_PASSWORD` (initialise
  le compte administrateur initial au premier démarrage avec une base de
  données vide) sont tous deux réellement consommés par Planka. Il n'y a
  **pas d'invite de réinitialisation de mot de passe forcée**, alors changez
  le mot de passe initial immédiatement après le premier déploiement.
- **`workload_type` par défaut est `Deployment`, pas `StatefulSet`.** Planka
  ne conserve aucun état local au-delà de ce qui est déjà dans Cloud SQL.
- **`reserve_static_ip = true`** (remplaçant la valeur par défaut App_GKE de
  `false`). Le point d'entrée cloud dérive `BASE_URL` des
  valeurs `GKE_SERVICE_URL` injectées par la fondation ; sans IP statique
  réservée, `BASE_URL` peut revenir à un DNS interne `*.svc.cluster.local`
  inaccessible, ce qui rompt les liens de pièces jointes et les
  notifications par e-mail.
- **Les pièces jointes persistent par défaut.** Le module monte le bucket
  GCS `storage` au chemin `/app/data` de Planka, qui contient
  tous les types de téléchargement. Si vous activez un PVC de bloc à la place
  (`stateful_pvc_enabled = true`), le montage du bucket est supprimé afin que les deux ne
  se heurtent jamais.
- **Pas de Redis, pas de NFS.** `enable_redis` et `enable_nfs` sont tous
  deux par défaut `false` — Planka n'a besoin ni d'un backend de
  cache/file d'attente ni d'un partage de système de fichiers POSIX.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Planka {#a-gke-autopilot--the-planka-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|BASE_URL'
  ```

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Les pods atteignent la base de données en privé via le sidecar
**cloud-sql-proxy** sur `127.0.0.1`. Lors du premier déploiement, un
Job d'initialisation crée la base de données et le rôle de l'application ;
Planka exécute ensuite ses propres migrations et son amorçage à chaque
démarrage de pod.

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~planka"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~planka"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing avec une adresse statique réservée. Le `BASE_URL` de Planka
(utilisé pour les liens de pièces jointes et les notifications par e-mail) est
dérivé de cette adresse — mettez à jour `BASE_URL` explicitement si un
domaine personnalisé est ajouté par la suite.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Planka {#3-planka-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh`, créant de manière
  idempotente le rôle et la base de données de l'application (pas besoin de
  `CREATEROLE`/`CREATEDB`).
- **Migrations de schéma et amorçage à chaque démarrage.** Le
  `start.sh` de l'image officielle exécute `node db/init.js`
  (migrations + amorçage) avant de démarrer le serveur.
- **Identifiant d'administrateur réel — pas de réinitialisation forcée.**
  Planka amorce `admin@example.com` avec le `DEFAULT_ADMIN_PASSWORD` généré
  lors du premier démarrage (base de données vide), sans invite de
  réinitialisation de mot de passe forcée — connectez-vous et changez le mot
  de passe via l'interface utilisateur de Planka rapidement après le
  déploiement.
- **`DATABASE_URL` composé par le point d'entrée cloud.** Construit au
  démarrage du conteneur à partir des valeurs `DB_*` injectées par la
  fondation (le mot de passe est une valeur Secret Manager d'exécution,
  indisponible au moment de la planification). Voir
  [Planka_Common](Planka_Common.md) pour tous les détails.
- **Chemin de santé.** Les sondes de démarrage et de vivacité sont
  configurées via les variables `startup_probe`/`liveness_probe`. Le
  `server/healthcheck.js` de Planka cible le **chemin racine `/`** sans
  authentification, et les variables `startup_probe`/`liveness_probe` de ce
  module sont maintenant correctement par défaut à `path = "/"` pour
  correspondre.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Planka sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `planka` | Nom de base des ressources. |
| `application_version` | `latest` | Utilisé comme ARG de build `PLANKA_VERSION`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Planka a besoin du wrapper de point d'entrée cloud — conservez `custom`. |
| `container_port` | `1337` | Port natif par défaut de Planka ; le port du conteneur et les sondes doivent correspondre. |
| `min_instance_count` / `max_instance_count` | `0` / `5` | Limites de mise à l'échelle HPA. |
| `container_resources.memory_limit` | `4Gi` | Planka nécessite au moins 2 Gi pour un fonctionnement fiable. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` (→ `Deployment`) | Planka est sans état au niveau du pod. |
| `service_type` | `LoadBalancer` | Application kanban publique — une surcharge `ClusterIP` n'a pas de raison d'être ici. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un seul pod. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Créé et monté automatiquement à `/app/data` (sauf si un PVC de bloc est activé). |
| `gcs_volumes` | `[]` | Non nécessaire pour les téléchargements — le module monte déjà son bucket à `/app/data`. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — Knex ne supporte aucun autre moteur. |
| `application_database_name` / `application_database_user` | `planka` / `planka` | Nom de la base de données PostgreSQL et nom d'utilisateur de l'application. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/`, délai de 60s | Les sondes réellement appliquées au pod déployé, correspondant maintenant à la cible de santé réelle et non authentifiée de Planka (`server/healthcheck.js`). |
| `startup_probe_config` / `health_check_config` | HTTP `/`, délai de 60s | Valeurs par défaut au niveau de la fondation ; remplacées par `startup_probe`/`liveness_probe` ci-dessus — effectivement inertes. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Non nécessaire — Planka n'a pas d'exigence de système de fichiers POSIX. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Planka n'a pas de dépendance de cache/file d'attente. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress + certificat géré. |
| `reserve_static_ip` | `true` | Remplace la valeur par défaut App_GKE (`false`) afin que `BASE_URL` se résolve en une adresse réelle et accessible — voir §1. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `storage` pour les pièces jointes. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/rôle et détruit toutes les données. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, en ignorant le point d'entrée cloud — Planka démarre sans `DATABASE_URL`. |
| Chemin `startup_probe` / `liveness_probe` | `/` (la valeur par défaut du module) | **Élevé** | Correspond à la cible de santé réelle et non authentifiée de Planka (selon `server/healthcheck.js`, un simple GET HTTP vers `/` vérifiant un code 200). Si remplacé par un autre chemin, le pod peut ne pas atteindre l'état Prêt. |
| `reserve_static_ip` | `true` (déjà la valeur par défaut du module) | Élevé | `false` peut laisser `BASE_URL` pointer vers un DNS interne `*.svc.cluster.local` inaccessible, ce qui rompt les liens de pièces jointes et les notifications par e-mail. |
| `DEFAULT_ADMIN_PASSWORD` (secret généré) | Connectez-vous et changez-le immédiatement après le premier déploiement | **Critique** | Planka ne force pas la réinitialisation du mot de passe — toute personne qui obtient le mot de passe initial peut se connecter en tant qu'administrateur indéfiniment jusqu'à ce qu'il soit changé. |
| `DATABASE_URL` / config SSL | Ne jamais modifier manuellement — contrôlé par le point d'entrée cloud via les variables d'environnement `PGSSLMODE`/`KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE`, PAS un paramètre de requête `?sslmode=` | **Critique** | Planka a deux chemins de connexion DB indépendants avec des mécanismes SSL différents, confirmés par le traçage de la chaîne de dépendance réelle : (1) le CLI de migration (`server/db/knexfile.js`) lit `KNEX_REJECT_UNAUTHORIZED_SSL_CERTIFICATE` ; (2) l'ORM Sails du serveur en cours d'exécution (`sails-postgresql` → `machinepack-postgresql`) analyse `DATABASE_URL` avec le `url.parse()` hérité de Node, qui **supprime silencieusement chaque paramètre de requête**, y compris `?sslmode=` — donc un sslmode intégré à l'URL ne fait rien pour le chemin d'exécution. Sans configuration `ssl` explicite, `pg` brut revient à la *variable d'environnement* `PGSSLMODE`, où `require` signifie "chiffrer ET vérifier" (pas "chiffrer uniquement" comme le libpq classique) — seul `PGSSLMODE=no-verify` ignore la vérification du certificat. Le certificat auto-signé de Cloud SQL n'est pas dans le bundle CA de Node, donc tout sauf `no-verify` échoue au démarrage avec `UNABLE_TO_VERIFY_LEAF_SIGNATURE` et le hook Sails `orm` ne se charge jamais. La connexion en boucle GKE (sidecar Cloud SQL Auth Proxy) n'a besoin d'aucune variable définie — le proxy termine déjà le TLS. |
| `gcs_volumes` à `/app/data` | Laisser vide | Moyen | Le module monte déjà son bucket `storage` à `/app/data` ; un deuxième montage au même chemin entre en conflit. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Planka
partagée avec la variante Cloud Run est décrite dans
**[Planka_Common](Planka_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Labo pratique : Planka sur GKE Autopilot](../labs/Planka_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Planka sur Google Cloud Run](Planka_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Planka Common — Configuration d'application partagée](Planka_Common.md) — la configuration partagée par les deux cibles de déploiement.
