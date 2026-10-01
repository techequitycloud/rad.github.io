---
title: "Passbolt sur GKE Autopilot"
description: "Référence de configuration pour déployer Passbolt sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Passbolt_GKE.md @ 3055034 sha256:0835ac7e8bf7 -->

# Passbolt sur GKE Autopilot {#passbolt-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Passbolt_GKE.png" alt="Passbolt sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Passbolt (Community Edition) est un gestionnaire de mots de passe gratuit, open
source et orienté équipe, avec un chiffrement fondé sur GPG et un partage
d'identifiants par utilisateur et par groupe — sous licence AGPL-3.0, environ
6 000 étoiles sur GitHub. Il occupe une niche différente du module `Vaultwarden`
de ce catalogue : Vaultwarden est un coffre personnel compatible Bitwarden,
tandis que Passbolt est conçu autour du partage d'identifiants chiffrés par GPG
entre utilisateurs et groupes à l'échelle de l'organisation. Ce module déploie
l'image officielle `passbolt/passbolt` sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Passbolt et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Passbolt s'exécute comme un unique pod Apache/PHP sur GKE Autopilot. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Apache/PHP, port `80`, 1 vCPU / 2Gi par défaut, `min_instance_count = 1`, `max_instance_count = 1` |
| Base de données | Cloud SQL for MySQL (`MYSQL_8_0`) | Obligatoire — Passbolt est une application CakePHP exclusivement MySQL ; variables d'environnement distinctes `DATASOURCES_DEFAULT_*`, et non un DSN unique |
| État cryptographique | Deux volumes GCS Fuse dédiés (`storage`, `jwt`) | Contiennent la paire de clés GPG du serveur et la paire de clés JWT générées par l'application elle-même — **pas** des secrets générés par Terraform |
| Secrets | Secret Manager | Seul le mot de passe de la base de données est généré par le socle — Passbolt lui-même n'apporte aucun secret (la sortie `secret_ids` de `Passbolt_Common` est toujours vide) |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe par défaut, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL est obligatoire.** `database_type` se résout en `MYSQL_8_0` (imposé par
  `Passbolt_Common`) ; Passbolt repose sur CakePHP avec un schéma exclusivement
  MySQL.
- **Aucun secret applicatif côté serveur.** Contrairement à WordPress (plusieurs
  sels) ou aux applications de la famille Laravel (`APP_KEY`), Passbolt n'a
  aucune clé de chiffrement générée par Terraform. Son modèle de sécurité est
  entièrement côté client : l'extension de navigateur génère localement une
  paire de clés GPG et un mot de passe maître lors de la configuration. La paire
  de clés GPG propre au serveur (pour chiffrer des données *à destination de*
  Passbolt) et sa paire de clés JWT (jetons d'authentification de l'API) sont
  toutes deux générées par l'entrypoint de l'éditeur au premier démarrage et
  conservées sur des volumes GCS Fuse dédiés — elles ne sont ni créées ni
  renouvelées par Terraform.
- **Deux volumes GCS Fuse spécialisés, et non un seul, et pas tout le répertoire
  `/etc/passbolt`.** `storage` est monté de façon ciblée sur
  `/etc/passbolt/gpg` ; `jwt` est monté de façon ciblée sur `/etc/passbolt/jwt`.
  Monter un volume unique sur l'ensemble de `/etc/passbolt` masquerait les
  fichiers de configuration/PHP intégrés (`app.php`, `bootstrap.php`, `routes.php`)
  qui se trouvent directement dans ce répertoire de l'image — la même catégorie
  de bug que ce catalogue a déjà rencontrée avec Cloudreve.
- **Les options de montage GCS Fuse définissent explicitement `uid=33`/`gid=33` —
  une véritable correction de bug propre à GKE, et non une valeur par défaut
  défensive.** Même si le processus principal du conteneur de l'image
  `passbolt/passbolt` s'exécute en tant que root, la fonction `gpg_gen_key()` de
  l'entrypoint de l'éditeur effectue en réalité l'étape d'export de la clé en
  tant que `su ... www-data` (uid=33/gid=33). Le pilote GCS Fuse CSI de GKE —
  contrairement à l'intégration gcsfuse propre à Cloud Run — ne fournit pas par
  défaut un montage accessible en écriture à un UID non root ; les deux volumes
  définissent donc explicitement `uid=33`/`gid=33` (ainsi que
  `file-mode=0664`/`dir-mode=0775`) pour éviter `EACCES` au premier démarrage.
  Ce problème a été découvert et corrigé en conditions réelles : la même
  *catégorie* de bug qu'une application Node en uid 1000 a rencontrée ailleurs
  dans ce catalogue le même jour — vérifiez toujours l'UID d'exécution réel du
  processus qui écrit dans un chemin monté via GCS Fuse, et pas seulement le
  `USER` déclaré de l'image.
- **`HTTPS = "on"` est toujours injecté.** Le `bootstrap.php` de Passbolt a
  `$trustProxy = false` codé en dur ; il ne tient donc pas compte de
  `X-Forwarded-Proto` par défaut — mais il vérifie directement la valeur
  littérale de `env('HTTPS')`. Comme le LoadBalancer GKE termine le TLS en
  périphérie et transmet du HTTP simple au pod, cette surcharge statique permet
  à Passbolt de générer correctement des URL `https://` dans les e-mails et les
  liens absolus.
- **`enable_cloudsql_volume` vaut `true` par défaut ici** — conformément à la
  valeur par défaut de `Passbolt_Common`, et à l'inverse de `Passbolt_CloudRun`,
  dont la variable de premier niveau vaut `false` par défaut.
- **Pas d'assistant de configuration web à la première visite.** Le seul moyen
  de créer un compte administrateur est le job d'initialisation
  `admin-bootstrap`, qui affiche dans les journaux de son pod (remontés dans
  Cloud Logging) une URL de configuration à usage unique que l'opérateur ouvre
  dans une extension de navigateur compatible Passbolt.
- **Pas de Redis.** `enable_redis = false` par défaut — Passbolt n'a aucune
  intégration Redis utilisée par ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Passbolt {#a-gke-autopilot--the-passbolt-workload}

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Passbolt pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot et du type de charge de
travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL {#b-cloud-sql-for-mysql}

Passbolt stocke toutes les données applicatives — utilisateurs, groupes,
dossiers, ressources de mots de passe chiffrées, autorisations de partage — dans
une instance gérée Cloud SQL MySQL 8.0. Les pods y accèdent par défaut via le
sidecar **Cloud SQL Auth Proxy**, sur une connexion TCP en boucle locale
(`127.0.0.1`) (`enable_cloudsql_volume =
true`). La connexion utilise les noms de variables d'environnement distincts
propres à Passbolt
(`DATASOURCES_DEFAULT_HOST`/`_USERNAME`/`_PASSWORD`/`_DATABASE`, vérifiés dans le
fichier `/passbolt/env.sh` de l'éditeur), alimentés par le module applicatif à
partir des valeurs standard `DB_*` du socle.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes
automatiques et la rotation des mots de passe.

### C. Cloud Storage — les volumes des paires de clés GPG et JWT {#c-cloud-storage--the-gpg-and-jwt-keypair-volumes}

Deux buckets GCS sont provisionnés par `Passbolt_Common` et montés via le pilote
GCS Fuse CSI : `storage` sur `/etc/passbolt/gpg`, `jwt` sur
`/etc/passbolt/jwt`, tous deux avec les options de montage explicites `uid=33`/`gid=33` (voir la
vue d'ensemble). Ils contiennent la paire de clés GPG du serveur et la paire de
clés JWT générées par l'application, toutes deux créées une seule fois au premier
démarrage puis réutilisées à chaque démarrage suivant. La perte de l'un ou
l'autre bucket invalide tous les identifiants que Passbolt a chiffrés côté
serveur et toutes les sessions JWT émises.

- **Console :** Cloud Storage → repérez les deux buckets (leurs noms comportent
  les suffixes `storage` et `jwt`).
- **CLI :**
  ```bash
  gsutil ls -p "$PROJECT" | grep passbolt
  gsutil ls gs://<storage-bucket-name>/    # expect serverkey.asc, serverkey_private.asc
  ```

### D. Secret Manager {#d-secret-manager}

Passbolt lui-même n'apporte aucun secret — la seule entrée Secret Manager liée à
ce déploiement est le mot de passe de la base de données, géré par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~passbolt"
  ```

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe (`service_type = LoadBalancer`). Un domaine personnalisé avec un
certificat géré par Google peut être activé, et une IP statique est réservée par
défaut (`reserve_static_ip = true`) pour que l'adresse survive aux
redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging — y compris
l'URL de configuration à usage unique affichée par le job d'initialisation
`admin-bootstrap`. Les métriques GKE et Cloud SQL sont envoyées à Cloud
Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Passbolt {#3-passbolt-application-behaviour}

- **La chaîne de jobs d'initialisation en deux étapes, et pourquoi le second job
  n'a rien de trivial.** `Passbolt_Common` définit deux Jobs Kubernetes
  ordonnés, tous deux avec `execute_on_apply = true` :
  1. **`db-init`** (`mysql:8.0-debian`) — crée le rôle et la base de données
     MySQL (le script `db-init.sh` partagé par tout le catalogue, compatible
     `caching_sha2_password`).
  2. **`admin-bootstrap`** (`passbolt/passbolt:<version>`,
     `depends_on_jobs = ["db-init"]`, monte les volumes `storage` et `jwt`)
     — enregistre le compte administrateur initial.

     Les Jobs Kubernetes invoquent **directement** la `command`/les `args` d'un
     conteneur, en contournant entièrement la chaîne `/docker-entrypoint.sh` de
     l'éditeur — si bien qu'un simple `cake passbolt register_user` sur un
     conteneur fraîchement provisionné échoue avec une erreur interne 500, car
     la paire de clés GPG du serveur (normalement générée pendant la séquence de
     démarrage de l'entrypoint de l'éditeur) n'existe pas encore, et le schéma
     n'a pas non plus été installé. Le job charge donc les fonctions de
     l'entrypoint de l'éditeur (`/passbolt/entrypoint.sh`, `/passbolt/env.sh`,
     `/passbolt/deprecated_paths.sh`), génère ou importe la paire de clés GPG du
     serveur si elle manque, génère un certificat SSL autosigné s'il manque,
     exécute la fonction `install()` de l'éditeur (qui gère aussi la génération
     de la paire de clés JWT et l'installation/la migration du schéma de la base
     de données), et seulement ensuite exécute
     `cake passbolt register_user -u <admin_email> -f <admin_first_name>
     -l <admin_last_name> -r admin` — **sans** l'option `-q`/silencieuse, afin
     que l'URL de configuration à usage unique soit affichée et arrive dans les
     journaux du pod du job. Vérifié dans le code source réel
     `/passbolt/entrypoint.sh` de l'éditeur. Idempotent : `gpg_gen_key`/`install()`
     ne font rien une fois que les clés et le schéma existent déjà depuis une
     exécution précédente.

  Sur GKE, `execute_on_apply = false` (si jamais il était défini sur un job
  personnalisé) empêcherait seulement Terraform d'**attendre** le job — le Job
  et le pod Kubernetes sous-jacents sont de toute façon créés et planifiés
  immédiatement. Le respect de l'ordre `db-init` → `admin-bootstrap` repose ici
  sur `depends_on_jobs` (le système de dépendances de jobs d'App_GKE), et non sur
  le séquencement au moment de l'apply.

- **Pas d'assistant de configuration à la première visite, et un modèle
  d'amorçage réellement différent de la plupart des applications de ce
  catalogue.** Passbolt exige que le client (une extension de navigateur) génère
  sa propre paire de clés GPG et son mot de passe maître — il n'y a aucun mot de
  passe côté serveur à initialiser ni rien à récupérer dans Secret Manager.
  Récupérez plutôt l'URL de configuration à usage unique :
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<admin-bootstrap-job-name> | grep '/setup/start/'
  ```

- **Point de contrôle de santé.** `GET /healthcheck/status.json` renvoie un `200`
  sans authentification avec `{"header":{"status":"success",...},"body":"OK"}`
  une fois l'application prête — vérifié par des tests de conteneur en local et
  un déploiement réel. Les sondes `startup_probe`/`liveness_probe` au niveau du
  conteneur ciblent toutes deux ce chemin par défaut.

- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement.
Seuls les paramètres propres à Passbolt ou notables pour lui sont listés ; toutes
les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur comportement
et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. Utilisez une valeur distincte (par ex. `gke`) de celle d'un `Passbolt_CloudRun` déployé en parallèle (`cr`) pour éviter une collision de noms. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application et de la base de données {#group-3--application--database-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `passbolt` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Passbolt` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `passbolt/passbolt`. |
| `admin_email` | `admin@example.com` | Adresse e-mail du compte administrateur enregistré par `admin-bootstrap`. |
| `admin_first_name` / `admin_last_name` | `Admin` / `User` | Prénom et nom du compte administrateur initial. |
| `enable_gcs_storage_volume` | `true` | Monte les volumes GCS Fuse `storage` (GPG) et `jwt`. À laisser activé. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle ; Passbolt ne prend en charge que l'image préconstruite. |
| `cpu_limit` | `1000m` | 1 vCPU. |
| `memory_limit` | `2Gi` | Limite de mémoire — PHP 8.x + Apache. |
| `container_port` | `80` | Port d'écoute de Passbolt (Apache). |
| `min_instance_count` | `1` | Nombre minimal de réplicas de pod. |
| `max_instance_count` | `1` | Nombre maximal de réplicas de pod. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy. L'alias `DATASOURCES_DEFAULT_HOST` de Passbolt se résout en l'adresse de boucle locale du sidecar lorsqu'il est activé. |
| `enable_image_mirroring` | `true` | Copie l'image Passbolt dans Artifact Registry. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (se résout en `Deployment`) | `"Deployment"` ou `"StatefulSet"`. |
| `session_affinity` | `ClientIP` | Affinité de session du Service Kubernetes. |
| `namespace_name` | `""` (généré automatiquement) | Espace de noms Kubernetes. |

### Groupe 13 — NFS {#group-13--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un volume Filestore. **Non utilisé par le modèle de persistance de Passbolt** — les paires de clés GPG/JWT résident sur des volumes GCS Fuse dédiés et tout le reste dans MySQL. Valeur par défaut générique sans conséquence. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Buckets GCS supplémentaires à monter via le pilote GCS Fuse CSI, en plus des deux que Passbolt provisionne automatiquement (`storage`, `jwt`). |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` (se résout en `MYSQL_8_0`) | Moteur Cloud SQL. Passbolt nécessite MySQL. |
| `application_database_name` | `passbolt` | Nom de la base de données MySQL. |
| `application_database_user` | `passbolt` | Utilisateur applicatif MySQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne de 2 jobs par défaut de `Passbolt_Common` (`db-init` → `admin-bootstrap`). Une liste non vide la remplace entièrement. |
| `cron_jobs` | `[]` | Passbolt n'a par défaut aucune tâche récurrente planifiée par la plateforme. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/healthcheck/status.json` | Sondes au niveau du conteneur, transmises via `Passbolt_Common`. |
| `startup_probe_config` / `health_check_config` | Sondes du socle au niveau du LoadBalancer | Chemin `"/"` par défaut — distinctes des sondes au niveau du conteneur ci-dessus. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Passbolt. Présent pour la compatibilité avec la plateforme. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour des noms d'hôte personnalisés. |
| `reserve_static_ip` | `true` | Réserve une IP statique globale stable — recommandé pour que l'adresse du service ne change pas lors d'un redéploiement. |

Toutes les autres entrées (métadonnées du module, variables d'environnement et
secrets, CI/CD et intégration GitHub, SQL personnalisé, IAP et Cloud Armor,
configuration StatefulSet, VPC Service Controls, règles de fiabilité) sont
héritées d'`App_GKE` avec leur comportement standard — voir [App_GKE](App_GKE.md)
pour la liste complète, organisée par groupe.

---

## 5. Sorties {#5-outputs}

Renvoyées lorsqu'un déploiement réussit — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `service_external_ip` | ClusterIP interne au cluster / IP externe du LoadBalancer. |
| `service_url` | URL d'accès à Passbolt. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (`127.0.0.1` via le sidecar Auth Proxy) / port. |
| `storage_buckets` | Les buckets GCS `storage` (GPG) et `jwt`. |
| `container_image` | Image déployée. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (`db-init`, `admin-bootstrap`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources de charge de travail sont déployées. `false` lors du premier apply d'un nouveau cluster intégré — une nouvelle exécution termine le déploiement. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs et leurs
> combinaisons au moment du plan. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | se résout en `MYSQL_8_0` | Critique | Le schéma CakePHP de Passbolt est exclusivement MySQL — tout autre moteur empêche complètement le démarrage. |
| `enable_gcs_storage_volume` | `true` | Critique | Le désactiver supprime les volumes persistants de la paire de clés GPG du serveur et de la paire de clés JWT générées par l'application — tous les identifiants que Passbolt a chiffrés côté serveur, et toutes les sessions JWT émises, deviennent irrécupérables au prochain redémarrage du pod. |
| Options de montage GCS Fuse `uid=33`/`gid=33` | Déjà définies dans `Passbolt_Common` — ne pas les retirer si vous personnalisez `gcs_volumes` | Critique | Sans elles, `www-data` (l'uid sous lequel s'exécute réellement l'étape de génération des clés de l'entrypoint de l'éditeur) obtient `EACCES: permission denied` en écrivant les fichiers de clés GPG/JWT au premier démarrage, et le pod ne devient jamais réellement utilisable, même s'il se déclare Ready. |
| Ordre de `initialization_jobs` (`db-init` → `admin-bootstrap`) | Laissez `[]` sauf si vous maîtrisez parfaitement la dépendance | Critique | La reproduction, par le job `admin-bootstrap`, de la séquence de génération des clés GPG et d'installation du schéma de l'éditeur est indispensable — un job de remplacement naïf qui exécute directement `cake passbolt register_user` échoue avec une erreur interne, car la paire de clés GPG du serveur et le schéma n'existent pas encore. Sur GKE, `execute_on_apply=false` ne retarde PAS la planification du pod — seulement l'attente de Terraform — si bien que la garantie d'ordre provient entièrement de `depends_on_jobs`. |
| `enable_cloudsql_volume` | `true` (valeur par défaut de cette variante) | Élevé | Le sidecar Auth Proxy est le chemin de connectivité MySQL prévu sur GKE. |
| `reserve_static_ip` | `true` | Moyen | Sans IP statique réservée, l'adresse du LoadBalancer externe peut changer d'un redéploiement à l'autre, ce qui casse toute URL enregistrée en favori ou tout enregistrement DNS qui pointe vers elle. |
| `admin_email` / `admin_first_name` / `admin_last_name` | À définir délibérément avant le premier déploiement | Moyen | Ces valeurs initialisent l'unique compte administrateur créé par le job `admin-bootstrap` ; il n'existe ensuite aucun moyen de les modifier dans l'application, sauf via l'interface d'administration de Passbolt une fois connecté. |
| Aucun mot de passe administrateur à perdre | — | — | Contrairement à la plupart des applications de ce catalogue, il n'existe aucun identifiant administrateur conservé dans Secret Manager à récupérer. Si l'URL de configuration à usage unique est manquée et expire, la solution consiste à relancer le job `admin-bootstrap` (idempotent pour les étapes GPG/JWT/schéma ; consultez la documentation de la CLI de Passbolt pour réémettre un lien de configuration pour `register_user`). |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — voir **[App_GKE](App_GKE.md)**. La configuration applicative propre à
Passbolt, partagée avec la variante Cloud Run, est décrite dans **[Passbolt_Common](Passbolt_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Passbolt sur GKE Autopilot](../labs/Passbolt_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Passbolt sur Google Cloud Run](Passbolt_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Passbolt Common — configuration applicative partagée](Passbolt_Common.md) — la configuration partagée par les deux cibles de déploiement.
