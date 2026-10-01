---
title: "Healthchecks sur GKE Autopilot"
description: "Référence de configuration pour déployer Healthchecks sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Healthchecks_GKE.md @ 3055034 sha256:c943b6794c9d -->

# Healthchecks sur GKE Autopilot {#healthchecks-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Healthchecks_GKE.png" alt="Healthchecks sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Healthchecks est un service open source et auto-hébergé de supervision des tâches
cron et des signaux de vie (heartbeat) : les tâches planifiées lui envoient un
« ping » en cas de succès, et il vous alerte par e-mail, Slack, SMS ou via plus de
100 autres intégrations lorsqu'un ping est en retard ou manquant. Ce module
déploie Healthchecks sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Healthchecks et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Healthchecks s'exécute comme un Pod Django/uWSGI. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod uWSGI, 1 vCPU / 512 MiB par défaut, réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — la variable d'environnement `DB` est explicitement définie à `postgres`, ce qui remplace le repli SQLite de l'image |
| Secrets | Secret Manager | `SECRET_KEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire**, et `DB = "postgres"` est défini
  explicitement. Sinon, l'image amont se rabat silencieusement sur une base
  SQLite jetable, locale au conteneur, sans aucune erreur.
- **L'image de conteneur est réellement préconstruite**
  (`healthchecks/healthchecks`) — `container_image_source` vaut `"prebuilt"` par
  défaut, ce qui a été vérifié à la fois dans sa propre valeur par défaut ET dans
  la transmission de `main.tf` (un module qui se trompe sur l'un ou l'autre
  construit à partir d'un Dockerfile inexistant ou déploie silencieusement la
  mauvaise image — voir le précédent de Prowlarr_GKE dans ce catalogue).
- **Aucune mise à zéro n'est à gérer sur GKE.** Contrairement à la variante Cloud
  Run, un Deployment GKE exécute simplement en continu le nombre de réplicas
  configuré, de sorte que la boucle d'alerte `sendalerts`/`sendreports`
  colocalisée est toujours active sans aucune configuration supplémentaire — il
  n'existe pas d'équivalent GKE à `cpu_always_allocated`.
- **Aucun endpoint de santé dédié.** Les sondes de démarrage et de vivacité
  ciblent `/` (la page de connexion publique). `ALLOWED_HOSTS = "*"` est défini
  afin que l'en-tête Host des sondes internes du kubelet ne soit jamais rejeté
  par la validation d'hôte de Django.
- **Le compte administrateur initial est créé une seule fois**, sans
  auto-réparation. Un Job d'initialisation `admin-bootstrap` exécute les
  migrations et crée le superutilisateur (`admin_email` / un mot de passe Secret
  Manager généré) via la commande Django standard `createsuperuser --noinput`.
  Comme l'ordonnancement des jobs d'initialisation de GKE n'est pas aussi strict
  que celui de Cloud Run (un job peut être planifié avant le tout premier
  démarrage du Deployment principal), le job exécute d'abord sa propre migration
  au lieu de supposer que le schéma existe déjà.
- **L'e-mail sortant est un espace réservé par défaut.** `DEFAULT_FROM_EMAIL` vaut
  `healthchecks@example.org` par défaut. Configurez de vrais `EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` après le déploiement, faute de quoi les alertes ne seront
  pas réellement remises.
- **Pas de Redis, pas de stockage objet.** Healthchecks stocke tout son état —
  vérifications, pings, utilisateurs, configuration des alertes — dans
  PostgreSQL uniquement.
- **`service_type = LoadBalancer` et `reserve_static_ip = true`** — Healthchecks
  est une interface web utilisée dans un navigateur ; il obtient donc par défaut
  une IP publique stable.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Healthchecks {#a-gke-autopilot--the-healthchecks-workload}

Healthchecks s'exécute comme un Deployment à réplica unique sur Autopilot, qui
facture le CPU et la mémoire que le pod demande réellement.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Healthchecks pour consulter les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour l'ordonnancement Autopilot et le type de
charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Healthchecks stocke toutes les données applicatives (vérifications, pings,
intégrations, utilisateurs, historique des alertes) dans une instance gérée
Cloud SQL pour PostgreSQL 15. Les pods s'y connectent de manière privée via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1`. Lors du premier déploiement,
des Jobs d'initialisation créent la base de données et le rôle de l'application,
puis créent le compte administrateur initial.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe figurent tous dans les
[Outputs](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques
et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Deux valeurs cryptographiques sont générées automatiquement et stockées dans
Secret Manager : `SECRET_KEY` (clé de signature des sessions/CSRF de Django) et
`ADMIN_PASSWORD` (le mot de passe initial du superutilisateur, défini une seule
fois). Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load
Balancing, réservée en tant qu'IP statique afin que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés
et l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (y compris celles des workers d'arrière-plan
colocalisés `sendalerts`/`sendreports`) sont envoyées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont envoyées vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Healthchecks {#3-healthchecks-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job
  d'initialisation `db-init` s'exécute avec `postgres:15-alpine` et se connecte
  via le Cloud SQL Auth Proxy pour créer de manière idempotente le rôle et la base
  de données de l'application.
- **Amorçage du compte administrateur.** Le Job `admin-bootstrap` (qui utilise
  l'image Healthchecks elle-même) exécute `manage.py migrate --noinput`, puis `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (mot de passe
  issu d'un secret Secret Manager généré). Le paramètre `execute_on_apply` de GKE
  détermine seulement si Terraform *attend* le job, et non si Kubernetes le
  planifie immédiatement — le job reproduit donc lui-même l'étape de migration au
  lieu de supposer que le Deployment principal a déjà démarré et effectué la
  migration.
- **Les migrations de base de données s'exécutent aussi à chaque démarrage
  normal du conteneur** du Deployment principal (le `uwsgi.ini` de l'image intègre `hook-pre-app = exec:./manage.py
  migrate`), de sorte que la mise à niveau d'`application_version` applique
  automatiquement les changements de schéma.
- **La boucle d'arrière-plan `sendalerts`/`sendreports` est colocalisée dans le
  même conteneur**, démarrée automatiquement par le `uwsgi.ini` propre à l'image
  aux côtés du serveur web — il n'existe pas de Deployment worker distinct. Comme
  les Deployments GKE ne se mettent pas à zéro d'eux-mêmes, cette boucle s'exécute
  en continu tant que le Deployment compte au moins un réplica (la valeur par
  défaut).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` —
  Healthchecks n'a pas d'endpoint de santé dédié ; la page de connexion racine
  répond toujours sans authentification et renverrait une erreur 500 (au lieu de
  s'afficher) si la connexion à la base de données était rompue.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Healthchecks ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `healthchecks` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `admin_email` | `admin@techequity.cloud` | E-mail/nom d'utilisateur du superutilisateur initial, créé une seule fois. |
| `default_from_email` | `healthchecks@example.org` | Adresse d'expéditeur provisoire, jusqu'à la configuration d'un vrai SMTP. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | L'image officielle ne nécessite aucun build personnalisé. |
| `container_image` | `""` | Laissez vide pour utiliser `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | Le serveur uWSGI de l'image amont écoute sur ce port (`docker/uwsgi.ini`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — `DB_HOST` se résout en `127.0.0.1`, que la variable d'environnement distincte accepte telle quelle. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interface web publique — exposée en externe par défaut. |
| `workload_type` | `null` (effectif : `Deployment`) | Sans état — tout l'état réside dans PostgreSQL. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Valeur par défaut héritée. Healthchecks n'a besoin d'aucun système de fichiers partagé ; définissez-la donc à `false` lors du déploiement. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Inutilisé — Healthchecks n'a pas d'intégration Redis documentée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixée ; MySQL/SQLite ne sont pas pris en charge par ce module. |
| `application_database_name` | `healthchecks_db` | Immuable après le premier déploiement. |
| `application_database_user` | `healthchecks_user` | Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |

---

## 5. Outputs {#5-outputs}

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_external_ip` | IP externe du LoadBalancer. |
| `service_url` | URL permettant de joindre Healthchecks. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Endpoint de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `DB` (défini automatiquement) | `"postgres"` | Critical | S'il n'était pas défini pour une raison quelconque, l'application utiliserait silencieusement une base SQLite locale jetable — les vérifications et l'historique des alertes disparaîtraient à chaque redémarrage, sans aucune erreur. |
| `container_image_source` | `prebuilt` | Critical | Passer à `custom` sans Dockerfile dans `Healthchecks_Common/scripts` fait échouer le build Kaniko. |
| `ADMIN_PASSWORD` (généré automatiquement) | Récupérez-le une fois, puis changez-le via l'interface | Medium | Le mot de passe initial n'est défini que lors de la PREMIÈRE exécution réussie d'`admin-bootstrap` ; relancer le job ne le met pas à jour. |
| `DEFAULT_FROM_EMAIL` / variables SMTP | Configurez un vrai SMTP après le déploiement | High | Si la valeur provisoire par défaut est conservée, `sendalerts` journalise des erreurs de remise au lieu de réellement avertir qui que ce soit d'un signalement manqué. |
| `ALLOWED_HOSTS` (défini automatiquement à `"*"`) | Laissez tel quel, sauf raison particulière | Low | Désactiver entièrement la validation de l'en-tête Host de Django est ici un compromis accepté pour que les sondes de santé de la plateforme continuent de fonctionner. |
| `application_database_name` / `application_database_user` | Définissez-les une fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Healthchecks,
partagée avec la variante Cloud Run, est décrite dans
**[Healthchecks_Common](Healthchecks_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Healthchecks sur GKE Autopilot](../labs/Healthchecks_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Healthchecks Common — Configuration applicative partagée](Healthchecks_Common.md) — la configuration partagée par les deux cibles de déploiement.
