---
title: "Healthchecks sur Google Cloud Run"
description: "Référence de configuration pour déployer Healthchecks sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Healthchecks_CloudRun.md @ 3055034 sha256:1ba4c755b09a -->

# Healthchecks sur Google Cloud Run {#healthchecks-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Healthchecks_CloudRun.png" alt="Healthchecks sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Healthchecks est un service open source et auto-hébergé de supervision des jobs
cron et des signaux de vie (heartbeat) : les tâches planifiées lui envoient un
« ping » en cas de succès (ou une tâche le pingue périodiquement et Healthchecks
surveille l'absence de ping), et il vous alerte par e-mail, Slack, SMS ou via
plus de 100 autres intégrations lorsqu'un ping est en retard ou manquant. Ce
module déploie Healthchecks sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Healthchecks et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toute application Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Healthchecks s'exécute comme un conteneur Django/uWSGI sur Cloud Run v2. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service uWSGI, 1 vCPU / 512 MiB par défaut, toujours actif (pas de mise à zéro) |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — la variable d'environnement `DB` est explicitement définie à `postgres`, ce qui remplace le repli SQLite de l'image |
| Secrets | Secret Manager | `SECRET_KEY` et mot de passe administrateur initial générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire**, et `DB = "postgres"` est défini
  explicitement. Sinon, l'image amont se rabat silencieusement sur une base
  SQLite jetable, locale au conteneur, sans aucune erreur — la même catégorie de
  piège que celle déjà documentée dans ce catalogue pour Wallabag.
- **L'image de conteneur est réellement préconstruite**
  (`healthchecks/healthchecks`) — `container_image_source` vaut `"prebuilt"` par
  défaut et aucune étape Cloud Build ne s'exécute.
- **`cpu_always_allocated = true` et `min_instance_count = 1` par défaut** — la
  boucle d'arrière-plan `sendalerts`/`sendreports`, qui repère les signalements
  manqués et déclenche les alertes, est colocalisée dans le même conteneur et
  s'exécute en continu, indépendamment des requêtes HTTP entrantes (même schéma
  que n8n/Kestra). Avec la facturation à la requête que ce catalogue applique par
  défaut à la plupart des applications, cette boucle serait bridée à presque zéro
  entre les requêtes et pourrait silencieusement cesser de repérer les
  signalements manqués.
- **Aucun endpoint de santé dédié.** Les sondes de démarrage et de vivacité
  ciblent `/` (la page de connexion publique). `ALLOWED_HOSTS = "*"` est défini
  afin que l'en-tête Host des sondes internes de la plateforme ne soit jamais
  rejeté par la validation d'hôte de Django.
- **Le compte administrateur initial est créé une seule fois**, sans
  auto-réparation. Un job d'initialisation `admin-bootstrap` exécute les
  migrations et crée le superutilisateur (`admin_email` / un mot de passe Secret
  Manager généré) via la commande Django standard `createsuperuser --noinput`.
  Relancer le job est une opération sans effet et sans risque si le compte
  existe déjà.
- **L'e-mail sortant est un espace réservé par défaut.** `DEFAULT_FROM_EMAIL` vaut
  `healthchecks@example.org` par défaut. Configurez de vrais `EMAIL_HOST`/`EMAIL_HOST_USER`/
  `EMAIL_HOST_PASSWORD` après le déploiement, faute de quoi les alertes ne seront
  pas réellement remises.
- **Pas de Redis, pas de stockage objet.** Healthchecks stocke tout son état —
  vérifications, pings, utilisateurs, configuration des alertes — dans
  PostgreSQL uniquement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Healthchecks {#a-cloud-run--the-healthchecks-service}

Healthchecks s'exécute comme un service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions,
  le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Healthchecks stocke toutes les données applicatives (vérifications, pings,
intégrations, utilisateurs, historique des alertes) dans une instance gérée
Cloud SQL for PostgreSQL 15. Le service s'y connecte de manière privée via le
**Cloud SQL Auth Proxy** sur un socket Unix ; aucune IP publique n'est exposée.
Lors du premier déploiement, des Jobs d'initialisation créent la base de données
et le rôle de l'application, puis créent le compte administrateur initial.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe figurent dans les [sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

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

Consultez [App_CloudRun](App_CloudRun.md) pour les détails sur l'injection et la
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs (y compris ceux des workers d'arrière-plan
`sendalerts`/`sendreports`, qui écrivent dans le même flux stdout que le serveur
web) sont envoyés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont
envoyées vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Healthchecks {#3-healthchecks-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le Job
  d'initialisation `db-init` s'exécute avec `postgres:15-alpine`. Il se connecte
  via le Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base de
  données de l'application. Le job peut être relancé sans risque.
- **Amorçage du compte administrateur.** Le Job `admin-bootstrap` (qui utilise
  l'image Healthchecks elle-même) exécute `manage.py migrate --noinput`, puis `manage.py
  createsuperuser --noinput --username admin --email <admin_email>` (mot de passe
  issu d'un secret Secret Manager généré). Comme les jobs d'initialisation Cloud
  Run s'exécutent strictement avant la création du Service principal — et comme un
  job invoque directement la commande du conteneur, en contournant la chaîne de
  démarrage `uwsgi.ini` propre à l'image — le job exécute d'abord sa propre
  migration au lieu de supposer que le schéma existe déjà.
- **Les migrations de base de données s'exécutent aussi à chaque démarrage
  normal du conteneur** du service principal (le `uwsgi.ini` de l'image intègre
  `hook-pre-app = exec:./manage.py migrate`), de sorte que la mise à niveau
  d'`application_version` applique automatiquement les changements de schéma.
- **La boucle d'arrière-plan `sendalerts`/`sendreports` est colocalisée dans le
  même conteneur**, démarrée automatiquement par le `uwsgi.ini` propre à l'image
  aux côtés du serveur web (entrées `attach-daemon`) — aucun service worker
  distinct n'est déployé. C'est cette boucle qui détecte réellement les
  signalements manqués et envoie les alertes, et elle a besoin que le conteneur
  soit à la fois en cours d'exécution (`min_instance_count =
  1`) et doté d'un CPU alloué (`cpu_always_allocated = true`) pour fonctionner de manière fiable.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` —
  Healthchecks n'a pas d'endpoint de santé dédié ; la page de connexion racine
  répond toujours sans authentification et renverrait une erreur 500 (au lieu de
  s'afficher) si la connexion à la base de données était rompue.
- **Connexion, et non inscription.** Healthchecks ne propose par défaut aucun
  parcours public d'inscription en libre-service ; le seul compte est celui créé
  par `admin-bootstrap`.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Healthchecks ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `healthchecks` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Healthchecks` | Nom lisible affiché dans la console. |
| `admin_email` | `admin@techequity.cloud` | E-mail/nom d'utilisateur du superutilisateur initial, créé une seule fois. |
| `default_from_email` | `healthchecks@example.org` | Adresse d'expéditeur provisoire, jusqu'à la configuration d'un vrai SMTP. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | L'image officielle ne nécessite aucun build personnalisé. |
| `container_image` | `""` | Laissez vide pour utiliser `healthchecks/healthchecks:<application_version>`. |
| `container_port` | `8000` | Le serveur uWSGI de l'image amont écoute sur ce port (`docker/uwsgi.ini`). |
| `min_instance_count` | `1` | Maintient active la boucle d'alerte permanente. Définir `0` expose à des alertes manquées pendant les périodes d'inactivité. |
| `max_instance_count` | `1` | Une seule instance suffit ; la boucle d'alerte n'est pas conçue pour une coordination entre plusieurs instances. |
| `cpu_always_allocated` | `true` | Requis pour que la boucle d'alerte interne au processus s'exécute de manière fiable entre les requêtes. |
| `enable_cloudsql_volume` | `true` | Socket Unix du Cloud SQL Auth Proxy — `DB_HOST` est un paramètre libpq/psycopg distinct, de sorte que le répertoire du socket fonctionne tel quel. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Configurez ici `EMAIL_HOST`/`EMAIL_PORT`/`EMAIL_HOST_USER` pour une remise réelle des alertes. Ne définissez pas `DB`, `SECRET_KEY` ni `DB_*` — ils sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | À utiliser pour `EMAIL_HOST_PASSWORD` ou d'autres identifiants SMTP sensibles. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Valeur par défaut héritée. Healthchecks n'a besoin d'aucun système de fichiers partagé ; définissez-la donc à `false` lors du déploiement. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Valeur par défaut générique du socle ; inutilisée par l'application elle-même. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixée ; MySQL/SQLite ne sont pas pris en charge par ce module. |
| `application_database_name` | `healthchecks_db` | Immuable après le premier déploiement. |
| `application_database_user` | `healthchecks_user` | Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` + `admin-bootstrap`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai de 60s | Il n'existe aucun endpoint de santé dédié ; `/` est la page de connexion publique. |
| `liveness_probe` | HTTP `/`, délai de 30s | Même justification. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Inutilisé — Healthchecks n'a pas d'intégration Redis documentée. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Endpoint / port de la base de données. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `DB` (défini automatiquement) | `"postgres"` | Critique | S'il n'était pas défini pour une raison quelconque, l'application utiliserait silencieusement une base SQLite locale jetable — les vérifications et l'historique des alertes disparaîtraient à chaque redémarrage, sans aucune erreur. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` | Élevé | La mise à zéro ou le passage à la facturation à la requête bride la boucle `sendalerts` colocalisée entre les requêtes, si bien que des signalements manqués peuvent passer silencieusement inaperçus. |
| `ADMIN_PASSWORD` (généré automatiquement) | Récupérez-le une fois, puis changez-le via l'interface | Moyen | Le mot de passe initial n'est défini que lors de la PREMIÈRE exécution réussie d'`admin-bootstrap` ; relancer le job ne le met pas à jour. |
| `DEFAULT_FROM_EMAIL` / variables SMTP | Configurez un vrai SMTP après le déploiement | Élevé | Si la valeur provisoire par défaut est conservée, `sendalerts` journalise des erreurs de remise au lieu de réellement avertir qui que ce soit d'un signalement manqué. |
| `ALLOWED_HOSTS` (défini automatiquement à `"*"`) | Laissez tel quel, sauf raison particulière | Faible | Désactiver entièrement la validation de l'en-tête Host de Django est ici un compromis accepté pour que les sondes de santé de la plateforme continuent de fonctionner ; Healthchecks n'a pas d'autre modèle de sécurité fondé sur le Host. |
| `application_database_name` / `application_database_user` | Définissez-les une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `container_image_source` | `prebuilt` | Critique | Passer à `custom` sans Dockerfile dans `Healthchecks_Common/scripts` fait échouer le build — Healthchecks n'a, par conception, aucun script de build personnalisé. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Healthchecks, partagée avec la variante GKE, est décrite
dans **[Healthchecks_Common](Healthchecks_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Healthchecks sur Cloud Run](../labs/Healthchecks_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Healthchecks sur GKE Autopilot](Healthchecks_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Healthchecks Common — Configuration applicative partagée](Healthchecks_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Loki sur Google Cloud Run](Loki_CloudRun.md), [Grafana sur Google Cloud Run](Grafana_CloudRun.md), [GlitchTip sur Google Cloud Run](GlitchTip_CloudRun.md), [GoAlert sur Google Cloud Run](GoAlert_CloudRun.md) dans la solution **Security Monitoring & Response**.
