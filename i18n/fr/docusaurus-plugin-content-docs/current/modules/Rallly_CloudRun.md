---
title: "Rallly sur Google Cloud Run"
description: "Référence de configuration pour déployer Rallly sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Rallly_CloudRun.md @ 3055034 sha256:13d8e90893fd -->

# Rallly sur Google Cloud Run {#rallly-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Rallly_CloudRun.png" alt="Rallly sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Rallly est une application open source et auto-hébergée de planification de réunions
et de sondages de groupe — une alternative à Doodle respectueuse de la vie privée —
construite avec Next.js et Prisma. Ce module déploie Rallly sur **Cloud Run v2** en
s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Rallly et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Rallly s'exécute comme un conteneur Next.js unique sur Cloud Run v2. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Next.js, 1 vCPU / 2 GiB par défaut, mise à l'échelle automatique serverless ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Rallly ne prend en charge ni MySQL ni d'autres moteurs |
| E-mail | Relais SMTP (externe) | Connexion par e-mail sans mot de passe ; fournissez votre propre hôte et vos identifiants SMTP |
| Secrets | Secret Manager | `SECRET_PASSWORD` et `NEXTAUTH_SECRET` générés automatiquement ; `SMTP_PWD` facultatif ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est imposé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage. Tout
  l'état de Rallly (sondages, votes, commentaires, utilisateurs) réside dans cette base
  de données.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont générés automatiquement** et stockés
  dans Secret Manager. Ces clés ne doivent pas faire l'objet d'une rotation après le
  premier démarrage sans fenêtre de maintenance — la rotation de `SECRET_PASSWORD`
  invalide les données chiffrées précédemment, et celle de `NEXTAUTH_SECRET` invalide
  toutes les sessions actives et les liens de connexion en cours.
- **La connexion à Rallly se fait sans mot de passe, par e-mail.** Les utilisateurs
  s'inscrivent et se connectent en recevant un lien ou un code de vérification ; une
  configuration SMTP fonctionnelle est donc de fait requise avant que quiconque puisse
  se connecter. Cette variante définit `smtp_host` sur `smtp.gmail.com` par défaut ;
  vous devez néanmoins fournir `smtp_user` / `smtp_password` (ou vider `smtp_host`)
  pour que les e-mails soient réellement envoyés.
- **L'URL de base publique est définie automatiquement.** `NEXT_PUBLIC_BASE_URL` /
  `NEXTAUTH_URL` prennent par défaut l'URL Cloud Run déterministe de ce service et sont
  corrigées à l'exécution à partir de `CLOUDRUN_SERVICE_URL` par le point d'entrée.
  Définissez `base_url` sur votre domaine personnalisé avant la mise en production afin
  que les liens d'invitation et de connexion se résolvent correctement.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`,
  `max = 1`). Les démarrages à froid ajoutent quelques secondes de latence à la
  première requête après une période d'inactivité ; définissez
  `min_instance_count = 1` pour garder le service actif.
- **NFS et Redis sont désactivés.** Rallly stocke tout son état dans PostgreSQL et n'a
  besoin ni d'un système de fichiers partagé ni d'un cache ; les deux sont désactivés
  par défaut (Redis est désactivé en dur).
- **Les migrations s'exécutent au démarrage.** Le script `./docker-start.sh` du
  conteneur exécute `prisma migrate deploy` à chaque démarrage, si bien que les mises
  à niveau de version appliquent les modifications de schéma sans étape de migration
  distincte. Le job `db-init` se contente de provisionner la base de données vide et
  le rôle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Rallly {#a-cloud-run--the-rallly-service}

Rallly s'exécute comme un service Cloud Run v2 qui se met à l'échelle automatiquement
selon la charge des requêtes, entre le nombre minimal et le nombre maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Rallly stocke toutes les données de l'application (sondages, options, participants,
votes, commentaires et comptes utilisateur) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le service s'y connecte de manière privée via le **Cloud SQL Auth
Proxy** sur un socket Unix (`enable_cloudsql_volume = true`) ; aucune IP publique
n'est exposée. Lors du premier déploiement, le Job `db-init` crée la base de données
et le rôle de l'application ; Rallly applique ensuite son propre schéma Prisma au
démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`rallly`), l'utilisateur (`rallly`) et le
secret du mot de passe figurent dans les [sorties](#5-outputs). Consultez
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la
rotation du mot de passe.

### C. E-mail (SMTP) {#c-email-smtp}

Rallly envoie les e-mails de connexion/vérification et d'invitation via un relais SMTP
externe. Lorsque `smtp_host` est défini, le conteneur reçoit `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_SECURE` et le secret `SMTP_PWD`. Il n'existe pas de service d'e-mail
géré par Google — fournissez le vôtre (SMTP Gmail, SendGrid, Mailgun, etc.).

- **CLI (vérifier les paramètres injectés sur la révision en cours d'exécution) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `SECRET_PASSWORD` (le secret de chiffrement des données et de session de
Rallly) et `NEXTAUTH_SECRET` (qui signe les jetons de session NextAuth et les liens de
connexion par e-mail). Un troisième, `SMTP_PWD`, n'est créé que lorsque SMTP est
configuré. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~rallly"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est joignable par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ;
les paramètres d'entrée et la sortie VPC contrôlent la connectivité. Définissez
`base_url` sur le nom d'hôte public afin que les liens d'invitation et de connexion de
Rallly correspondent à l'adresse effectivement visitée par les utilisateurs.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL vers Cloud Monitoring, avec des tests de disponibilité et des règles
d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Rallly {#3-rallly-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via
  le Cloud SQL Auth Proxy, crée de manière idempotente la base de données et le rôle
  de l'application, accorde les privilèges, puis signale au proxy de s'arrêter. Il est
  configuré avec `max_retries = 3` et peut être relancé sans risque.
- **Migrations de schéma au démarrage.** Le script `./docker-start.sh` de Rallly
  exécute `prisma migrate deploy` à chaque démarrage, si bien que le schéma est créé
  au premier démarrage après `db-init` et que la mise à niveau de la version de
  l'application applique les modifications de schéma sans étape de migration
  distincte.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont immuables après le premier
  démarrage.** Ils sont générés une seule fois et écrits dans Secret Manager. Modifier
  `SECRET_PASSWORD` invalide les données chiffrées précédemment ; modifier
  `NEXTAUTH_SECRET` invalide toutes les sessions actives et les liens de connexion en
  cours. N'effectuez la rotation que pendant une fenêtre de maintenance planifiée.
- **Connexion par e-mail sans mot de passe.** Rallly authentifie les utilisateurs via
  des liens ou codes de vérification envoyés par e-mail. Sans relais SMTP
  fonctionnel, les utilisateurs ne reçoivent pas les e-mails de connexion et ne
  peuvent de fait pas se connecter. Vérifiez les paramètres SMTP sur la révision en
  cours d'exécution après le déploiement.
- **URL de base publique.** `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` sont définies à
  partir de l'URL Cloud Run prévue au moment du plan et corrigées à l'exécution à
  partir de `CLOUDRUN_SERVICE_URL`. Si vous placez un domaine personnalisé devant le
  service, définissez `base_url` sur celui-ci afin que les liens se résolvent vers
  l'adresse visitée par les utilisateurs :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est en **TCP** (et non HTTP), et ne cible
  pas `/api/status` — le point de terminaison `/api/status` de Rallly ne renvoie un
  code 2xx qu'une fois que l'application signale être *entièrement* prête (base de
  données + Redis + dépendances), si bien qu'une sonde HTTP sur ce chemin n'a jamais
  réussi alors que Next.js écoutait déjà sur :3000 ; une vérification TCP réussit dès
  que le port est lié, ce qui est le bon critère pour acheminer le trafic. Par défaut :
  délai initial de 30 secondes, période de 20 secondes, 10 tentatives (environ 230
  secondes de marge) pour couvrir la migration Prisma du premier démarrage. La sonde
  de vivacité est **désactivée par défaut** pour la même raison — la sonde de
  vivacité de Cloud Run ne peut pas utiliser de socket TCP, et une vérification HTTP
  sur `/api/status` ferait redémarrer en boucle un conteneur sain mais pas encore
  entièrement prêt ; la sonde de démarrage TCP conditionne déjà l'acheminement.
- **Inspecter l'exécution des jobs :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Rallly ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement
standard.

### Groupe 2 — Identité de l'application {#group-2--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `rallly` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Rallly (`lukevella/rallly`) ; épinglez une version précise en production. |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU suffit pour un usage courant. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Rallly est sans état (tout est dans Postgres) et peut évoluer horizontalement ; augmentez selon les besoins. |
| `container_port` | `3000` | Rallly écoute sur le port 3000. |
| `cpu_always_allocated` | `false` | Facturation à la requête. Le pipeline de réponse de Rallly (e-mails de notification) ne s'exécute qu'après une requête ; aucun CPU n'est donc nécessaire au repos. |
| `enable_cloudsql_volume` | `true` | Socket Unix du Cloud SQL Auth Proxy pour PostgreSQL. |
| `base_url` | `""` | URL publique pour `NEXT_PUBLIC_BASE_URL` / les liens NextAuth. Vide → l'URL Cloud Run déterministe. Définissez-la sur votre domaine personnalisé avant la mise en production. |

### Groupe 5 — Accès, entrée et e-mail {#group-5--access-ingress--email}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Sources de trafic autorisées à atteindre le service. |
| `enable_iap` | `false` | Exige une connexion Google devant Rallly (IAP natif de Cloud Run). |
| `smtp_host` | `smtp.gmail.com` | Nom d'hôte du relais SMTP. Une valeur non vide provisionne `SMTP_PWD` et injecte les variables d'environnement `SMTP_*`. Videz-la pour désactiver l'e-mail. |
| `smtp_port` | `587` | Port SMTP (587 STARTTLS, 465 SSL). |
| `smtp_user` | `""` | Nom d'utilisateur SMTP — **définissez-le** (avec `smtp_password`), sinon la connexion par e-mail ne fonctionnera pas. |
| `smtp_password` | `""` (sensible) | Mot de passe SMTP. Vide → un secret généré automatiquement est stocké. |
| `smtp_secure_enabled` | `false` | Active le TLS/SSL implicite (true pour le port 465). |
| `mail_from` | `""` | Adresse d'expéditeur pour `NOREPLY_EMAIL` / `SUPPORT_EMAIL`. Vide → `noreply@rallly.local`. |

### Groupe 11 — Backend de base de données {#group-11--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `rallly` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `rallly` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_type` | `POSTGRES_15` | Imposé — Rallly exige PostgreSQL 15. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — Rallly stocke tout son état dans PostgreSQL. |
| `gcs_volumes` | `[]` | Aucun volume GCS Fuse n'est requis. |

### Groupe 13 — Observabilité et santé {#group-13--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s / période de 20s / 10 tentatives | Volontairement en TCP, et non en HTTP sur `/api/status` — ce point de terminaison ne renvoie un code 2xx qu'une fois l'application entièrement prête (base de données + Redis + dépendances), ce qui empêcherait un conteneur sain de commencer à recevoir du trafic. Prévoyez le temps de la migration Prisma du premier démarrage. |
| `liveness_probe` | Désactivée (`enabled = false`) | HTTP `/api/status`, délai de 15s, mais désactivée par défaut — une vérification HTTP précoce sur ce chemin ferait redémarrer en boucle un conteneur sain avant qu'il soit entièrement prêt ; la sonde de démarrage TCP conditionne déjà l'acheminement. |

### Groupe 20 — Cache Redis {#group-20--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Rallly n'utilise pas Redis ; laissez-le désactivé. |

Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | Détails des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut pour Rallly). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, `enable_cloudsql_volume = true` avec `database_type = NONE`, un `redis_port`/`backup_retention_days` hors plage. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_PASSWORD` (généré automatiquement) | Ne jamais en faire la rotation après le premier démarrage | Critique | Sa rotation invalide les données chiffrées précédemment et les sessions actives. |
| `NEXTAUTH_SECRET` (généré automatiquement) | N'en faire la rotation que pendant une fenêtre de maintenance | Critique | Sa rotation invalide toutes les sessions actives et les liens de connexion par e-mail en cours. |
| `db_name` / `db_user` | Définis une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données ou le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critique | Rallly ne prend en charge que PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activer sans `backup_uri` valide fait échouer le job d'import. |
| `smtp_user` / `smtp_password` | À définir lorsque `smtp_host` est défini | Élevé | Avec `smtp_host` défini (par défaut `smtp.gmail.com`) mais des identifiants vides, les e-mails de connexion ne sont jamais envoyés et les utilisateurs ne peuvent pas se connecter. |
| `base_url` | Votre domaine personnalisé | Élevé | S'il est laissé vide derrière un domaine personnalisé, les liens d'invitation et de connexion pointent vers l'URL `run.app` brute au lieu de l'adresse visitée par les utilisateurs. |
| `enable_iap` | Uniquement pour les déploiements internes | Élevé | IAP place une barrière d'authentification Google devant Rallly ; les participants anonymes aux sondages ne peuvent pas y accéder. |
| `enable_cloudsql_volume` | `true` | Élevé | Le socket de l'Auth Proxy est requis pour la connectivité PostgreSQL ; une garde au moment du plan le bloque avec `database_type = NONE`. |
| `min_instance_count` | `1` pour les usages sensibles à la latence | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après une période d'inactivité. |
| Délais de `startup_probe` | Conserver la valeur par défaut généreuse | Moyen | Une fenêtre trop serrée peut faire échouer la sonde pendant la migration Prisma du premier démarrage. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour les exigences de conservation liées à la conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Rallly
partagée avec la variante GKE est décrite dans **[Rallly_Common](Rallly_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Rallly sur Cloud Run](../labs/Rallly_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Rallly sur GKE Autopilot](Rallly_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Rallly Common — Configuration applicative partagée](Rallly_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Flarum sur Google Cloud Run](Flarum_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md) dans la solution **Community & Voice of Customer**.
