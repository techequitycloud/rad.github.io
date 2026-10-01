---
title: "SparkyFitness sur GKE Autopilot"
description: "Référence de configuration pour déployer SparkyFitness sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/SparkyFitness_GKE.md @ 3055034 sha256:b75cbf1b08f7 -->

# SparkyFitness sur GKE Autopilot {#sparkyfitness-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SparkyFitness_GKE.png" alt="SparkyFitness sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

SparkyFitness est un outil auto-hébergé de suivi familial de l'alimentation, de la
forme physique, de l'hydratation et de la santé, assisté par IA, construit sous la
forme d'un backend Node.js/Express (`codewithcj/sparkyfitness_server`) et d'un
frontend React distinct servi par nginx (`codewithcj/sparkyfitness`). Ce module
déploie SparkyFitness sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par SparkyFitness et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
modèle d'espace de noms/de Service, mise à l'échelle, CI/CD, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Contrairement à la variante Cloud Run (qui doit exécuter les deux conteneurs dans un
seul service multiconteneur en raison d'une contrainte de la plateforme Cloud Run —
voir [SparkyFitness_CloudRun](SparkyFitness_CloudRun.md)), GKE n'impose pas HTTPS
entre les Services internes au cluster ; SparkyFitness est donc déployé sous forme de
**deux Deployments/Services distincts**, exactement comme dans le modèle
docker-compose de l'éditeur :

- Le **backend** (`codewithcj/sparkyfitness_server`, port 3010) est l'**application
  principale** — avec le câblage standard Deployment/Service/job d'initialisation du
  socle.
- Le **frontend** (`codewithcj/sparkyfitness`, port 80) est une entrée
  **`additional_services`** : son propre Deployment+Service, avec une **adresse IP
  externe statique réservée de LoadBalancer**, qui joint le backend via son nom DNS
  interne au cluster en HTTP simple.

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot (2 Deployments) | Backend (principal, 2 vCPU/2Gi par défaut) + frontend (`additional_services`, 0,5 vCPU/512Mi) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — aucun autre moteur n'est pris en charge |
| Secrets | Secret Manager → Secret K8s | `SPARKY_FITNESS_API_ENCRYPTION_KEY`, `BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | Adresse IP externe réservée de LoadBalancer (frontend) | Déterministe d'un redéploiement à l'autre — connue au moment du plan |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Aucun autre moteur n'est pris en charge.
- **Deux rôles de base de données, dont un seul géré par Terraform.** `db_user` (par
  défaut `sparky`) est le rôle d'administration/de migration créé par le job
  `db-init` ; `app_db_user` (par défaut `sparky_app`) est un rôle à privilèges limités
  que le **backend crée et entretient lui-même** à chaque démarrage.
- **Pas de job de migration distinct.** Le backend exécute ses propres migrations
  de base de données à chaque démarrage du conteneur.
- **Le Service du backend est toujours exposé sur le port 80**, quelle que soit la
  valeur de `container_port` (3010) — il s'agit d'une convention générale d'App_GKE
  (le port du Service est fixe, targetPort pointe vers le port réel du conteneur). Le
  nginx du frontend est donc câblé pour relayer vers `:80`, et non `:3010`.
- **Une adresse IP statique est toujours réservée pour le LoadBalancer du frontend**,
  afin que l'URL accessible depuis le navigateur (utilisée pour les contrôles CORS de
  `SPARKY_FITNESS_FRONTEND_URL`) soit connue au moment du plan et ne change jamais d'un
  redéploiement à l'autre.
- **L'image frontend est préconstruite ; le backend est un build personnalisé
  minimal.** Le backend hérite de l'`image_source = "custom"` de `SparkyFitness_Common`
  (un Dockerfile qui modifie ses constructeurs `pg.Pool` pour le SSL de Cloud SQL) ;
  une étape Cloud Build s'exécute donc pour lui ; `container_image_source` est
  volontairement laissé non défini ici pour que cette configuration soit transmise.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT`, `REGION` et `NAMESPACE` sont définis (le
nom de l'espace de noms figure dans les [Sorties](#5-outputs) du déploiement).

### A. GKE Autopilot — les charges de travail SparkyFitness {#a-gke-autopilot--the-sparkyfitness-workloads}

Deux Deployments s'exécutent dans le même espace de noms : le backend (application
principale) et le frontend (`additional_services`).

- **Console :** Kubernetes Engine → Workloads → filtrez par espace de noms.
- **CLI :**
  ```bash
  kubectl get deployments -n "$NAMESPACE"
  kubectl get pods -n "$NAMESPACE"
  kubectl get services -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deployment/<backend-deployment> --tail=100
  kubectl logs -n "$NAMESPACE" deployment/<frontend-deployment> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la mise à l'échelle, les quotas de ressources et
le comportement des déploiements progressifs.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

SparkyFitness stocke toutes les données de l'application dans une instance gérée
Cloud SQL for PostgreSQL 15. Le backend (application principale) se connecte via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` lorsque
`enable_cloudsql_volume = true` (valeur par défaut).

```bash
gcloud sql instances list --project "$PROJECT"
gcloud sql instances describe <instance-name> --project "$PROJECT"
gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager / Secrets Kubernetes {#c-secret-manager--kubernetes-secrets}

Trois secrets cryptographiques sont générés dans Secret Manager et matérialisés sous
forme de Secret Kubernetes pour le pod backend : `SPARKY_FITNESS_API_ENCRYPTION_KEY`,
`BETTER_AUTH_SECRET`, `SPARKY_FITNESS_APP_DB_PASSWORD`.

```bash
gcloud secrets list --project "$PROJECT" --filter="name~sparkyfitness"
kubectl get secret -n "$NAMESPACE"
```

### D. Réseau et LoadBalancer du frontend {#d-networking--the-frontend-loadbalancer}

Le Service du frontend est un `LoadBalancer` associé à une adresse IP externe statique
réservée.

```bash
kubectl get service <frontend-service> -n "$NAMESPACE" -o wide
gcloud compute addresses list --project "$PROJECT" --filter="name~frontend-ip"
```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application SparkyFitness {#3-sparkyfitness-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un unique job
  d'initialisation `db-init` crée uniquement le rôle d'**administration** (`db_user`)
  et la base de données (`db_name`).
- **Les migrations s'exécutent à chaque démarrage.** Le backend applique ses propres
  migrations de schéma au démarrage à l'aide des identifiants d'administration de
  `db_user`.
- **`app_db_user` est autoréparateur.** Le backend crée ou met à jour ce rôle à
  privilèges limités à chaque démarrage.
- **Création du compte au premier lancement.** Inscrivez-vous via l'URL du frontend
  pour créer le premier compte utilisateur, puis définissez `admin_email` et
  redéployez pour accorder les privilèges d'administration.
- **Désactiver l'inscription après la première utilisation.** Définissez
  `disable_signup = true` une fois le compte administrateur créé.
- **Chemin de santé.** `GET /api/health` sur le port 3010 (backend) — confirmé par la
  propre directive `HEALTHCHECK` du Dockerfile amont.
- **Adresse IP réservée du LB frontend.** `public_uri` remplace l'URL
  `http://<reserved-ip>` dérivée automatiquement par un domaine personnalisé —
  définissez cette variable ainsi que l'enregistrement DNS du domaine, puis redéployez.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/db-init
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à SparkyFitness ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `sparkyfitness` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Étiquette les DEUX images de manière identique. Utilisez `latest` ou une étiquette préfixée par `v` exactement telle que publiée en amont (par ex. `v0.17.3`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` / `memory_limit` | `2000m` / `2Gi` | Limites de ressources du **backend** (application principale). |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Bornes de mise à l'échelle des réplicas. |
| `container_port` | `3010` | Port d'écoute du backend. |

### Groupe 5 — Configuration de l'application SparkyFitness {#group-5--sparkyfitness-application-config}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `public_uri` | `""` | Remplacement de l'URL du frontend par un domaine personnalisé. Laissez vide pour utiliser automatiquement l'adresse IP statique réservée du LB. |
| `app_db_user` | `sparky_app` | Rôle d'exécution à privilèges limités, créé par le backend lui-même. |
| `disable_signup` | `false` | Désactive les nouvelles inscriptions en libre-service. |
| `admin_email` | `""` | Accorde les droits d'administration à un utilisateur EXISTANT au démarrage. |
| `log_level` / `timezone` | `ERROR` / `Etc/UTC` | Niveau de détail des journaux / fuseau horaire (TZ) du backend. |

### Groupe 7 — SMTP (facultatif) {#group-7--smtp-optional}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_enabled` | `false` | Active les e-mails de réinitialisation de mot de passe et de notification ; définissez tous les champs `smtp_*` ensemble. |

### Groupe 11 — Jobs et services {#group-11--jobs--services}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `additional_services` | `[]` | Le frontend est déjà inclus automatiquement ; utilisez ce paramètre pour tout service SUPPLÉMENTAIRE. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/health`, port 3010 | Cible le backend (application principale). |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `sparkyfitness_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `sparky` | Rôle d'administration/de migration. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — se résout vers la boucle locale `127.0.0.1` (aucun TLS nécessaire). |

### Groupe 21 — Redis (non utilisé nativement) {#group-21--redis-not-used-natively}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | SparkyFitness n'utilise pas Redis nativement ; le câblage Redis générique du socle est volontairement laissé activé comme capacité pour les futures versions du backend. Définissez-le à `false` pour éviter de provisionner un cache que rien ne lit. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes du backend. |
| `namespace` | Espace de noms Kubernetes. |
| `frontend_url` | URL du frontend accessible depuis le navigateur — ouvrez-la pour accéder à l'application. |
| `backend_cluster_url` | URL interne au cluster de l'API backend. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants Cloud SQL. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe d'administration de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
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
| Port cible du proxy frontend | `80` (fixé par App_GKE), et non `container_port` | Élevé | Pointer le `SPARKY_FITNESS_SERVER_PORT` du frontend vers `3010` vise un écouteur de Service inexistant — chaque appel `/api` reste bloqué. |
| `application_version` | Utiliser l'étiquette exacte de l'amont (`v0.17.3`) | Élevé | Un `0.17.3` sans préfixe (pas de `v`) n'existe pas en amont — le pull échoue. |
| `admin_email` | À définir uniquement une fois le compte créé | Moyen | Le définir avant l'inscription n'a aucun effet. |
| `disable_signup` | `true` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à quiconque dispose de l'URL de créer un compte. |
| `public_uri` | À définir en même temps qu'un DNS réel lors de l'utilisation d'un domaine personnalisé | Moyen | Un `public_uri` injoignable ou incohérent casse les contrôles CORS et d'origine de session. |

---

Pour le comportement du socle évoqué tout au long de cette page — modèle d'espace de
noms, mise à l'échelle, entrée, CI/CD, IAP, Binary Authorization, VPC-SC, sauvegardes
et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à SparkyFitness partagée avec la variante Cloud Run est décrite dans
**[SparkyFitness_Common](SparkyFitness_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : SparkyFitness sur GKE Autopilot](../labs/SparkyFitness_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [SparkyFitness sur Google Cloud Run](SparkyFitness_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [SparkyFitness Common — Configuration applicative partagée](SparkyFitness_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) dans la solution **Home & Life Management**.
