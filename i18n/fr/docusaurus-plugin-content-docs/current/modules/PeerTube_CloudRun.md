---
title: "PeerTube sur Google Cloud Run"
description: "Référence de configuration pour déployer PeerTube sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PeerTube_CloudRun.md @ 3055034 sha256:43a53053d948 -->

# PeerTube sur Google Cloud Run {#peertube-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PeerTube_CloudRun.png" alt="PeerTube sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PeerTube est une plateforme open source d'hébergement vidéo fédérée via ActivityPub — une
alternative auto-hébergée à YouTube dans laquelle des instances exploitées indépendamment se suivent
et fédèrent entre elles vidéos, commentaires et chaînes (ainsi qu'avec le reste du
Fediverse), de la même manière que Mastodon fédère les publications. Ce module déploie
PeerTube sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par PeerTube et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité du service, ingress
et équilibrage de charge, scaling et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

PeerTube s'exécute sous la forme d'un conteneur Node.js construit sur mesure sur Cloud Run v2, à partir
d'un Dockerfile reposant sur l'image de base officielle `chocobozzz/peertube`, afin qu'un
ARG de build dédié `PEERTUBE_VERSION` puisse épingler une version réelle. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur Node.js sur le port 9000 ; 2 vCPU / 2 GiB par défaut (prudent — à augmenter pour un vrai transcodage) ; `cpu_always_allocated = true` |
| Base de données | Cloud SQL pour PostgreSQL 15 | Obligatoire — extensions `pg_trgm`/`unaccent` pré-créées ; PeerTube migre lui-même son schéma |
| Cache et file d'attente | Redis | **Obligatoire, et non facultatif** — la file de jobs BullMQ de PeerTube (transcodage, livraison de la fédération, notifications) n'a aucun repli en mémoire |
| Stockage d'objets | Cloud Storage | Un bucket `videos` public (compatible S3, identifiants HMAC) pour les fichiers vidéo et de playlists de streaming ; un bucket `data` privé (GCS FUSE) pour l'état local |
| Secrets | Secret Manager | `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD` et paire de clés d'accès/secrète HMAC S3 générés automatiquement ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut — doit être publique pour la fédération ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Redis est obligatoire.** Le transcodage, la livraison de la fédération et le
  pipeline de notifications de PeerTube passent tous par une file de jobs BullMQ intégrée au processus, sans
  aucun repli en mémoire — contrairement à la plupart des modules de ce catalogue, où Redis
  est un réglage facultatif de performance/de scaling. `enable_redis = true` est la
  valeur par défaut et ne doit jamais être désactivé.
- **`cpu_always_allocated = true` par défaut.** Le traitement des jobs BullMQ n'est
  lié à aucune requête HTTP entrante particulière — avec une facturation à la requête, le CPU
  est bridé quasiment à zéro entre les requêtes, et un job de transcodage peut se bloquer ou
  ne jamais se terminer (même raisonnement que le modèle de worker en arrière-plan n8n/Kestra
  de ce catalogue).
- **Il s'agit d'une variante VOD/transcodage léger, et non d'un déploiement de transcodage
  de production.** `cpu_limit = "2000m"` / `memory_limit = "2Gi"` sont
  des valeurs par défaut volontairement prudentes pour une démonstration ou un usage léger. La FAQ de PeerTube
  recommande jusqu'à 8 vCPU / 8Gi lorsque le transcodage s'exécute sur la même machine que le
  serveur — augmentez-les nettement pour une charge réelle, ou préférez `PeerTube_GKE`.
- **Le streaming en direct RTMP ne fonctionne pas sur Cloud Run, point final.** `enable_live_streaming`
  n'a aucun effet quelle que soit sa valeur — les services Cloud Run n'acheminent qu'un seul
  port de conteneur HTTP(S), et l'ingestion RTMP (ports 1935/1936) est un protocole TCP
  brut. Utilisez `PeerTube_GKE` pour le streaming en direct.
- **Le bucket `videos` est volontairement public.** L'architecture même de PeerTube
  exige que les navigateurs récupèrent les fichiers vidéo et de playlists de streaming directement depuis
  le stockage d'objets, sans passer par l'application — le bucket remplace le paramètre
  sécurisé par défaut de la fondation `public_access_prevention = "enforced"` par
  `"inherited"` afin que l'autorisation requise `allUsers:objectViewer` puisse s'appliquer. Voir
  le §3 pour l'explication complète.
- **`host` (le domaine de fédération ActivityPub) est immuable après la première utilisation
  réelle.** Laissé vide par défaut pour que le point d'entrée le dérive de l'URL de service
  prévue par Cloud Run — fonctionne d'emblée sur un nouveau déploiement. Définissez un
  véritable domaine personnalisé avant toute utilisation en production.
- **Aucun job d'initialisation de l'administrateur n'est nécessaire.** `PT_INITIAL_ROOT_PASSWORD` est
  lu directement depuis `process.env` par le propre `installer.ts` de PeerTube au premier
  démarrage lorsqu'aucun utilisateur n'existe encore — le compte `root` est créé automatiquement.
- **La connexion à la base de données utilise TCP avec chiffrement sans vérification, et non un
  socket Unix.** Le mécanisme `db_host_env_var_name` d'`App_CloudRun` associe toujours
  l'IP privée brute de Cloud SQL à `PEERTUBE_DB_HOSTNAME` (et non au chemin de socket
  vers lequel `DB_HOST` se résout sinon) ; `PeerTube_CloudRun` force donc
  `PEERTUBE_DB_SSL=true` avec reject-unauthorized à `false` — le même modèle
  déjà éprouvé pour `GTS_DB_TLS_MODE` de GoToSocial.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du service et des
ressources sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service PeerTube {#a-cloud-run--the-peertube-service}

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le trafic, les journaux
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le scaling, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

PeerTube stocke toutes les données de l'application (comptes, métadonnées des vidéos, commentaires,
abonnements, playlists) dans une instance gérée Cloud SQL pour PostgreSQL 15. Le
service se connecte en TCP chiffré à l'IP privée de l'instance (voir le §3 pour
comprendre pourquoi il ne s'agit pas d'une connexion par socket Unix, contrairement à la plupart des applications Cloud Run de ce
catalogue).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~peertube"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs). Consultez [App_CloudRun](App_CloudRun.md) pour le modèle de
connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis — la file de jobs BullMQ {#c-redis--the-bullmq-job-queue}

Redis sous-tend la file de jobs de transcodage, de livraison de la fédération et de notifications
de PeerTube. Lorsque `redis_host` est laissé vide, l'IP de la VM du serveur NFS partagé est utilisée
comme hôte Redis par défaut.

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the remapped env vars in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -i redis
  ```

### D. Cloud Storage — `videos` (public) et `data` (privé) {#d-cloud-storage--videos-public-and-data-private}

Deux buckets GCS sont provisionnés :

- **`videos`** — public (`public_access_prevention = "inherited"`,
  `allUsers:objectViewer`), avec CORS activé, accessible via le client natif
  compatible S3 de PeerTube (AWS SDK) sur le point de terminaison XML d'interopérabilité S3 de GCS, à l'aide
  d'identifiants HMAC issus d'un compte de service dédié. Il contient les cinq classes de stockage d'objets
  de PeerTube (web-videos, streaming-playlists,
  original-video-files, user-exports, captions) sous des préfixes distincts.
- **`data`** — privé, monté via GCS FUSE sur `/data`. Il contient l'état local de PeerTube
  (hors stockage d'objets) : avatars, miniatures, aperçus, storyboards,
  torrents, plugins, journaux et tmp/cache — toujours sur disque local/monté,
  quelle que soit la configuration du stockage d'objets vidéo.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
  gcloud storage ls gs://<videos-bucket>/
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Le conteneur de PeerTube lit `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`
(consulté uniquement au premier démarrage lorsqu'aucun utilisateur n'existe), la paire de clés d'accès/secrète
HMAC S3 et — lorsque SMTP est configuré — un mot de passe SMTP, tous sous forme de
variables d'environnement adossées à des secrets. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~peertube"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[PeerTube_Common](PeerTube_Common.md) §2 pour la liste complète des secrets.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings
= "all"`, requis pour la fédération ActivityPub publique et la diffusion des vidéos). Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN (utile pour la
diffusion vidéo) et Cloud Armor peuvent être ajoutés par-dessus.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à
Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PeerTube {#3-peertube-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute
  `scripts/peertube/db-init.sh` avec `postgres:15-alpine`. Il attend que
  Cloud SQL accepte les connexions, puis crée de manière idempotente le rôle et la
  base de données de l'application, accorde les privilèges et crée les extensions `pg_trgm` et
  `unaccent` en tant que superutilisateur postgres — le guide d'installation de PeerTube
  exige les deux mais ne les crée pas lui-même. Peut être réexécuté sans risque
  (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration distinct.** PeerTube crée et migre lui-même son
  schéma Sequelize automatiquement à chaque démarrage du serveur.
- **Le compte administrateur s'initialise automatiquement — aucun déclenchement manuel n'est nécessaire.**
  Contrairement à certaines applications ActivityPub de ce catalogue (GoToSocial requiert un
  job CLI manuel), le `installer.ts` de PeerTube lit `PT_INITIAL_ROOT_PASSWORD`
  directement depuis `process.env` (et non via node-config, donc sans préfixe `PEERTUBE_`) au
  premier démarrage lorsqu'aucun utilisateur n'existe encore, et crée automatiquement le compte administrateur `root`
  avec ce mot de passe. Pour le récupérer :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~root-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
  Connectez-vous sur `$SERVICE_URL/login` avec le nom d'utilisateur `root`.
- **Le domaine de fédération (`host`) est immuable après une utilisation réelle.**
  `PEERTUBE_WEBSERVER_HOSTNAME` est intégré à chaque URI d'acteur/d'objet ActivityPub
  créé localement dès le premier démarrage du serveur avec des données
  réelles. Lorsque `host` est laissé vide, `docker-entrypoint.sh` le dérive de la variable
  `CLOUDRUN_SERVICE_URL` propre à Cloud Run au démarrage du conteneur — une valeur par défaut
  fédérée fonctionnelle qui ne nécessite aucune décision de domaine avant le déploiement. Définissez un véritable
  domaine personnalisé via `host` avant toute utilisation en production ; le modifier une fois que de vrais
  comptes/vidéos existent nécessite le script de maintenance `update-host` de PeerTube
  et ne corrige pas rétroactivement les URI déjà fédérées.
- **Le remplacement de l'accès public du bucket `videos` est indispensable, et non
  facultatif.** `App_CloudRun`/`App_GKE` attribuent par défaut à chaque bucket provisionné
  `public_access_prevention = "enforced"`, sauf remplacement explicite.
  La documentation de PeerTube impose un bucket `videos` public avec CORS configuré
  (les navigateurs récupèrent les fichiers vidéo et de playlists de streaming directement depuis le stockage
  d'objets). Sans ce remplacement, l'autorisation
  `google_storage_bucket_iam_member` du module pour `allUsers:objectViewer` échoue
  au moment de l'apply avec `Error 412: ... public access prevention is enforced`.
  La sortie `storage_buckets` de `PeerTube_Common` définit
  `public_access_prevention = "inherited"` spécifiquement sur le bucket `videos`
  (et non sur le bucket `data`) pour corriger cela — confirmé en conditions réelles
  le 2026-07-22.
- **Sur un projet en libre-service géré par RAD, un remplacement de règle d'administration au niveau du projet
  est d'abord appliqué, puis attendu.** Les projets gérés par RAD héritent d'une règle d'administration de dossier
  imposant `constraints/storage.publicAccessPrevention`, qui
  prévaut sur le paramètre au niveau du bucket ci-dessus et réintroduit le même `412`.
  Lorsque `is_self_serve_project = true` (injecté par le serveur — ne le définissez jamais
  manuellement ; il vaut `false` pour un projet ordinaire que vous apportez vous-même, où tout ce
  mécanisme est sans effet), le module remplace cette contrainte au niveau du
  **projet** via le fournisseur guardrails-admin. Le remplacement est lié
  à l'état propre de ce module : détruire le déploiement rétablit donc pour le
  projet la posture appliquée par défaut du dossier.
  **Le remplacement a besoin d'environ 90 s pour se propager avant que l'autorisation sur le bucket
  ne réussisse.** Terraform indique que l'écriture de la règle d'administration est terminée en 0 s, mais
  l'application côté GCP est en retard : l'étape d'apply suivante rencontrait toujours le même `412`,
  même après épuisement du mécanisme intégré de nouvelle tentative IAM du fournisseur (~30 s, `Too many
  conflicts`). Un `time_sleep.wait_for_org_policy_propagation`
  de 90 s s'intercale entre les deux, et l'autorisation sur le bucket dépend de cette attente
  plutôt que directement du remplacement — un apply sur un projet en libre-service
  est donc, par conception, plus lent d'environ 90 s. Confirmé en conditions réelles le 2026-08-06.
- **Point délicat : le remplacement porte sur le projet, donc deux variantes PeerTube dans
  un même projet entrent en conflit.** `storage.publicAccessPrevention` n'a pas de
  variante au niveau du bucket une fois appliquée à un niveau supérieur. Si un même projet
  exécute à la fois `PeerTube_CloudRun` et `PeerTube_GKE`, l'état de chaque module
  gère indépendamment le *même* objet de règle au niveau du projet, et
  détruire l'un le retire à l'autre. `solutions.yaml`
  ne sélectionne jamais qu'une seule variante PeerTube par solution ; ce cas est donc rare en
  pratique et n'est pas résolu dans le module.
- **Les ACL de téléversement ne sont volontairement pas définies.** L'interopérabilité XML S3 de GCS avec
  l'accès uniforme au niveau du bucket ne respecte pas les ACL par objet définies via un client
  S3 (la même limitation que la documentation de PeerTube décrit pour Backblaze B2) ;
  `object_storage.upload_acl.*` reste donc non configuré et la lecture publique est
  accordée au niveau du bucket.
- **Chemin de vérification d'état.** La sonde de démarrage est en **TCP** sur le port 9000 — les migrations
  DB/Redis de PeerTube et l'initialisation de l'administrateur au premier démarrage peuvent prendre plus de temps que ce
  qu'autorise une fenêtre de disponibilité HTTP classique, et une sonde HTTP visant une API
  pas encore prête empêcherait la révision d'être créée. La
  sonde de vivacité utilise le point de terminaison public et non authentifié `GET /api/v1/config`.
- **Inspecter le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement
(conformément à l'étiquette `{{UIMeta group=N}}` de chaque variable dans `variables.tf`). Seuls les
paramètres propres à PeerTube ou notables pour celui-ci sont listés ; toutes les autres entrées sont
héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de monitoring. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `peertube` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `PeerTube` | Nom lisible affiché dans la Console. |
| `description` | `PeerTube - Federated (ActivityPub) Video Hosting Platform` | Description du service. |
| `application_version` | `latest` | Se résout en l'étiquette Docker Hub maintenue `production` via l'ARG de build dédié `PEERTUBE_VERSION` — et non via l'`APP_VERSION` générique de la fondation (qui l'emporterait sinon lors de la fusion et produirait une étiquette `latest` impossible à résoudre). |
| `host` | `""` | `PEERTUBE_WEBSERVER_HOSTNAME` — le domaine public de fédération. **Immuable après la première utilisation réelle.** Laissé vide, il est dérivé de l'URL Cloud Run prévue. |
| `admin_email` | `admin@example.com` | Adresse e-mail attribuée au compte administrateur `root` créé automatiquement. |
| `enable_open_registration` | `false` | Permet aux nouveaux utilisateurs de s'inscrire eux-mêmes. |
| `enable_live_streaming` | `false` | **Sans effet sur cette variante Cloud Run** — RTMP nécessite un port TCP brut que les services Cloud Run ne peuvent pas exposer. Utilisez `PeerTube_GKE`. |

### Groupe 4 — Runtime et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit une image basée sur un Dockerfile (base `chocobozzz/peertube:${PEERTUBE_VERSION}`) via Cloud Build. |
| `cpu_limit` | `2000m` | Valeur par défaut prudente pour une démonstration ou un usage VOD. La FAQ de PeerTube recommande jusqu'à 8 vCPU pour une charge de transcodage réelle. |
| `memory_limit` | `2Gi` | Valeur par défaut prudente. La FAQ de PeerTube recommande jusqu'à 8Gi pour une charge de transcodage réelle. |
| `container_port` | `9000` | Valeur par défaut native de `PEERTUBE_LISTEN_PORT` dans PeerTube. |
| `cpu_always_allocated` | `true` | Facturation à l'instance — la file de jobs BullMQ de PeerTube n'est liée à aucune requête HTTP entrante. |
| `min_instance_count` | `0` | `0` active la réduction à zéro. |
| `max_instance_count` | `1` | Plafond de coût. |
| `execution_environment` | `gen2` | Requis pour les montages GCS FUSE. |
| `enable_cloudsql_volume` | `true` | Injecte le montage de socket du Cloud SQL Auth Proxy ; les variables d'environnement `PEERTUBE_DB_*` propres à PeerTube sont définies indépendamment via l'alias `db_host_env_var_name` (voir le §3). |
| `enable_image_mirroring` | `true` | Réplique l'image de base dans Artifact Registry. |

### Groupe 5 — Accès, réseau, SMTP {#group-5--access-networking-smtp}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Obligatoire — la fédération comme la diffusion des vidéos nécessitent une accessibilité publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. **Bloque la fédération** — ne convient qu'à une instance entièrement privée. |
| `smtp_host` | `""` | Nom d'hôte SMTP. Une valeur vide désactive l'e-mail ; une valeur non vide provisionne le secret du mot de passe SMTP. |
| `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | `587` / `""` / `""` / `false` / `""` | Configuration SMTP standard, utilisée uniquement lorsque `smtp_host` est défini. `mail_from` vaut par défaut `noreply@<host>` s'il est vide. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair fusionnées avec les valeurs par défaut de `PeerTube_Common`. |
| `secret_environment_variables` | `{}` | Références Secret Manager destinées à l'opérateur. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Configuration standard de sauvegarde/restauration d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Exécution standard de scripts SQL personnalisés d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global + le WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés — doivent correspondre à `host`. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur HTTPS — utile pour la diffusion vidéo. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets GCS — `PeerTube_Common` fournit les véritables buckets `data`/`videos`, en remplaçant la valeur par défaut générique de cette variable, limitée à `data`. |
| `enable_nfs` | `true` (ignorée) | **Codée en dur à `false` dans `main.tf`** — PeerTube utilise GCS FUSE et le stockage d'objets au lieu de NFS. |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `data` via FUSE sur `/data`. Conservez `true` — l'état local de PeerTube y réside toujours, quelle que soit la configuration du stockage d'objets vidéo. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires au-delà de `data`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PeerTube requiert PostgreSQL. |
| `db_name` | `peertube` | La base de données effectivement créée et injectée sous `PEERTUBE_DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `peertube` | Le rôle effectivement créé et injecté sous `PEERTUBE_DB_USERNAME` ; mot de passe généré automatiquement dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `true` | Installe `postgres_extensions` après le provisionnement. |
| `postgres_extensions` | `["pg_trgm", "unaccent"]` | Requises par le guide d'installation de PeerTube ; non créées par PeerTube lui-même. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` fourni par `PeerTube_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme n'est définie pour PeerTube. |

### Groupe 14 — Observabilité et état {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 9000 | Confirme que le port est lié ; les migrations DB/Redis de PeerTube et l'initialisation de l'administrateur se terminent avant que l'API HTTP ne soit réellement prête. |
| `liveness_probe` | HTTP `/api/v1/config`, délai initial de 60 s | Le point de terminaison de configuration public et non authentifié. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — ne jamais désactiver. PeerTube n'a aucun repli en mémoire pour BullMQ. |
| `redis_host` | `""` | Laissez vide pour utiliser par défaut l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (requiert `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer
les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (IP privée Cloud SQL sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`data`, `videos`). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `uptime_check_names` | État du monitoring, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` | Identifiant du projet. |
| `cicd_enabled` / `artifact_registry_repository` | État du CI/CD et dépôt Artifact Registry. |
| `vpc_sc_enabled` / `audit_logging_enabled` | État de VPC-SC et de la journalisation d'audit. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `host` (`PEERTUBE_WEBSERVER_HOSTNAME`) | Définir votre domaine réel avant la première utilisation réelle | Critical | Intégré à chaque URI d'acteur/d'objet ActivityPub au moment de sa création ; le modifier une fois que de vrais comptes/vidéos existent casse la fédération pour tout ce qui a été créé sous l'ancienne valeur. |
| `enable_redis` | `true` (ne jamais désactiver) | Critical | PeerTube n'a aucun repli en mémoire pour BullMQ — le transcodage, la livraison de la fédération et les notifications cessent tous de fonctionner sans Redis. |
| `public_access_prevention` du bucket `videos` | `"inherited"` (défini par `PeerTube_Common`, ne pas remplacer par `"enforced"`) | Critical | L'architecture de PeerTube exige que les navigateurs récupèrent les fichiers vidéo directement depuis le stockage d'objets ; `"enforced"` bloque l'autorisation requise `allUsers:objectViewer` avec une erreur `412` au moment de l'apply. |
| `enable_live_streaming` | Laisser à `false`, ou passer à `PeerTube_GKE` | High | Aucun effet sur Cloud Run quelle que soit la valeur — l'ingestion RTMP nécessite un port TCP brut que les services Cloud Run ne peuvent pas exposer. L'activer ici crée une fausse attente, et non une fonctionnalité opérationnelle. |
| `PEERTUBE_DB_SSL` / remplacement de reject-unauthorized | Laisser tel que fourni (`true` / `false`, défini automatiquement) | Critical | `db_host_env_var_name` de Cloud Run associe l'IP privée brute de Cloud SQL, qui exige le chiffrement ; le simple « disable » qui serait correct sur GKE échoue ici avec « no encryption », et la vérification complète du certificat échoue avec le certificat de Cloud SQL (pas de SAN d'IP). |
| `cpu_limit` / `memory_limit` | Augmenter nettement pour une charge de transcodage réelle | High | Les valeurs par défaut `2000m`/`2Gi` sont volontairement prudentes pour une démonstration ou un usage VOD ; la FAQ de PeerTube recommande jusqu'à 8 vCPU/8Gi pour un transcodage réel en production — des ressources sous-dimensionnées bloquent ou font échouer les jobs de transcodage. |
| `cpu_always_allocated` | `true` (par défaut, ne pas désactiver) | High | Le traitement BullMQ de PeerTube n'est lié à aucune requête HTTP entrante ; avec une facturation à la requête, le CPU est bridé quasiment à zéro entre les requêtes et les jobs en arrière-plan peuvent se bloquer indéfiniment. |
| `database_type` | `POSTGRES_15` | Critical | PeerTube requiert PostgreSQL ; les extensions `pg_trgm`/`unaccent` et le schéma Sequelize sont propres à Postgres. |
| `startup_probe` | Conserver `type = "TCP"` | High | Les migrations DB/Redis de PeerTube et l'initialisation de l'administrateur prennent plus de temps que ce qu'autorise une fenêtre de disponibilité HTTP classique ; une sonde HTTP visant une API pas encore prête peut empêcher la révision de devenir prête. |
| `enable_open_registration` | `false` pour la plupart des déploiements | Medium | Laisser l'inscription ouverte sur une instance publique permet à quiconque dispose de l'URL de créer un compte et de téléverser du contenu vidéo. |
| `enable_iap` | `false` pour une instance publique | Medium | IAP bloque le trafic de fédération ActivityPub non authentifié et la consultation publique des vidéos — ne convient qu'à une instance entièrement privée ou de test. |
| Secret `PT_INITIAL_ROOT_PASSWORD` | Récupérer et conserver en lieu sûr après le premier déploiement | Medium | C'est le seul identifiant du compte administrateur `root` ; il n'est ni régénéré ni réappliqué une fois le compte existant. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du service, scaling
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et réplication d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à PeerTube
est définie dans **[PeerTube_Common](PeerTube_Common.md)** (source du
module : `modules/PeerTube_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PeerTube sur Cloud Run](../labs/PeerTube_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PeerTube sur GKE Autopilot](PeerTube_GKE.md) — la même application sur Kubernetes, si vous avez besoin de l'autre cible de déploiement.
- [PeerTube Common — Configuration applicative partagée](PeerTube_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) et [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Creator & Media Publishing**.
