---
title: "Jellystat sur GKE Autopilot"
description: "Référence de configuration pour déployer Jellystat sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Jellystat_GKE.md @ 3055034 sha256:7ed03760a189 -->

# Jellystat sur GKE Autopilot {#jellystat-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Jellystat_GKE.png" alt="Jellystat sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Jellystat](https://github.com/CyferShepard/Jellystat) est un tableau de bord open
source de statistiques et d'analyse pour les serveurs multimédias
[Jellyfin](https://jellyfin.org/), qui suit l'historique de lecture, les sessions
actives, l'activité des utilisateurs, la croissance des bibliothèques et les
tendances de visionnage. Ce module déploie Jellystat sur **GKE Autopilot** au-dessus
du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Jellystat et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Jellystat s'exécute comme un Deployment Node.js/Express unique (avec un frontend
React intégré), exposé par un Service Kubernetes. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Node.js, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique horizontale |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — noms de variables d'environnement `POSTGRES_*` non standard |
| Stockage objet | Cloud Storage | Un petit bucket `backups` facultatif pour les archives d'export de la base de données |
| Secrets | Secret Manager | `JWT_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe par défaut, domaine personnalisé facultatif |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée.
- **Noms de variables d'environnement de base de données non standard.** Jellystat
  lit `POSTGRES_IP`, `POSTGRES_PORT`, `POSTGRES_USER`, `POSTGRES_PASSWORD` et
  `POSTGRES_DATABASE` — et non les noms génériques `DB_*` de la plateforme, ni en
  particulier `POSTGRES_DB`. Les deux jeux sont injectés côte à côte. Sur GKE, les
  noms standard se résolvent via l'adresse de boucle locale `127.0.0.1` du sidecar
  cloud-sql-proxy (`enable_cloudsql_volume = true`).
- **`container_port = 3000` est fixe.** Le serveur de Jellystat code ce port en dur ;
  il n'est pas configurable par variable d'environnement.
- **`service_type = "LoadBalancer"` par défaut.** Jellystat est un tableau de bord
  accessible depuis un navigateur.
- **`reserve_static_ip = false` par défaut.** Jellystat n'intègre aucune URL
  autoréférente dans sa propre configuration de démarrage ; une IP réservée est donc
  inutile — cela préserve aussi le quota limité d'IP statiques du projet.
- **`JWT_SECRET` est généré automatiquement** et stocké dans Secret Manager.
- **Pas de prise en charge de Redis.** Jellystat n'a aucune intégration native de
  Redis.
- **Aucune variable d'environnement n'associe Jellystat à un serveur Jellyfin.** La
  connexion à Jellyfin (URL du serveur + clé d'API) se saisit entièrement via
  l'interface web de Jellystat après le premier démarrage — voir le §3 ci-dessous.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Jellystat {#a-gke-autopilot--the-jellystat-workload}

Le pod de Jellystat est planifié sur Autopilot, qui facture le CPU et la mémoire
effectivement demandés par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Jellystat pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la mise à l'échelle d'Autopilot et le cycle de
vie de la charge de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Jellystat stocke toutes ses données de lecture et d'analyse dans une instance gérée
Cloud SQL for PostgreSQL 15, joignable via le sidecar cloud-sql-proxy sur
`127.0.0.1`. Lors du premier déploiement, un Job d'initialisation crée la base de
données et l'utilisateur de l'application ; Jellystat applique ensuite ses propres
migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

Un petit bucket **Cloud Storage** facultatif (`backups`) est provisionné pour la
fonctionnalité d'export/archivage de sauvegarde de la base de données propre à
Jellystat.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement : `JWT_SECRET`, utilisé pour
signer les jetons de session/d'authentification de Jellystat. Le mot de passe de la
base de données est géré séparément par le socle.

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Le Service Kubernetes est de type `LoadBalancer` par défaut, ce qui donne
directement une IP externe à Jellystat. Un domaine personnalisé via une Gateway
HTTPRoute, Cloud Armor et Cloud CDN peuvent y être ajoutés.

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques de GKE et
de Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Jellystat {#3-jellystat-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine` et crée le rôle et
  la base de données de l'application. Le job peut être relancé sans risque.
- **Migrations de la base de données au démarrage.** Jellystat applique
  automatiquement ses propres migrations de schéma à chaque démarrage.
- **`JWT_SECRET` est généré une seule fois et stocké dans Secret Manager.** Sa
  rotation invalide toutes les sessions actives, mais n'entraîne aucune perte de
  données.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent `GET /auth/isConfigured` — un point de terminaison public et non
  authentifié.
- **L'association manuelle à Jellyfin est requise après le premier démarrage — elle
  ne peut pas être automatisée par Terraform.** Jellystat n'a aucune variable
  d'environnement pour l'URL ou la clé d'API du serveur Jellyfin associé ;
  l'association se fait entièrement via l'interface :
  1. Ouvrez l'URL de Jellystat déployé (l'IP externe du Service ou votre domaine
     personnalisé) et créez le premier compte administrateur.
  2. Dans le Dashboard → API Keys de votre propre serveur Jellyfin, générez une
     nouvelle clé d'API pour Jellystat.
  3. Dans les paramètres de Jellystat, saisissez l'URL de votre serveur Jellyfin et
     collez cette clé d'API.
  Si vous n'avez pas encore de serveur Jellyfin déployé, déployez-en d'abord un avec
  le module apparenté **Jellyfin_GKE** (ou **Jellyfin_CloudRun**).
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Jellystat ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `jellystat` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image de conteneur. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle `cyfershepard/jellystat`. |
| `container_port` | `3000` | Fixe — correspond au port interne codé en dur de Jellystat. |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Ressources du conteneur. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Bornes de mise à l'échelle automatique des réplicas. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (connexion par boucle locale). |

### Groupe 6 — Réseau et Service Kubernetes {#group-6--networking--kubernetes-service}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Jellystat possède une interface — joignable de l'extérieur par défaut. |
| `service_port` | `80` | Port du Service Kubernetes auquel se connectent les clients. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé — Jellystat n'a pas besoin de stockage de fichiers partagé. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le petit bucket `backups`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` (résolu en `POSTGRES_15` par `Jellystat_Common`) | Moteur fixe. |
| `application_database_name` | `jellystat_db` | Injecté à la fois comme `DB_NAME` et `POSTGRES_DATABASE`. Immuable après le premier déploiement. |
| `application_database_user` | `jellystat_user` | Injecté à la fois comme `DB_USER` et `POSTGRES_USER`. |

### Groupe 15 — Redis (non utilisé) {#group-15--redis-not-consumed}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | désactivé / vide | **Non utilisé.** Jellystat n'a aucune intégration native de Redis. |

### Groupe 19 — Domaine personnalisé et IP statique {#group-19--custom-domain--static-ip}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `false` | Jellystat n'a pas d'URL autoréférente — préserve le quota d'IP statiques du projet. |

Toutes les autres entrées sont héritées d'[App_GKE.md](App_GKE.md) avec leur
comportement standard.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP du Service Kubernetes. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `service_url` | URL du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` | Hôte de la base de données (`127.0.0.1` via le sidecar Cloud SQL Auth Proxy). |
| `storage_buckets` | Buckets de stockage créés (`backups`). |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `kubernetes_ready` | Indique si la connexion du fournisseur Kubernetes a réussi. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `JWT_SECRET` (généré automatiquement) | À ne faire tourner que délibérément | Moyen | Sa rotation invalide toutes les sessions actives, mais n'entraîne aucune perte de données. |
| `container_port` | `3000` (à titre informatif) | Faible | Le serveur de Jellystat code le port 3000 en dur, quelle que soit la valeur de cette variable. |
| Association URL/clé d'API Jellyfin | Manuelle, après le déploiement | Élevé | Il n'existe aucune variable d'environnement pour cela — omettre l'étape manuelle dans l'interface laisse Jellystat sans aucune donnée, même si le déploiement est sain. |
| `service_type` | `LoadBalancer` | Moyen | Le remplacer par `ClusterIP` rend l'interface navigateur injoignable sans chemin d'entrée distinct. |
| Chemin de `startup_probe_config`/`health_check_config` | `/auth/isConfigured` | Élevé | Diriger les sondes vers un point de terminaison authentifié provoque des 401/403 et le pod ne devient jamais Ready. |
| `enable_redis` | laisser `false` | Faible | Jellystat n'a aucune intégration Redis ; définir `true` n'a aucun effet. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Jellystat, partagée avec la variante Cloud Run,
est décrite dans **[Jellystat_Common](Jellystat_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jellystat sur GKE Autopilot](../labs/Jellystat_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jellystat sur Google Cloud Run](Jellystat_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Jellystat Common — Configuration applicative partagée](Jellystat_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Seerr sur GKE Autopilot](Seerr_GKE.md) et [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Media Server**.
