---
title: "Spoolman sur GKE Autopilot"
description: "Référence de configuration pour déployer Spoolman sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Spoolman_GKE.md @ 3055034 sha256:eebc420bd898 -->

# Spoolman sur GKE Autopilot {#spoolman-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Spoolman_GKE.png" alt="Spoolman sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Spoolman est un outil gratuit et open source de suivi de l'inventaire et de la
consommation des bobines de filament d'impression 3D — fournisseurs, matériaux,
poids restant, coût par bobine et consommation par impression. Il est livré sous
la forme d'un backend Python/FastAPI à processus unique, accompagné d'un frontend
statique Vue/Quasar intégré. Ce module déploie Spoolman sur **GKE Autopilot**
au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Spoolman et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et en ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Spoolman s'exécute dans un unique pod Python/FastAPI — il n'y a pas de charge de
travail frontend distincte ; l'interface Vue/Quasar est intégrée et servie par le
même processus. Le déploiement assemble un ensemble minimal de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Image préconstruite `ghcr.io/donkie/spoolman`, 1 vCPU / 512Mi par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — ce module se standardise sur Postgres (Spoolman en amont prend aussi en charge MySQL/SQLite/CockroachDB) |
| Stockage objet | Aucun | Spoolman conserve tout son état dans Postgres ; aucun bucket GCS n'est provisionné |
| Cache | Aucun | Spoolman n'a aucune intégration Redis/cache |
| Secrets | Secret Manager | Uniquement le mot de passe de base de données généré automatiquement — Spoolman n'a aucun secret d'amorçage administrateur/clé API qui lui soit propre |
| Entrée | Cloud Load Balancing | LoadBalancer externe par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur pris en charge par ce module.** `database_type`
  est fixé par `Spoolman_Common` ; Spoolman en amont prend aussi en charge MySQL et
  CockroachDB via des variables d'environnement, mais ce module n'expose pas ce choix.
- **Aucun build personnalisé.** `container_image_source = "prebuilt"` déploie
  directement `ghcr.io/donkie/spoolman` — pas de Dockerfile, pas d'étape Cloud Build.
- **Aucun job d'initialisation.** Le socle crée automatiquement le rôle et la base
  de données Postgres ; Spoolman exécute automatiquement ses propres migrations
  Alembic à chaque démarrage du conteneur.
- **Aucun secret applicatif.** Spoolman est livré **sans aucune authentification** —
  quiconque peut atteindre le Service dispose d'un accès complet en lecture/écriture
  à l'inventaire. Il n'y a aucune page de connexion à amorcer et rien n'est généré
  dans Secret Manager en dehors du mot de passe de base de données. Si cela n'est pas
  acceptable, placez le service derrière IAP (`enable_iap = true`) ou une liste
  d'adresses IP autorisées Cloud Armor.
- **`service_type = "LoadBalancer"` par défaut.** Spoolman est une interface web
  pilotée depuis le navigateur ; le Service est donc accessible de l'extérieur dès
  l'installation.
- **`reserve_static_ip = false` par défaut.** Spoolman n'intègre aucune URL
  autoréférente dans sa configuration au démarrage (seule `SPOOLMAN_CORS_ORIGIN`
  compte, et uniquement pour un accès inter-domaines) ; ce module préserve donc le
  quota d'adresses IP statiques du projet, souvent serré, en n'en réservant aucune.
- **Les connexions utilisent la boucle locale du sidecar cloud-sql-proxy, et non
  TCP.** La couche SQLAlchemy de Spoolman construit sa connexion via `URL.create()`
  (un objet structuré, et non une concaténation de chaînes), de sorte que `127.0.0.1`
  passe sans encombre, sans problème d'analyse d'URL et sans qu'aucune configuration
  TLS/`sslmode` soit nécessaire.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Spoolman {#a-gke-autopilot--the-spoolman-workload}

Spoolman s'exécute sous la forme d'un unique Deployment/pod sur Autopilot, qui
facture le CPU et la mémoire effectivement demandés par le pod.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Spoolman pour consulter les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot et de la mise à l'échelle.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Spoolman stocke toutes les données d'inventaire (bobines, filaments, fournisseurs,
historique de consommation) dans une instance gérée Cloud SQL for PostgreSQL 15.
Le pod y accède de manière privée via le sidecar **Cloud SQL Auth Proxy** sur la
boucle locale ; aucune adresse IP publique n'est exposée. Il n'y a pas de job
d'initialisation — Spoolman applique ses propres migrations de schéma à chaque
démarrage.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le mot de passe de base de données généré automatiquement réside dans Secret
Manager — Spoolman n'a ni compte administrateur ni clé API propre à amorcer.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~spoolman"
  gcloud secrets versions access latest --secret=<db-password-secret> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le Service est accessible par défaut à l'adresse IP de son LoadBalancer externe
(`service_type = "LoadBalancer"`, `reserve_static_ip = false`, de sorte que
l'adresse IP est éphémère, sauf modification).

- **Console :** Kubernetes Engine → Services & Ingress.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, le CDN et Cloud Armor.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de GKE
et de Cloud SQL sont envoyées vers Cloud Monitoring, avec des tests de disponibilité
et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

---

## 3. Comportement de l'application Spoolman {#3-spoolman-application-behaviour}

- **Aucun job de configuration de la base de données au premier déploiement.**
  Contrairement à la plupart des modules applicatifs de ce catalogue, Spoolman n'a
  besoin d'aucun job `db-init` — le socle crée le rôle et la base de données Postgres,
  et les migrations Alembic propres à Spoolman s'exécutent automatiquement à chaque
  démarrage du conteneur (y compris le tout premier).
- **Aucune authentification.** Il n'y a ni page de connexion, ni compte
  administrateur, ni contrôle par clé API. Quiconque peut atteindre le Service peut
  consulter et modifier l'intégralité de l'inventaire. Choisissez votre approche de
  contrôle d'accès (IAP, liste d'adresses autorisées Cloud Armor, ou acceptation d'un
  accès public en lecture/écriture) avant d'exposer l'adresse IP du LoadBalancer.
- **Chemin de santé.** `/api/health` est public et non authentifié ; il renvoie un
  statut JSON 200/OK une fois le serveur (et sa connexion à la base de données)
  opérationnel. Les sondes de démarrage et de vivacité ciblent toutes deux ce chemin.
- **Moteur de base de données verrouillé sur Postgres.** La variable d'environnement
  `SPOOLMAN_DB_TYPE` propre à Spoolman sélectionne le moteur ; ce module la fixe
  toujours à `postgres`. Ne la supprimez jamais via `environment_variables` — sans
  elle, Spoolman se rabat silencieusement sur un fichier SQLite jetable, local au
  conteneur, sans la moindre erreur.
- **Inspecter la connectivité Cloud SQL :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -i spoolman_db
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Spoolman ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `spoolman` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Spoolman` | Nom lisible. |
| `application_version` | `latest` | Étiquette de l'image récupérée depuis `ghcr.io/donkie/spoolman`. Réellement préconstruite — aucune préoccupation d'épinglage de Dockerfile/build-arg. |

### Groupe 4 — Conteneur et mise à l'échelle {#group-4--container--scale}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Transmis au socle — obligatoire, sinon la valeur par défaut `"custom"` déclenche silencieusement une tentative de build Kaniko sans Dockerfile. |
| `container_port` | `8000` | Port d'écoute par défaut de Spoolman. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Largement suffisant pour un outil de suivi de filament mono-locataire. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | La mise à l'échelle jusqu'à zéro est sûre — Spoolman n'effectue aucun travail en arrière-plan. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_host_env_var_name` | `SPOOLMAN_DB_HOST` | Alias de `DB_HOST` du socle (`127.0.0.1` via le sidecar cloud-sql-proxy sur GKE). |
| `db_user_env_var_name` | `SPOOLMAN_DB_USERNAME` | Alias de `DB_USER`. |
| `db_password_env_var_name` | `SPOOLMAN_DB_PASSWORD` | Alias de `DB_PASSWORD`. |
| `db_name_env_var_name` | `SPOOLMAN_DB_NAME` | Alias de `DB_NAME`. |
| `db_port_env_var_name` | `SPOOLMAN_DB_PORT` | Alias de `DB_PORT`. |
| `application_database_name` / `application_database_user` | `spoolman` / `spoolman` | Immuables après le premier déploiement. |

### Groupe 14 — Stockage et système de fichiers {#group-14--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Aucun bucket GCS nécessaire — tout l'état réside dans Cloud SQL. |
| `enable_nfs` | `false` | Aucun système de fichiers partagé nécessaire. |

### Groupe 19 — Réseau {#group-19--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Spoolman est une interface web pilotée depuis le navigateur, exposée à l'extérieur par défaut. |
| `reserve_static_ip` | `false` | Préserve le quota d'adresses IP statiques du projet ; Spoolman n'intègre aucune URL autoréférente dans sa configuration au démarrage. |

### Groupe 10 — Sondes et cycle de vie {#group-10--probes--lifecycle}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/api/health`, délai de 10s | Public, non authentifié. |
| `health_check_config` | HTTP `/api/health`, période de 30s | Public, non authentifié. |

Toutes les autres entrées (CI/CD, sauvegardes, VPC-SC, Cloud Armor, IAP, Redis, PVC
avec état) sont héritées de [App_GKE](App_GKE.md) avec leur comportement standard —
Spoolman n'en utilise aucune par défaut.

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP interne. |
| `service_external_ip` | Adresse IP externe du LoadBalancer. |
| `service_url` | URL complète de la charge de travail déployée. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Toujours vide — Spoolman n'a besoin d'aucun bucket GCS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry (lorsque la duplication est activée). |
| `monitoring_enabled` | Statut de la supervision. |
| `initialization_jobs` | Toujours vide — Spoolman n'a besoin d'aucun job d'initialisation. |
| `kubernetes_ready` | Indique si la charge de travail se déclare prête. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Aucune authentification (intégrée) | Placer derrière IAP ou Cloud Armor si nécessaire | Critical | Quiconque peut atteindre le Service peut lire et modifier l'intégralité de l'inventaire de filament — il n'existe aucune page de connexion à désactiver. |
| `SPOOLMAN_DB_TYPE` (injectée automatiquement à `postgres`) | Ne jamais la supprimer via `environment_variables` | Critical | La supprimer provoque un repli silencieux sur un fichier SQLite jetable, local au conteneur — aucune erreur, et toutes les données sont perdues à chaque redémarrage du pod. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` (ne pas remplacer par `custom`) | Critical | Définir `"custom"` déclenche une tentative de build Kaniko sur un module dépourvu de Dockerfile — le build échoue purement et simplement. |
| `service_type` | `LoadBalancer` (valeur par défaut) | High | Passer à `ClusterIP` rend le service inaccessible depuis un navigateur sans `kubectl port-forward` ou une entrée distincte. |
| `SPOOLMAN_DB_QUERY` | Laisser vide, sauf pour un dépannage | Medium | Échappatoire pour un repli TCP + `sslmode` — nécessaire uniquement si le chemin de connexion par boucle locale s'avérait un jour peu fiable ; inutile en fonctionnement normal. |
| `reserve_static_ip` | `false` (valeur par défaut) | Low | Définissez `true` uniquement si vous avez besoin d'une adresse IP stable pour le DNS ou une liste d'autorisation de pare-feu — le quota d'adresses IP statiques du projet est limité et partagé au sein du locataire. |
| `min_instance_count` | `0` (valeur par défaut) | Low | Spoolman n'effectue aucun travail en arrière-plan, la mise à l'échelle jusqu'à zéro est donc sûre. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
mise à l'échelle, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Spoolman, partagée
avec la variante Cloud Run, est décrite dans
**[Spoolman_Common](Spoolman_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Spoolman sur GKE Autopilot](../labs/Spoolman_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Spoolman sur Google Cloud Run](Spoolman_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Spoolman Common — Configuration applicative partagée](Spoolman_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Grocy sur GKE Autopilot](Grocy_GKE.md), [Mealie sur GKE Autopilot](Mealie_GKE.md), [Homebox sur GKE Autopilot](Homebox_GKE.md), [Wallos sur GKE Autopilot](Wallos_GKE.md) dans la solution **Home & Life Management**.
