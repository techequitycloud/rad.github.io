---
title: "SparkyFitness sur Google Cloud Run"
description: "Référence de configuration pour déployer SparkyFitness sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SparkyFitness_CloudRun.md @ 3055034 sha256:47e1f1bbc0c0 -->

# SparkyFitness sur Google Cloud Run {#sparkyfitness-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SparkyFitness_CloudRun.png" alt="SparkyFitness sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

SparkyFitness est un outil auto-hébergé de suivi familial de l'alimentation, de la
forme physique, de l'hydratation et de la santé, assisté par IA, construit sous la
forme d'un backend Node.js/Express (`codewithcj/sparkyfitness_server`) et d'un
frontend React distinct servi par nginx (`codewithcj/sparkyfitness`). Ce module
déploie SparkyFitness sur **Cloud Run v2** en s'appuyant sur le socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par SparkyFitness et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run
— identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

SparkyFitness s'exécute sous forme de **deux conteneurs dans un seul service Cloud Run
multiconteneur** — une véritable contrainte de la plateforme, et non un choix de style.
La configuration nginx de l'image frontend amont code en dur une cible de proxy inverse
en `http://` simple
(`proxy_pass http://${SPARKY_FITNESS_SERVER_HOST}:${SPARKY_FITNESS_SERVER_PORT}`),
qui ne peut pas atteindre l'URL publique, exclusivement HTTPS, d'un service Cloud Run
*distinct*. Par conséquent :

- Le **frontend** (nginx, port 80) est le **conteneur principal (d'entrée)** — il reçoit
  tout le trafic public des navigateurs et sert de proxy inverse pour les requêtes
  `/api`, `/uploads`, `/mcp` et `/health-data`.
- Le **backend** (Node.js, port 3010) s'exécute comme **sidecar `additional_containers`
  dans le pod**, joignable par le frontend uniquement à `http://127.0.0.1:3010` — du HTTP
  simple en boucle locale, exactement ce qu'attend la configuration nginx de l'éditeur.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 (révision multiconteneur) | Frontend (entrée, ~0,5 vCPU/512Mi) + backend (sidecar dans le pod, 1 vCPU/1Gi par défaut) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — aucun autre moteur n'est pris en charge |
| Secrets | Secret Manager | `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run | URL `run.app` par défaut sur le conteneur frontend ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Aucun autre moteur n'est pris en charge.
- **Deux rôles de base de données, dont un seul géré par Terraform.** `db_user` (par
  défaut `sparky`) est le rôle d'administration/de migration créé par la tâche
  `db-init` ; `app_db_user` (par défaut `sparky_app`) est un rôle à privilèges limités
  que le **backend crée et entretient lui-même** à chaque démarrage, à l'aide des
  identifiants de `db_user` — il n'existe aucune ressource Terraform pour ce rôle.
- **Pas de tâche de migration distincte.** Contrairement à de nombreuses applications
  de ce catalogue, le backend de SparkyFitness exécute ses propres migrations de base
  de données à chaque démarrage du conteneur.
- **L'image frontend est préconstruite** — `container_image_source = "prebuilt"`, donc le
  socle ne construit rien. Le **sidecar backend est construit par ce module lui-même**
  (`null_resource.build_backend_sidecar` soumet un Cloud Build de
  `SparkyFitness_Common/scripts/Dockerfile` et pousse
  `sparkyfitness-backend:<content-hash>` vers le dépôt Artifact Registry découvert),
  car les sidecars Cloud Run ne bénéficient d'aucun pipeline de build de la part du socle.
- **Mise à l'échelle à zéro par défaut** (`cpu_always_allocated = false`, `min_instance_count = 0`)
  — une application requête/réponse simple, sans planificateur en arrière-plan.
- **Les sondes de santé sont réelles, pas devinées.** `GET /api/health` sur le port 3010
  est confirmé par la directive `HEALTHCHECK` du Dockerfile du backend lui-même.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources figurent dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service SparkyFitness {#a-cloud-run--the-sparkyfitness-service}

Un seul service Cloud Run v2 exécute les deux conteneurs dans une même révision. Le
conteneur frontend est celui qui reçoit le trafic entrant et apparaît dans
`status.url` ; le backend n'est visible que dans la spécification des conteneurs de la
révision.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques. Développez la révision pour voir les deux
  conteneurs (`sparkyfitness` / frontend et `backend`).
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --project "$PROJECT" --region "$REGION" \
    --format='value(spec.containers[].name)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

SparkyFitness stocke toutes les données de l'application dans une instance gérée
Cloud SQL for PostgreSQL 15. Le sidecar backend reçoit les informations de connexion
via les variables d'environnement
`SPARKY_FITNESS_DB_HOST`/`_PORT`/`_NAME`/`_USER`/`_PASSWORD` (renommées à partir des
noms `DB_*` standard du socle).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Trois secrets cryptographiques sont générés automatiquement :

- **`SPARKY_FITNESS_API_ENCRYPTION_KEY`** — 64 caractères hexadécimaux, chiffre les
  identifiants stockés des sources de données externes.
- **`BETTER_AUTH_SECRET`** — signe les sessions et chiffre les données 2FA/TOTP.
- **`SPARKY_FITNESS_APP_DB_PASSWORD`** — mot de passe du rôle `app_db_user`, à privilèges
  limités et autoréparateur.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
```

### D. Réseau et entrée {#d-networking--ingress}

Le conteneur frontend est joignable par défaut à l'URL `run.app` du service. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être ajouté par-dessus.

```bash
gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
```

Les journaux du sidecar backend apparaissent dans le même flux Cloud Logging, étiquetés
avec le nom de son conteneur — filtrez sur `resource.labels.container_name="backend"`
pour les isoler.

---

## 3. Comportement de l'application SparkyFitness {#3-sparkyfitness-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un unique job
  d'initialisation `db-init` (utilisant `postgres:15-alpine`) crée le rôle
  d'**administration** (`db_user`) et la base de données (`db_name`). Il ne crée pas
  `app_db_user` — le backend s'en charge lui-même.
- **Les migrations s'exécutent à chaque démarrage.** Le backend applique ses propres
  migrations de schéma au démarrage à l'aide des identifiants d'administration de
  `db_user` — il n'y a aucune tâche de migration distincte à surveiller.
- **`app_db_user` est autoréparateur.** Le backend crée ou met à jour ce rôle à
  privilèges limités à chaque démarrage ; il survit donc à une recréation complète du
  conteneur sans intervention manuelle.
- **Création du compte au premier lancement.** Inscrivez-vous via l'interface web pour
  créer le premier compte utilisateur. Définissez `admin_email` sur l'adresse e-mail de
  cet utilisateur et redéployez pour lui accorder les privilèges d'administration —
  `SPARKY_FITNESS_ADMIN_EMAIL` ne fait qu'élever un compte **existant**, il n'en crée
  pas.
- **Désactiver l'inscription après la première utilisation.** Définissez
  `disable_signup = true` une fois le compte administrateur créé, afin d'empêcher des
  utilisateurs non authentifiés de s'inscrire eux-mêmes.
- **Chemin de santé.** `GET /api/health` sur le port 3010 (backend) — confirmé par la
  propre directive `HEALTHCHECK` du Dockerfile amont, et non deviné.
- **Secrets immuables.** `BETTER_AUTH_SECRET` ne doit jamais changer une fois que des
  utilisateurs ont activé la 2FA (cela les bloque) ;
  `SPARKY_FITNESS_API_ENCRYPTION_KEY` ne doit jamais changer une fois des sources de
  données externes connectées (cela invalide les identifiants chiffrés).
- **TLS de Cloud SQL.** Le `SPARKY_FITNESS_DB_HOST` du sidecar backend se résout
  toujours vers l'adresse IP privée brute de Cloud SQL sur Cloud Run (le mécanisme
  `additional_containers`/`inherit_app_env` de ce socle utilise toujours l'adresse IP
  brute, quelle que soit la valeur de `enable_cloudsql_volume`), et Cloud SQL refuse
  cette connexion non chiffrée. Les pools `pg` amont ne définissent aucune option `ssl`
  et l'application ne propose aucune variable d'environnement pour l'activer ; l'image
  backend est donc un build personnalisé minimal qui modifie les trois constructeurs
  `pg.Pool` pour activer SSL vers tout hôte autre que la boucle locale (voir
  [SparkyFitness_Common](SparkyFitness_Common.md) §4).
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à SparkyFitness ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `sparkyfitness` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Étiquette À LA FOIS les images frontend et backend de manière identique. Utilisez `latest` ou une étiquette préfixée par `v` exactement telle que publiée en amont (par ex. `v0.17.3` — un `0.17.3` sans préfixe n'existe pas). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources du **sidecar backend**. |
| `min_instance_count` / `max_instance_count` | `0` / `2` | Bornes de mise à l'échelle des instances. |
| `container_port` | `3010` | Port d'écoute du backend dans son sidecar. |
| `cpu_always_allocated` | `false` | Facturation à la requête — aucun travail en arrière-plan n'est nécessaire en régime établi. |
| `enable_cloudsql_volume` | `true` | Voir la remarque sur le TLS de Cloud SQL au §3 — sur Cloud Run, le sidecar backend reçoit toujours l'adresse IP privée brute, quelle que soit la valeur de ce flag. |

### Groupe 5 — Configuration de l'application SparkyFitness {#group-5--sparkyfitness-application-config}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `app_db_user` | `sparky_app` | Nom du rôle d'exécution à privilèges limités, créé par le backend lui-même. |
| `disable_signup` | `false` | Désactive les nouvelles inscriptions en libre-service. |
| `admin_email` | `""` | Accorde les droits d'administration à un utilisateur EXISTANT au démarrage ; ne crée pas le compte. |
| `public_api_docs` | `false` | Expose publiquement la documentation Swagger. |
| `allow_private_network_cors` | `false` | À n'activer que sur un réseau privé. |
| `log_level` | `ERROR` | Niveau de détail des journaux du backend. |
| `timezone` | `Etc/UTC` | Fuseau horaire (TZ) du backend. |

### Groupe 7 — SMTP (facultatif) {#group-7--smtp-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_enabled` | `false` | Active les e-mails de réinitialisation de mot de passe et de notification. |
| `smtp_host` / `smtp_port` / `smtp_user` / `smtp_from` / `smtp_secure` | voir `variables.tf` | Définissez tous les champs ensemble lors de l'activation de SMTP ; fournissez le mot de passe via `secret_environment_variables` (`SPARKY_FITNESS_EMAIL_PASS`). |

### Groupe 13 — Base de données {#group-13--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — aucun autre moteur n'est pris en charge. |
| `db_name` | `sparkyfitness_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `sparky` | Rôle d'administration/de migration — le backend exécute ses propres migrations avec ce rôle. |

### Groupe 15 — Jobs et tâches planifiées {#group-15--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la tâche `db-init` intégrée (rôle d'administration + base de données uniquement). |

### Groupe 16 — Observabilité et santé {#group-16--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/health`, port 3010 | Cible le **backend** ; le conteneur principal frontend reçoit sa propre sonde TCP simple (codée en dur dans le fichier de câblage, non configurable par l'utilisateur). |

### Groupe 17 — Redis (non utilisé nativement) {#group-17--redis-not-used-natively}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | SparkyFitness n'utilise pas Redis ; l'option reste disponible en tant que fonctionnalité générique du socle. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `app_url` | URL de l'application (conteneur frontend/d'entrée) — ouvrez-la dans un navigateur. |
| `backend_url` | Adresse interne en boucle locale du sidecar backend (`http://127.0.0.1:3010`). |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe d'administration de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `container_image` | Image frontend déployée. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `BETTER_AUTH_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation une fois que des utilisateurs ont activé la 2FA | Critique | Sa rotation bloque tous les utilisateurs ayant activé la 2FA. |
| `SPARKY_FITNESS_API_ENCRYPTION_KEY` (généré automatiquement) | Ne jamais effectuer de rotation après la première connexion | Critique | Sa rotation invalide tous les identifiants stockés des sources de données externes. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les modifier recrée la base de données et détruit toutes les données. |
| `application_version` | Utiliser l'étiquette exacte de l'amont (`v0.17.3`) | Élevé | Un `0.17.3` sans préfixe (pas de `v`) n'existe pas en amont — le pull échoue. |
| `admin_email` | À définir uniquement une fois le compte créé | Moyen | Le définir avant l'inscription n'a aucun effet — il élève un compte existant, il n'en crée jamais. |
| `enable_cloudsql_volume` | laisser à `true` | Élevé | Le sidecar backend Cloud Run reçoit toujours l'adresse IP privée brute de Cloud SQL (et non le socket), quelle que soit la valeur de ce flag ; c'est l'image backend modifiée pour SSL qui fait fonctionner cette connexion. |
| `disable_signup` | `true` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `smtp_enabled` | Définir TOUS les champs smtp_* ensemble | Moyen | Un bloc SMTP partiellement configuré peut rendre les e-mails de réinitialisation de mot de passe inopérants. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
SparkyFitness partagée avec la variante GKE est décrite dans
**[SparkyFitness_Common](SparkyFitness_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SparkyFitness sur Cloud Run](../labs/SparkyFitness_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [SparkyFitness sur GKE Autopilot](SparkyFitness_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [SparkyFitness Common — Configuration applicative partagée](SparkyFitness_Common.md) — la configuration partagée par les deux cibles de déploiement.
