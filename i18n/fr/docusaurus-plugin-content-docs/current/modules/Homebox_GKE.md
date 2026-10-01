---
title: "Homebox sur GKE Autopilot"
description: "Référence de configuration pour déployer Homebox sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Homebox_GKE.md @ 3055034 sha256:7bcf657f781c -->

# Homebox sur GKE Autopilot {#homebox-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_GKE.png" alt="Homebox sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox est un système open source et auto-hébergé d'inventaire et d'organisation
domestique, doté d'un backend d'API REST en Go (de style Echo, ORM Ent) et d'un
frontend Vue 3/Nuxt servi de manière intégrée par le même binaire — suivez vos
objets, joignez des photos et organisez-les par emplacement. Ce module déploie
Homebox sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Homebox et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Homebox s'exécute sous la forme d'un unique binaire Go (API + frontend intégré) —
un seul pod, sans autre sidecar que le Cloud SQL Auth Proxy. Le déploiement
assemble un ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go/Echo, 1 vCPU / 512 MiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Homebox lit des variables d'environnement `HBOX_DATABASE_*` distinctes, et non un DSN construit |
| Stockage objet | Cloud Storage | Un bucket `data` est créé pour les photos et pièces jointes des objets et monté automatiquement sur `/data` |
| Cache et file d'attente | aucun | Homebox ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données plus `HBOX_AUTH_API_KEY_PEPPER` (un véritable secret consommé par l'application) |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Homebox_Common` fixe
  `database_type = "POSTGRES_15"` et définit explicitement
  `HBOX_DATABASE_DRIVER=postgres`.
- **Aucun build de conteneur personnalisé.** L'image préconstruite officielle
  (`ghcr.io/sysadminsmedia/homebox`) est utilisée directement.
- **Inscription libre, et non un compte administrateur par défaut.** Homebox
  n'est pas livré avec un identifiant codé en dur : la première personne qui
  soumet le formulaire « Register » sur une instance neuve devient l'utilisateur
  administrateur initial. Consultez le [guide Common](Homebox_Common.md) pour plus
  de détails. Les opérateurs doivent définir
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` une fois l'inscription effectuée.
- **`workload_type = "Deployment"`, et non `StatefulSet`.** Homebox ne conserve
  aucun état local au-delà de ce qui se trouve déjà dans Cloud SQL — ni PVC, ni
  montage NFS nécessaires.
- **Les photos des objets sont conservées par défaut.** `Homebox_Common` déclare
  une entrée `gcs_volumes` qui monte le bucket GCS `data` sur `/data`, afin que les
  photos et pièces jointes téléversées survivent au redémarrage d'un pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Homebox {#a-gke-autopilot--the-homebox-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Les pods atteignent la base de données en privé via le sidecar
**cloud-sql-proxy** sur `127.0.0.1`.

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

### C. Cloud Storage {#c-cloud-storage}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homebox"
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~homebox"
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

## 3. Comportement de l'application Homebox {#3-homebox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `create-db-and-user.sh`, créant de manière idempotente
  le rôle et la base de données de l'application.
- **Migrations de schéma au démarrage.** L'ORM Ent de Homebox applique
  automatiquement ses propres migrations internes à chaque démarrage de pod.
- **Inscription libre — aucun identifiant administrateur par défaut.** Le premier
  visiteur qui remplit le formulaire « Register » devient l'administrateur. Il n'y
  a aucun identifiant à récupérer, réinitialiser ou faire tourner — définissez
  `HBOX_OPTIONS_ALLOW_REGISTRATION=false` une fois le compte administrateur créé
  pour fermer les inscriptions publiques.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/v1/status` — le véritable point de terminaison d'état de Homebox, non
  authentifié.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Homebox ou notables pour
lui sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homebox` | Nom de base des ressources. |
| `application_version` | `latest` | Homebox publie un véritable tag `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Aucun build personnalisé nécessaire. |
| `container_port` | `7745` | Port par défaut natif de Homebox. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Bornes de mise à l'échelle du HPA. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement sur `/data`. |
| `stateful_pvc_enabled` | `null` (auto, désactivé) | Non utilisé — Homebox est sans état au niveau du pod. |

### Groupe 12 (16) — Backend de base de données {#group-12-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Associe la variable `DB_HOST` de la plateforme au nom attendu par Homebox. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Alias de `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/v1/status` | Les sondes ciblent le véritable point de terminaison d'état de Homebox. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du Service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` des photos et pièces jointes des objets. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données et l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | High | `"custom"` déclenche un Cloud Build inutile alors que ce module ne contient pas de Dockerfile. |
| Première inscription | À effectuer rapidement après le déploiement | **Medium** | La première personne à s'inscrire sur une instance neuve accessible publiquement devient l'administrateur — tant que vous ne vous êtes pas inscrit et n'avez pas défini `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, quiconque découvre l'URL peut s'approprier le compte administrateur. |
| `gcs_volumes` pour les photos des objets | Laisser vide (utiliser le montage `/data` propre au module) | **High** | `Homebox_Common` monte déjà le bucket `data` sur `/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas aussi `/data`, les photos et pièces jointes téléversées retombent sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage. |
| Variables `db_*_env_var_name` | Conserver leurs valeurs par défaut propres à Homebox | Critical | Les modifier ou les vider rompt la connexion Postgres de Homebox — il lit `HBOX_DATABASE_*`, et non `DB_*`. |
| `HBOX_DATABASE_SSL_MODE` | `disable` (déjà défini par ce module) | Critical | Sur GKE, `DB_HOST` se résout en `127.0.0.1` (le sidecar cloud-sql-proxy), qui termine lui-même TLS et sert du texte en clair sur la boucle locale. Le client Postgres de Homebox fixe par défaut `HBOX_DATABASE_SSL_MODE` à `require` et **plante au démarrage** (`tls error: server refused TLS connection`) si on ne lui indique pas que la connexion locale n'est pas chiffrée. `Homebox_GKE` le définit via `module_env_vars` — ne le videz pas. Inutile sur Cloud Run, qui se connecte via un socket Unix (aucune négociation TLS ne s'y applique, quel que soit ce paramètre). |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Homebox,
partagée avec la variante Cloud Run, est décrite dans
**[Homebox_Common](Homebox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homebox sur GKE Autopilot](../labs/Homebox_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Homebox sur Google Cloud Run](Homebox_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homebox Common — Configuration applicative partagée](Homebox_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) et [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Home & Life Management**.
