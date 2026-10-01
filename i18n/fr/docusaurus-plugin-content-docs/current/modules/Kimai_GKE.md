---
title: "Kimai sur GKE Autopilot"
description: "Référence de configuration pour déployer Kimai sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Kimai_GKE.md @ 3055034 sha256:0856ca6f3cd0 -->

# Kimai sur GKE Autopilot {#kimai-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Kimai_GKE.png" alt="Kimai sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Kimai est une application libre et gratuite de suivi du temps (Symfony/PHP) utilisée
par les indépendants et les agences pour le suivi des heures facturables, les
feuilles de temps et les rapports qui alimentent la facturation. Ce module déploie
Kimai sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne
et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Kimai et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Kimai s'exécute comme un pod Symfony/PHP (l'image officielle `kimai/kimai2:apache`,
enveloppée dans un build personnalisé léger) sur GKE Autopilot. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Symfony/PHP, 1 vCPU / 2 GiB par défaut ; réplique unique par défaut (GKE n'a pas de mise à l'échelle à zéro) |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — `Kimai_Common` fixe le moteur ; PostgreSQL n'est pas pris en charge |
| Stockage objet | Cloud Storage | Un bucket `storage`, monté via GCS FUSE sur `/opt/kimai/var/data` pour les logos/modèles de factures téléversés et les données des plugins |
| Secrets | Secret Manager | `APP_SECRET` (clé de signature Symfony) et `ADMINPASS` (mot de passe administrateur) générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé et IP statique réservée pris en charge (voir §4 pour les valeurs par défaut réellement utilisées par le déploiement réel de ce module) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par
  `Kimai_Common` ; choisir un autre moteur casse le déploiement.
- **L'image wrapper personnalisée est requise, pas facultative.** `container_image_source
  = "custom"` construit une image légère `FROM kimai/kimai2`
  dont le point d'entrée compose l'unique chaîne de connexion `DATABASE_URL` de Kimai
  au démarrage du conteneur à partir des valeurs secrètes injectées par le socle
  (voir §3).
- **`container_port = 8001`**, et non le port 80 — confirmé par des tests locaux
  avec `docker run` et par un déploiement réel. C'est le port d'écoute effectif de
  la variante d'image `:apache`.
- **`enable_cloudsql_volume = true`** — c'est la **valeur par défaut inverse** de
  celle de `Kimai_CloudRun`. Un sidecar Cloud SQL Auth Proxy est injecté dans le pod
  et écoute sur `127.0.0.1` ; l'alias `DB_IP` du point d'entrée wrapper correspond
  ici à cette adresse de boucle locale, plutôt qu'à l'IP privée brute qu'utilise
  Cloud Run.
- **Deux secrets Secret Manager, générés une seule fois.** `APP_SECRET` (clé de
  signature CSRF/session Symfony) et `ADMINPASS` (mot de passe initial du
  super-administrateur) — tous deux réinjectés depuis Secret Manager à chaque
  démarrage du conteneur, si bien qu'aucun volume persistant n'est nécessaire juste
  pour les garder stables.
- **Pas de mise à l'échelle à zéro.** `min_instance_count = 1`,
  `max_instance_count = 1` par défaut ; GKE Autopilot maintient le nombre de
  répliques d'un Deployment au minimum configuré ou au-dessus.
- **`enable_nfs` vaut `true` par défaut mais est inutilisé en pratique.** Il monte
  un partage NFS Cloud Filestore sur `/var/lib/kimai`, mais le véritable chemin de
  stockage persistant est le bucket `storage` monté via GCS FUSE sur
  `/opt/kimai/var/data`. Rien n'écrit sur le montage NFS. Vous pouvez le désactiver
  sans risque.
- **Pas de job de migration distinct.** `kimai:install` (création du schéma et
  migrations) s'exécute à chaque démarrage du conteneur, de manière idempotente,
  dans le cadre de la chaîne de points d'entrée de l'éditeur — un seul job `db-init`
  suffit pour créer au préalable la base de données et l'utilisateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. Le namespace et les autres
identifiants figurent dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Kimai {#a-gke-autopilot--the-kimai-workload}

Kimai s'exécute par défaut comme un Deployment à réplique unique. Autopilot facture
le CPU et la mémoire effectivement demandés par le pod. Un sidecar Cloud SQL Auth
Proxy s'exécute à côté du conteneur principal (`enable_cloudsql_volume = true`).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Kimai pour voir les pods, les événements et les journaux. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -c <service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Kimai stocke toutes les données de l'application (projets, activités, feuilles de
temps, utilisateurs, factures) dans une instance gérée Cloud SQL for MySQL 8.0. Le
pod y accède en privé via un **sidecar Cloud SQL Auth Proxy** qui écoute sur
`127.0.0.1`. Au premier déploiement, un job `db-init` crée la base de données de
l'application et l'utilisateur ; `kimai:install` crée ensuite le schéma lors du
premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [Outputs](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatiques et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Deux buckets GCS peuvent exister pour ce déploiement : un bucket `storage`
provisionné par `Kimai_Common` et monté via GCS FUSE sur `/opt/kimai/var/data`
(logos/modèles de factures téléversés, données des plugins), et un bucket générique
**distinct** au niveau du socle (`storage_buckets`, par défaut un bucket nommé
`data`) que Kimai ne lit ni n'écrit, sauf si vous le raccordez explicitement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse CSI.

### D. Secret Manager {#d-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager :
`APP_SECRET` (clé de signature CSRF/session Symfony) et `ADMINPASS` (le mot de passe
initial du compte super-administrateur). Le mot de passe de la base de données est
géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~kimai"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe ; un Ingress Kubernetes pour les domaines personnalisés et une IP statique
réservée peuvent s'y ajouter (les deux valeurs par défaut du module sont `true`,
bien que le déploiement réel de ce module ait été exécuté avec les deux à
`false` — voir les [Outputs](#5-outputs) et §4).

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE
et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Kimai {#3-kimai-application-behaviour}

- **Une unique `DATABASE_URL` entièrement composée à l'exécution, et non transmise
  via Terraform.** La couche Doctrine DBAL de Kimai lit une seule chaîne de
  connexion,
  `DATABASE_URL=mysql://user:pass@host:port/db?charset=utf8mb4&serverVersion=8.0`,
  et non des variables `DB_*` distinctes. `Kimai_Common` construit une image wrapper
  personnalisée légère `FROM kimai/kimai2` dont le `entrypoint.sh` compose
  `DATABASE_URL` au démarrage du conteneur à partir des variables d'environnement
  `DB_USER`/`DB_NAME`/`DB_PASSWORD`/`DB_IP` injectées par le socle — en encodant le
  mot de passe pour l'URL avec `php -r 'echo rawurlencode(...)'` — avant de passer
  la main, sans modification, au `docker-php-entrypoint /entrypoint.sh` de
  l'éditeur.
- **Sur GKE, `DB_IP` correspond à la boucle locale du sidecar Auth Proxy.** Le
  wrapper lit l'hôte depuis `$DB_IP` (alias défini via `db_host_env_var_name =
  "DB_IP"`). Sur GKE, avec `enable_cloudsql_volume = true` (la valeur par défaut), il
  correspond à l'adresse `127.0.0.1` du sidecar cloud-sql-proxy — un hôte simple sans deux-points, tout comme l'IP privée brute
  qu'utilise la variante Cloud Run de ce même module. C'est pourquoi le même code de
  point d'entrée wrapper fonctionne sans modification sur les deux plateformes.
- **Vérifié en local avant tout passage au cloud.** L'étape d'encodage URL du mot
  de passe et la vérification préalable d'attente de la base de données propre à
  l'éditeur ont toutes deux été confirmées en construisant l'image wrapper et en
  l'exécutant localement contre un véritable conteneur MySQL avec un mot de passe
  contenant des caractères spéciaux (`@:/?`), ce qui a permis de détecter et de
  corriger des problèmes avant la première tentative de déploiement dans le cloud.
- **Comportement des contrôles de santé.** Les sondes de démarrage et de vivacité
  ciblent toutes deux `GET /en/login` (la page de connexion de Kimai), qui renvoie
  `200` une fois l'application prête.
  ```bash
  EXTERNAL_IP=$(kubectl get svc -n "$NAMESPACE" -o jsonpath='{.items[0].status.loadBalancer.ingress[0].ip}')
  curl -s -o /dev/null -w "%{http_code}\n" "http://${EXTERNAL_IP}/en/login"   # expect 200
  ```
- **L'amorçage de l'administrateur s'exécute à chaque démarrage, de manière
  idempotente.** Le point d'entrée de l'éditeur exécute `kimai:user:create admin "$ADMINMAIL" ROLE_SUPER_ADMIN
  "$ADMINPASS"` à chaque démarrage du conteneur dès que `ADMINPASS` est défini —
  sans effet une fois le compte existant. **Le nom d'utilisateur est toujours
  `admin`**, codé en dur par l'image de l'éditeur, quelle que soit la valeur de
  `admin_email`.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Kimai ou notables pour Kimai sont
listés ; toutes les autres entrées sont héritées de [App_GKE](App_GKE.md) avec leur
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du cluster et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `kimai` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Kimai` | Nom lisible affiché dans la console. |
| `application_description` | `Kimai time tracking on GKE` | Description de la charge de travail Kubernetes. |
| `application_version` | `latest` | Tag d'image qui pilote le build `kimai/kimai2`. `"latest"` correspond au tag glissant maintenu `:apache` ; toute autre valeur correspond à `"<version>-apache"`. |
| `admin_email` | `admin@example.com` | Adresse e-mail du compte super-administrateur, injectée sous `ADMINMAIL`. Le nom d'utilisateur du compte est toujours `admin`, codé en dur par le point d'entrée de l'éditeur. |
| `enable_gcs_storage_volume` | `true` | Monte via GCS FUSE le bucket `storage` sur `/opt/kimai/var/data`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_image_source` | `custom` | Construit via Cloud Build l'image wrapper qui compose `DATABASE_URL` — requise, et non facultative, pour ce module. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | GKE n'a pas de mise à l'échelle à zéro ; réplique unique par défaut. |
| `container_port` | `8001` | La variante d'image `:apache` de Kimai écoute sur 8001, confirmé par des tests locaux et un déploiement réel. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Limites de ressources par pod. |
| `php_memory_limit` | `512M` | `memory_limit` de PHP (le point d'entrée de l'éditeur lit directement la variable d'environnement en minuscules `memory_limit`). |
| `enable_cloudsql_volume` | `false` | Sidecar Cloud SQL Auth Proxy sur `127.0.0.1`. **Conservez `true` sur GKE** — l'alias `DB_IP` du wrapper en dépend. |

### Groupe 6 — Backend et cluster GKE {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe par défaut. |
| `session_affinity` | `ClientIP` | Achemine les requêtes d'un client vers le même pod. |
| `workload_type` | `null` | Se résout automatiquement en `Deployment` (Kimai n'a pas besoin d'identité PVC par pod). |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser l'unique job `db-init` intégré. Il n'y a pas de job de migration distinct — `kimai:install` s'exécute à chaque démarrage du conteneur, de manière idempotente. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | **Inutilisé en pratique** — monté sur `/var/lib/kimai`, mais le véritable stockage persistant de Kimai est le bucket `storage` monté via GCS FUSE sur `/opt/kimai/var/data`. Vous pouvez le désactiver sans risque. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique au niveau du socle. Ni lu ni écrit par Kimai. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires, fusionnés avec le montage du bucket `storage`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` (se résout en `MYSQL_8_0`) | Fixé par `Kimai_Common`. |
| `application_database_name` / `application_database_user` | `kimai` | Préfixés par le tenant au moment du déploiement. Immuables après le premier déploiement. |
| `db_host_env_var_name` | `DB_IP` | Crée un alias de l'hôte de la base afin que la composition de `DATABASE_URL` par le wrapper lise un hôte simple, sans deux-points — correspond à la boucle locale du sidecar Auth Proxy sur GKE. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `db_password_env_var_name` | `""` (les quatre) | **Inutilisés par Kimai** — le wrapper lit directement les variables standard `DB_USER`/`DB_NAME`/`DB_PASSWORD` et code en dur le port `3306`. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress Kubernetes avec `application_domains`. Le déploiement réel de ce module, vérifié en conditions réelles, l'a défini à `false` (voir `config/deploy.tfvars`). |
| `reserve_static_ip` | `true` | Une IP stable qui survit aux redéploiements. Le déploiement réel de ce module, vérifié en conditions réelles, l'a également défini à `false`. |
| `network_tags` | `["nfsserver"]` | Ciblage du pare-feu ; requis pour la connectivité NFS lorsque `enable_nfs = true`. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Kimai n'a aucune intégration Redis native utilisée par ce module — son backend de cache par défaut est le système de fichiers local. |

Toutes les autres entrées (métadonnées du groupe 0, environnement du groupe 2,
secrets du groupe 5, StatefulSet du groupe 7, quota de ressources du groupe 8,
fiabilité du groupe 9, observabilité du groupe 10, CI/CD du groupe 12, sauvegarde du
groupe 17, SQL personnalisé du groupe 18, IAP du groupe 20, Cloud Armor du
groupe 21, VPC-SC du groupe 22) se comportent exactement comme documenté dans
[App_GKE](App_GKE.md).

---

## 5. Outputs {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Namespace Kubernetes. |
| `service_cluster_ip` / `service_external_ip` | IP interne / externe. |
| `service_url` | URL du service. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` | `127.0.0.1` via le sidecar Cloud SQL Auth Proxy. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Nom du job de configuration (`db-init`). |
| `kubernetes_ready` | Indique si le point de terminaison du cluster est disponible et si toutes les ressources K8s sont déployées. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs
> combinaisons* au moment du plan. Une configuration invalide fait échouer le
> **plan** avec une erreur claire et nommée avant la création de toute ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `container_image_source` | `custom` | **Critical** | Passer à `prebuilt` déploie l'image `kimai/kimai2` standard sans point d'entrée wrapper — `DATABASE_URL` n'est jamais composée, si bien que le pod ne peut pas du tout joindre MySQL. |
| `enable_cloudsql_volume` | `true` sur GKE | **Critical** | La définir à `false` supprime le sidecar Auth Proxy dont dépend l'alias `DB_IP` du point d'entrée wrapper pour joindre Cloud SQL — le pod ne peut pas se connecter. |
| `container_port` | `8001` | Critical | La variante d'image `:apache` écoute sur 8001, et non 80 — pointer la plateforme vers le mauvais port rend le service injoignable alors même que le conteneur est sain. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les feuilles de temps, tous les projets et toutes les factures. |
| `APP_SECRET` (généré automatiquement) | Ne jamais le modifier à la main dans Secret Manager après le premier démarrage | High | Kimai l'utilise comme clé de signature de sécurité Symfony ; le modifier invalide les jetons CSRF et les sessions actives. |
| Compte administrateur par défaut (nom d'utilisateur toujours `admin`, mot de passe dans le secret `ADMINPASS`) | Récupérez rapidement le mot de passe généré dans Secret Manager et connectez-vous | High | Le mot de passe administrateur est un véritable secret généré par déploiement, et non une valeur par défaut publique bien connue — mais il reste utile de vérifier qui a un accès en lecture au secret. |
| `max_instance_count` | `1` sauf vérification contraire | High | Passer à plus d'un pod sans vérifier le comportement des sessions de Kimai sur plusieurs pods expose à des sessions utilisateur incohérentes d'un pod à l'autre. |
| `enable_nfs` | `false` sauf besoin pour un autre usage | Low / coût | Vaut `true` par défaut et provisionne un partage Filestore que Kimai n'utilise jamais — un coût récurrent inutile ; la véritable persistance est le bucket `storage` monté via GCS FUSE. |
| `enable_cloud_armor` | à activer en production | Medium | Le service est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement du socle évoqué tout au long de cette page — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et duplication d'images — consultez **[App_GKE](App_GKE.md)**. La
configuration applicative propre à Kimai, partagée avec la variante Cloud Run, est
décrite dans **[Kimai_Common](Kimai_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Kimai sur GKE Autopilot](../labs/Kimai_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Kimai sur Google Cloud Run](Kimai_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Kimai Common — Configuration applicative partagée](Kimai_Common.md) — la configuration partagée par les deux cibles de déploiement.
