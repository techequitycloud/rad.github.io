---
title: "Healthchecks sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Healthchecks sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Healthchecks_GKE.md @ 15fd4c7 sha256:ceed55217587 -->

# Healthchecks sur GKE Autopilot {#healthchecks-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Healthchecks_GKE.png" alt="Healthchecks sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Healthchecks est un service open source et auto-hébergé de surveillance de jobs cron et de battements de cœur : les tâches planifiées le « pingent » en cas de succès, et il vous alerte par e-mail, Slack, SMS ou via plus de 100 autres intégrations lorsqu'un ping est en retard ou manquant. Ce module déploie Healthchecks sur **GKE Autopilot** en s'appuyant sur la fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Healthchecks et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Healthchecks s'exécute en tant que Pod Django/uWSGI. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod uWSGI, 1 vCPU / 512 Mio par défaut, réplica unique |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — la variable d'environnement `DB` est explicitement définie sur `postgres`, annulant le repli SQLite de l'image |
| Secrets | Secret Manager | `SECRET_KEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | Équilibreur de charge externe avec une IP statique réservée par défaut |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire**, et `DB = "postgres"` est défini explicitement. L'image
  amont se replie sinon silencieusement sur une base de données SQLite locale au conteneur, jetable, sans erreur.
- **L'image du conteneur est véritablement pré-construite** (`healthchecks/healthchecks`) —
  `container_image_source` est par défaut `"prebuilt"`, vérifié à la fois dans sa propre
  valeur par défaut ET dans le `main.tf` (un module qui se trompe sur l'un ou l'autre
  construit à partir d'un Dockerfile inexistant ou déploie silencieusement la mauvaise
  image — voir le précédent Prowlarr_GKE dans ce catalogue).
- **Pas de mise à l'échelle à zéro nécessaire sur GKE.** Contrairement à la variante Cloud Run, un déploiement GKE
  exécute simplement son nombre de réplicas configuré en continu, de sorte que la boucle d'alerte
  `sendalerts`/`sendreports` co-localisée est toujours active sans configuration
  supplémentaire — il n'y a pas d'équivalent GKE de `cpu_always_allocated`.
- **Pas de point de terminaison de santé dédié.** Les sondes de démarrage/vivacité ciblent `/` (la
  page de connexion publique). `ALLOWED_HOSTS = "*"` est défini de sorte que l'en-tête Host de la
  sonde interne du kubelet ne soit jamais rejeté par la validation d'hôte de Django.
- **Le compte administrateur initial est amorcé une seule fois**, il n'est pas auto-réparateur. Un
  job d'initialisation `admin-bootstrap` exécute les migrations et crée le superutilisateur
  (`admin_email` / un mot de passe Secret Manager généré) via le
  `createsuperuser --noinput` standard de Django. Étant donné que l'ordre des jobs d'initialisation de GKE n'est pas aussi strict
  que celui de Cloud Run (un job peut être planifié avant le premier démarrage du déploiement principal),
  le job exécute sa propre migration en premier plutôt que de supposer que le schéma
  existe déjà.
- **L'e-mail sortant est un espace réservé par défaut.** `DEFAULT_FROM_EMAIL` est par défaut
  `healthchecks@example.org`. Configurez de vrais `EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` après le déploiement, sinon les alertes ne seront pas réellement livrées.
- **Pas de Redis, pas de stockage d'objets.** Healthchecks stocke tout l'état — vérifications,
  pings, utilisateurs, configuration d'alerte — uniquement dans PostgreSQL.
- **`service_type = LoadBalancer` et `reserve_static_ip = true`** — Healthchecks
  est une interface utilisateur web accessible par navigateur, il obtient donc une IP publique stable par défaut.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Healthchecks {#a-gke-autopilot--the-healthchecks-workload}

Healthchecks s'exécute en tant que déploiement à réplica unique sur Autopilot, qui facture le CPU/la mémoire réellement demandés par le pod.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Healthchecks pour les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la planification Autopilot et le type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Healthchecks stocke toutes les données d'application (vérifications, pings, intégrations, utilisateurs, historique des alertes) dans une instance Cloud SQL gérée pour PostgreSQL 15. Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1`. Lors du premier déploiement, les jobs d'initialisation créent la base de données/le rôle de l'application et amorcent le compte administrateur initial.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Secret Manager {#c-secret-manager}

Deux valeurs cryptographiques sont générées automatiquement et stockées dans Secret Manager : `SECRET_KEY` (clé de signature de session/CSRF Django) et `ADMIN_PASSWORD`
(le mot de passe initial du superutilisateur, amorcé une fois). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~healthchecks"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing, réservée en tant qu'adresse IP statique afin que l'adresse survive aux redéploiements.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés et les adresses IP statiques.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (y compris les workers d'arrière-plan `sendalerts`/`sendreports` co-localisés) sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Healthchecks {#3-healthchecks-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job d'initialisation `db-init` s'exécute en utilisant
  `postgres:15-alpine`, se connectant via le Cloud SQL Auth Proxy pour
  créer de manière idempotente le rôle et la base de données de l'application.
- **Amorçage du compte administrateur.** Le job `admin-bootstrap` (utilisant l'image Healthchecks
  elle-même) exécute `manage.py migrate --noinput`, puis `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (mot de passe
  à partir d'un secret Secret Manager généré). Le paramètre `execute_on_apply` de GKE ne
  fait que déterminer si Terraform *attend* le job, et non si Kubernetes le planifie
  immédiatement — le job réplique donc l'étape de migration elle-même plutôt que
  de supposer que le déploiement principal a déjà démarré et migré.
- **Les migrations de base de données s'exécutent également à chaque démarrage normal du conteneur** du déploiement principal (le `uwsgi.ini` de l'image a `hook-pre-app = exec:./manage.py
  migrate` intégré), de sorte que la mise à niveau de `application_version` applique automatiquement les modifications de schéma.
- **La boucle d'arrière-plan `sendalerts`/`sendreports` est co-localisée dans le même
  conteneur**, démarrée automatiquement par le `uwsgi.ini` de l'image
  à côté du serveur web — il n'existe pas de déploiement de worker séparé. Étant donné que les déploiements GKE
  ne se mettent pas à l'échelle à zéro d'eux-mêmes, cette boucle s'exécute en continu tant que le
  déploiement a au moins un réplica (la valeur par défaut).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — Healthchecks n'a pas
  de point de terminaison de santé dédié ; la page de connexion racine répond toujours sans authentification
  et renverrait une erreur 500 (ne s'afficherait pas) si la connexion à la base de données était interrompue.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Healthchecks sont listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `healthchecks` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `admin_email` | `admin@techequity.cloud` | E-mail/nom d'utilisateur du superutilisateur initial, amorcé une fois. |
| `default_from_email` | `healthchecks@example.org` | Adresse d'expéditeur de remplacement jusqu'à ce qu'un SMTP réel soit configuré. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | L'image officielle n'a pas besoin de build personnalisé. |
| `container_image` | `""` | Laisser vide pour utiliser `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | Le serveur uWSGI de l'image amont se lie ici (`docker/uwsgi.ini`). |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy — `DB_HOST` se résout en `127.0.0.1`, que la variable d'environnement discrète accepte telle quelle. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Interface utilisateur web publique — exposée en externe par défaut. |
| `workload_type` | `null` (effectif : `Deployment`) | Sans état — tout l'état réside dans PostgreSQL. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Valeur par défaut héritée. Healthchecks n'a pas besoin de système de fichiers partagé, donc définissez-le sur `false` lors du déploiement. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé — Healthchecks n'a pas d'intégration Redis documentée. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixe ; MySQL/SQLite ne sont pas câblés via ce module. |
| `application_database_name` | `healthchecks_db` | Immuable après le premier déploiement. |
| `application_database_user` | `healthchecks_user` | Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable à travers les redéploiements. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_external_ip` | IP de l'équilibreur de charge externe. |
| `service_url` | URL pour atteindre Healthchecks. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom de la base de données / utilisateur de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `DB` (défini automatiquement) | `"postgres"` | Critique | Si, pour une raison quelconque, il n'est pas défini, l'application utilise silencieusement une base de données SQLite locale jetable — les vérifications et l'historique des alertes disparaissent à chaque redémarrage, sans erreur. |
| `container_image_source` | `prebuilt` | Critique | Passer à `custom` sans Dockerfile dans `Healthchecks_Common/scripts` fait échouer le build Kaniko. |
| `ADMIN_PASSWORD` (généré automatiquement) | Récupérer une fois, faire pivoter via l'interface utilisateur après | Moyen | Le mot de passe amorcé n'est défini qu'une seule fois lors de la PREMIÈRE exécution réussie de `admin-bootstrap` ; la réexécution du job ne le met pas à jour. |
| `DEFAULT_FROM_EMAIL` / variables SMTP | Configurer un SMTP réel après le déploiement | Élevé | Laissé à la valeur par défaut de l'espace réservé, `sendalerts` enregistre les erreurs de livraison au lieu de notifier réellement quiconque d'un enregistrement manqué. |
| `ALLOWED_HOSTS` (défini automatiquement sur `"*"`) | Laisser tel quel, sauf raison spécifique | Faible | La désactivation complète de la validation de l'en-tête Host de Django est un compromis accepté ici pour maintenir le fonctionnement des sondes de santé de la plateforme. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour la connectivité PostgreSQL sur GKE. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Healthchecks
partagée avec la variante Cloud Run est décrite dans
**[Healthchecks_Common](Healthchecks_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Healthchecks sur GKE Autopilot](../labs/Healthchecks_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Healthchecks Common — Configuration d'application partagée](Healthchecks_Common.md) — la configuration partagée par les deux cibles de déploiement.
