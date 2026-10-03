---
title: "Homebox sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Homebox sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Homebox_GKE.md @ 15fd4c7 sha256:6ae2f7c8bf6c -->

# Homebox sur GKE Autopilot {#homebox-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homebox_GKE.png" alt="Homebox sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Homebox est un système open source d'inventaire et d'organisation domestique
auto-hébergé, doté d'un backend d'API REST en Go (style Echo, ORM Ent) et d'un
frontend Vue 3/Nuxt intégré au même binaire. Il permet de suivre les articles,
d'y joindre des photos et de les organiser par lieu. Ce module déploie Homebox
sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Homebox et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement
— veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt
que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Homebox s'exécute comme un seul binaire Go (API + frontend intégré) — un pod,
pas de sidecars au-delà du proxy d'authentification Cloud SQL. Le déploiement
relie un ensemble restreint et ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go/Echo, 1 vCPU / 512 Mio par défaut |
| Base de données | Cloud SQL pour PostgreSQL 15 | Homebox lit des variables d'environnement `HBOX_DATABASE_*` discrètes, pas un DSN construit |
| Stockage d'objets | Cloud Storage | Un bucket `data` est créé pour les photos/pièces jointes des articles et monté automatiquement à `/data` |
| Cache et file d'attente | aucun | Homebox n'a pas de dépendance Redis ou de file d'attente |
| Secrets | Secret Manager | Mot de passe de la base de données plus `HBOX_AUTH_API_KEY_PEPPER` (un vrai secret consommé par l'application) |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Homebox_Common` corrige
  `database_type = "POSTGRES_15"` et définit `HBOX_DATABASE_DRIVER=postgres`
  explicitement.
- **Pas de build de conteneur personnalisé.** L'image officielle pré-construite
  (`ghcr.io/sysadminsmedia/homebox`) est utilisée directement.
- **Auto-enregistrement ouvert, pas de compte administrateur par défaut.** Homebox
  ne fournit pas de crédentiel codé en dur : la première personne à soumettre le
  formulaire "Register" sur une instance fraîche devient l'utilisateur
  administrateur initial. Voir le [guide commun](Homebox_Common.md) pour plus de
  détails. Les opérateurs doivent définir `HBOX_OPTIONS_ALLOW_REGISTRATION=false` après avoir
  terminé l'enregistrement.
- **`workload_type = "Deployment"`, pas `StatefulSet`.** Homebox ne conserve
  aucun état local au-delà de ce qui est déjà dans Cloud SQL — pas de PVC, pas
  de montage NFS requis.
- **Les photos d'articles sont persistantes par défaut.** `Homebox_Common` déclare une
  entrée `gcs_volumes` montant le bucket GCS `data` à `/data`,
  de sorte que les photos et pièces jointes téléchargées survivent à un
  redémarrage du pod. Si vous activez le PVC de bloc à la place
  (`stateful_pvc_enabled = true`, monté à `/data`), le montage GCS FUSE
  est automatiquement supprimé afin que les deux n'entrent jamais en collision.

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

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

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

### E. Réseau et ingress {#e-networking--ingress}

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

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh`, créant de manière
  idempotente le rôle d'application et la base de données.
- **Migrations de schéma au démarrage.** L'ORM Ent de Homebox applique ses
  propres migrations internes automatiquement à chaque démarrage de pod.
- **Auto-enregistrement ouvert — pas de crédentiel administrateur par défaut.**
  Le premier visiteur à remplir le formulaire "Register" devient l'administrateur.
  Il n'y a pas de crédentiel à récupérer, réinitialiser ou faire pivoter —
  définissez `HBOX_OPTIONS_ALLOW_REGISTRATION=false` une fois que le compte
  administrateur existe pour fermer les inscriptions publiques.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/api/v1/status` — le véritable point de terminaison de statut
  non authentifié de Homebox.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Homebox sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homebox` | Nom de base des ressources. |
| `application_version` | `latest` | Homebox publie une véritable balise `latest`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Pas de build personnalisé nécessaire. |
| `container_port` | `7745` | Port par défaut natif de Homebox. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Limites de mise à l'échelle HPA. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `data` | Créé et monté automatiquement à `/data`. |
| `stateful_pvc_enabled` | `null` (auto, désactivé) | Optionnel. La définition de `true` monte un PVC de bloc à `/data` et supprime le montage GCS FUSE à cet endroit ; le montage de bucket par défaut persiste déjà les photos. |

### Groupe 12 (16) — Backend de base de données {#group-12-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Homebox_Common`. |
| `db_host_env_var_name` | `HBOX_DATABASE_HOST` | Aliasse le `DB_HOST` de la plateforme sur le nom attendu par Homebox. |
| `db_user_env_var_name` | `HBOX_DATABASE_USERNAME` | Aliasse `DB_USER`. |
| `db_password_env_var_name` | `HBOX_DATABASE_PASSWORD` | Aliasse `DB_PASSWORD`. |
| `db_name_env_var_name` | `HBOX_DATABASE_DATABASE` | Aliasse `DB_NAME`. |
| `db_port_env_var_name` | `HBOX_DATABASE_PORT` | Aliasse `DB_PORT`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/api/v1/status` | Les sondes ciblent le véritable point de terminaison de statut de Homebox. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_host` / `database_port` | Détails de connexion Cloud SQL. |
| `storage_buckets` | Le bucket `data` pour les photos et pièces jointes des articles. |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (par défaut) | Élevé | `"custom"` déclenche un Cloud Build inutile sans Dockerfile dans ce module. |
| Première inscription | Terminer rapidement après le déploiement | **Moyen** | La première personne à s'inscrire sur une instance fraîche et publiquement accessible devient l'administrateur — tant que vous ne vous êtes pas inscrit et que vous n'avez pas défini `HBOX_OPTIONS_ALLOW_REGISTRATION=false`, toute personne qui découvre l'URL peut revendiquer le compte administrateur. |
| `gcs_volumes` pour les photos d'articles | Laisser vide (utiliser le montage `/data` propre au module) | **Élevé** | `Homebox_Common` monte déjà le bucket `data` à `/data`. Fournir une liste `gcs_volumes` non vide remplace entièrement ce montage — si le remplacement ne couvre pas également `/data`, les photos et pièces jointes téléchargées retombent sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage. |
| Variables `db_*_env_var_name` | Laisser les valeurs par défaut spécifiques à Homebox | Critique | La modification/suppression de ces variables interrompt la connexion Postgres de Homebox — il lit `HBOX_DATABASE_*`, pas `DB_*`. |
| `HBOX_DATABASE_SSL_MODE` | `disable` (déjà défini par ce module) | Critique | Sur GKE, `DB_HOST` se résout en `127.0.0.1` (le sidecar cloud-sql-proxy), qui termine lui-même le TLS et sert du texte en clair sur la boucle locale. Le client Postgres de Homebox définit par défaut `HBOX_DATABASE_SSL_MODE` à `require` et **panique au démarrage** (`tls error: server refused TLS connection`) à moins qu'on ne lui dise que la connexion locale n'est pas chiffrée. `Homebox_GKE` définit cela via `module_env_vars` — ne le supprimez pas. Non nécessaire sur Cloud Run, qui se connecte via un socket Unix (aucune négociation TLS ne s'applique là, quelle que soit cette configuration). |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Homebox partagée avec la variante
Cloud Run est décrite dans **[Homebox_Common](Homebox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homebox sur GKE Autopilot](../labs/Homebox_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Homebox sur Google Cloud Run](Homebox_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homebox Common — Configuration d'application partagée](Homebox_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md), [LubeLogger sur GKE Autopilot](LubeLogger_GKE.md) dans la solution **Gestion de la maison et de la vie**.
