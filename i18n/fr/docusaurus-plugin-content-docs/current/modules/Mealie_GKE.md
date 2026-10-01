---
title: "Mealie sur GKE Autopilot"
description: "Référence de configuration pour déployer Mealie sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Mealie_GKE.md @ 3055034 sha256:1d4fbe3c6c81 -->

# Mealie sur GKE Autopilot {#mealie-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mealie_GKE.png" alt="Mealie sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mealie est un gestionnaire de recettes et planificateur de repas open source et
auto-hébergé, doté d'un backend FastAPI et d'un frontend Vue, qui propose
l'import automatique de recettes par URL en plus d'un éditeur manuel dans
l'interface. Ce module déploie Mealie sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Mealie et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Mealie s'exécute sous forme d'une unique charge de travail web FastAPI/Vue. Le
déploiement assemble un ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod FastAPI, 1 vCPU / 512 MiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Mealie lit des variables d'environnement `POSTGRES_*` distinctes, et non un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les images des recettes et monté automatiquement sur `/app/data` |
| Cache et file d'attente | aucun | Mealie ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — Mealie n'a aucun identifiant administrateur configurable par variable d'environnement |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Mealie_Common` fixe
  `database_type = "POSTGRES_15"` et définit explicitement `DB_ENGINE=postgres`.
- **Aucun build de conteneur personnalisé.** L'image officielle préconstruite
  (`ghcr.io/mealie-recipes/mealie`) est utilisée directement.
- **Un compte administrateur par défaut, et non une première inscription — et il
  n'est PAS configurable.** Depuis la v3.x, l'identifiant initial de Mealie ne
  peut plus être défini via des variables d'environnement (voir le
  [guide Common](Mealie_Common.md)). Chaque déploiement démarre avec le même
  compte bien connu : `changeme@example.com` / `MyPassword`. Connectez-vous
  immédiatement après le premier déploiement et effectuez la réinitialisation du
  mot de passe imposée.
- **`workload_type = "Deployment"`, et non `StatefulSet`.** Mealie ne conserve
  aucun état local au-delà de ce qui se trouve déjà dans Cloud SQL — aucun PVC ni
  montage NFS n'est requis.
- **Les images des recettes sont persistées par défaut.** `Mealie_Common` déclare
  une entrée `gcs_volumes` qui monte le bucket GCS `data` sur `/app/data`, afin
  que les images de recettes téléversées survivent au redémarrage d'un pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Mealie {#a-gke-autopilot--the-mealie-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Les pods joignent la base de données de manière privée via le sidecar
**cloud-sql-proxy** sur `127.0.0.1`.

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~mealie"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mealie"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### E. Réseau et entrée {#e-networking--ingress}

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

## 3. Comportement de l'application Mealie {#3-mealie-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche
  d'initialisation exécute `create-db-and-user.sh`, ce qui crée de manière
  idempotente le rôle et la base de données de l'application.
- **Migrations du schéma au démarrage.** Mealie applique automatiquement ses
  propres migrations internes à chaque démarrage de pod.
- **Identifiant administrateur par défaut fixe — non configurable.** Mealie crée
  `changeme@example.com` / `MyPassword` lors de la première initialisation de la
  base de données. Il s'agit d'une valeur par défaut codée en dur en amont (aucune
  variable d'environnement ne la remplace depuis la v3.x), et non d'un secret
  généré — une réinitialisation du mot de passe est imposée à la première
  connexion, et les opérateurs doivent l'effectuer immédiatement après le
  déploiement.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent
  `/api/app/about`.
- **Inspecter l'exécution des tâches :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Mealie ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mealie` | Nom de base des ressources. |
| `application_version` | `latest` | Mealie publie un véritable tag `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire. |
| `container_port` | `9000` | Port natif par défaut de Mealie. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Bornes de mise à l'échelle du HPA. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement sur `/app/data`. |
| `stateful_pvc_enabled` | `null` (auto, désactivé) | Non utilisé — Mealie est sans état au niveau du pod. |

### Groupe 12 (16) — Backend de base de données {#group-12-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Mealie_Common`. |
| `db_host_env_var_name` | `POSTGRES_SERVER` | Expose la variable `DB_HOST` de la plateforme sous le nom attendu par Mealie. |
| `db_user_env_var_name` | `POSTGRES_USER` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `POSTGRES_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `POSTGRES_DB` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `POSTGRES_PORT` | Alias de `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/app/about` | Les sondes ciblent le véritable point de terminaison d'information de Mealie. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du Service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` des images des recettes. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module. |
| Identifiant administrateur par défaut (`changeme@example.com` / `MyPassword`) | Connectez-vous et modifiez-le immédiatement après le premier déploiement | **Critique** | Il s'agit d'une valeur par défaut amont fixe et documentée publiquement — et non d'un secret généré — dès que la base de données est initialisée, quiconque connaît l'identifiant par défaut de Mealie peut se connecter tant que vous n'avez pas effectué la réinitialisation du mot de passe imposée à la première connexion. |
| `gcs_volumes` pour les images des recettes | Laisser vide (utiliser le propre montage `/app/data` du module) | Moyen | `Mealie_Common` monte déjà le bucket `data` sur `/app/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas aussi `/app/data`, les images de recettes téléversées retombent sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage. |
| Variables `db_*_env_var_name` | Les laisser à leurs valeurs par défaut propres à Mealie | Critique | Les modifier ou les vider casse la connexion Postgres de Mealie — il lit `POSTGRES_*`, et non `DB_*`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — voir
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Mealie, partagée
avec la variante Cloud Run, est décrite dans **[Mealie_Common](Mealie_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Mealie sur GKE Autopilot](../labs/Mealie_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mealie sur Google Cloud Run](Mealie_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Mealie Common — Configuration applicative partagée](Mealie_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) et [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Home & Life Management**.
