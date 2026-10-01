---
title: "Radicale sur Google Cloud Run"
description: "Référence de configuration pour déployer Radicale sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Radicale_CloudRun.md @ 3055034 sha256:ac7741ed2bc1 -->

# Radicale sur Google Cloud Run {#radicale-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Radicale_CloudRun.png" alt="Radicale sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Radicale est un **serveur CalDAV/CardDAV** open source et auto-hébergé pour la
synchronisation des agendas et des contacts — une application WSGI légère, en
pur Python, sans framework ni base de données. Il stocke chaque agenda et
chaque carnet d'adresses sous forme de simples fichiers iCalendar/vCard sur
disque. Ce module déploie Radicale sur **Cloud Run v2** en s'appuyant sur le
socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Radicale et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à toutes les applications
Cloud Run — identité du service, entrée et équilibrage de charge, mise à
l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Radicale s'exécute comme un conteneur WSGI Python unique sur Cloud Run v2. Le
déploiement assemble un ensemble restreint et ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Processus Python unique, 1 vCPU / 1 GiB par défaut, mise à l'échelle à zéro |
| Base de données | aucune | Radicale stocke chaque collection sous forme de simples fichiers — aucune instance Cloud SQL n'est créée |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est monté sur `/var/lib/radicale` via GCS FUSE — la source unique de vérité pour toutes les données |
| Cache et file d'attente | aucun | Radicale ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Un véritable `ADMIN_PASSWORD` généré — Radicale n'est livré avec aucun compte administrateur par défaut |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données, quelle qu'elle soit.** `Radicale_Common` impose
  `database_type =
  "NONE"` — Radicale est un pur stockage sur système de fichiers.
- **Build personnalisé à enveloppe fine.** `Radicale_Common` ajoute un point
  d'entrée cloud à l'image officielle `ghcr.io/kozea/radicale` via Cloud Build,
  puis met en miroir le résultat dans Artifact Registry.
- **Aucun compte administrateur par défaut — un véritable secret généré.**
  Contrairement aux applications livrées avec un identifiant de première
  connexion bien connu, l'authentification de Radicale vaut `denyall` par
  défaut tant qu'elle n'est pas configurée. `Radicale_Common` génère et injecte
  un véritable `ADMIN_PASSWORD` à chaque déploiement (consultez le
  [guide Common](Radicale_Common.md)).
- **`max_instance_count` fixé à `1`, `min_instance_count` vaut `0` par
  défaut.** Le backend de stockage de Radicale n'est pas conçu pour un accès
  concurrent par plusieurs instances, mais il n'a ni base de données ni index à
  préchauffer au démarrage, si bien que la mise à l'échelle à zéro est sûre et
  rapide.
- **MKCOL est bloqué en périphérie sur Cloud Run — lisez le §3 avant de
  déployer.** La création d'un *nouvel* agenda ou carnet d'adresses nécessite
  normalement la méthode WebDAV `MKCOL`, que le frontal Cloud Run de Google
  rejette avant même qu'elle n'atteigne le conteneur. Une tâche d'amorçage par
  défaut contourne ce problème — voir ci-dessous.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
du service et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Radicale {#a-cloud-run--the-radicale-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence et la répartition du trafic.

### B. Cloud Storage — la source unique de vérité {#b-cloud-storage--the-single-source-of-truth}

Le bucket `storage` est monté sur `/var/lib/radicale` via GCS FUSE. Chaque
agenda, carnet d'adresses et élément, ainsi que les fichiers htpasswd et de
configuration générés, se trouvent ici — perdre ce bucket fait perdre tout
l'état de Radicale.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~radicale"
  gcloud storage ls "gs://<bucket-name>/collections/collection-root/"
  ```

### C. Secret Manager {#c-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~radicale"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Radicale {#3-radicale-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Il n'y a
  pas de tâche `db-init` — Radicale n'a aucune base de données à initialiser.
- **`seed-default-collections` s'exécute au moment du déploiement.** Un Job
  d'initialisation ponctuel (`execute_on_apply = true`) écrit un « Default
  Calendar » et un « Default Address Book » directement sur le volume de
  stockage pour l'utilisateur administrateur, en contournant entièrement HTTP.
  Il existe en raison d'une véritable limitation de la plateforme — voir
  l'encadré ci-dessous.
- **Aucun compte administrateur par défaut.** L'authentification de Radicale
  vaut `denyall` par défaut tant qu'aucun fichier htpasswd n'existe.
  `Radicale_Common` génère un véritable `ADMIN_PASSWORD` et le point d'entrée
  cloud écrit à la fois la configuration INI et une entrée htpasswd bcrypt **à
  chaque démarrage** (pas seulement au premier — il n'existe aucune table
  d'utilisateurs permettant de vérifier si l'initialisation a déjà eu lieu).
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — la
  redirection `302` non authentifiée de Radicale vers son interface web,
  considérée comme saine par les deux types de sondes.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### ⚠ MKCOL est bloqué par le frontal de Cloud Run — le point le plus important à connaître sur ce module {#-mkcol-is-blocked-by-cloud-runs-frontend--the-most-important-thing-to-know-about-this-module}

La création d'une **nouvelle** collection (agenda ou carnet d'adresses) via le
protocole standard CalDAV/CardDAV nécessite la méthode HTTP WebDAV `MKCOL`.
Ce comportement a été confirmé en conditions réelles après un débogage
approfondi sur trois tentatives de déploiement distinctes :

- **Le frontal de Cloud Run de Google (GFE) rejette `MKCOL` en périphérie**
  avec une page d'erreur Google générique « 400 Bad Request » — la requête
  n'atteint jamais le conteneur Radicale. Toutes les autres méthodes (GET, PUT,
  PROPFIND) passent sans problème ; cela concerne spécifiquement MKCOL.
- Les services Cloud Run n'offrent **aucun accès shell/exec**, si bien qu'il
  n'existe pas non plus de contournement manuel possible pour un opérateur
  après coup.
- Sans correctif, un nouveau déploiement `Radicale_CloudRun` serait incapable
  de créer *le moindre* agenda — ni via un client standard (Apple Calendar,
  Thunderbird, DAVx5), ni même via l'interface web de Radicale, qui émet
  elle aussi MKCOL en interne.

**Le correctif :** le job d'initialisation par défaut
`seed-default-collections` de `Radicale_Common` écrit l'arborescence des
collections directement sur le volume de stockage — un simple conteneur avec
accès au système de fichiers, sans couche HTTP/GFE. Il s'exécute
automatiquement à chaque déploiement (`execute_on_apply = true`) et amorce un
« Default Calendar » et un « Default Address Book » pour l'utilisateur
administrateur. Vérifié en conditions réelles : un `PROPFIND` sur le principal
de l'administrateur liste correctement les deux collections, et un véritable
`VEVENT` peut être envoyé par `PUT` puis récupéré par `GET` avec succès.

**Si vous avez besoin de collections supplémentaires au-delà des deux créées
par défaut**, vous ne pouvez pas les créer via un client standard sur Cloud
Run. Fournissez une entrée `initialization_jobs` personnalisée qui les écrit de
la même manière, ou utilisez `Radicale_GKE`, dont le simple Service
LoadBalancer L4 ne présente aucune restriction sur MKCOL.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de
déploiement. Seuls les paramètres propres à Radicale ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `radicale` | Nom de base des ressources. |
| `application_display_name` | `Radicale` | Nom lisible affiché dans l'interface de la plateforme et la console Cloud Run. |
| `application_version` | `latest` | Se résout vers le build épinglé `RADICALE_VERSION=3.7.7` — les tags GHCR n'ont pas de préfixe `v`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `5232` | Port par défaut natif de Radicale. |
| `min_instance_count` / `max_instance_count` | `0` / `1` | Mise à l'échelle à zéro ; `max` est fixé à `1`, sans dérogation possible. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry (évite les limites de débit de GHCR). |
| `container_protocol` | `http1` | Correct — Radicale sert du HTTP/1.1 simple. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | un bucket `storage` | Monté sur `/var/lib/radicale` via GCS FUSE — la source unique de vérité pour tout l'état de Radicale. |
| `gcs_volumes` | `[]` | Le montage du bucket `storage` est ajouté automatiquement ; utilisez ce paramètre uniquement pour des volumes *supplémentaires*. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Imposé par `Radicale_Common` — Radicale n'a aucune base de données, quelle qu'elle soit. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `seed-default-collections` (injectée par `Radicale_Common`) | Contourne la restriction MKCOL de Cloud Run — voir le §3. Fournir une liste personnalisée remplace entièrement cette valeur par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Redirection 302 non authentifiée de Radicale vers son interface web ; les deux types de sondes considèrent les codes 2xx–3xx comme sains. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `radicale_url` | Nom du service Cloud Run et URL interne/publique (remarque : cette sortie s'appelle `radicale_url`, et non `service_url`). |
| `storage_buckets` | Le bucket `storage` qui sous-tend `/var/lib/radicale`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (y compris `seed-default-collections`). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Création de nouvelles collections via un client CalDAV/CardDAV | S'appuyer sur les collections amorcées par défaut, ou utiliser `Radicale_GKE` pour créer librement de nouvelles collections | **High** | `MKCOL` est rejeté en périphérie de Cloud Run (GFE) avant d'atteindre le conteneur — aucun client standard, ni même l'interface web de Radicale, ne peut créer une NOUVELLE collection sur cette plateforme. Seules les deux collections amorcées au déploiement existent, sauf si vous fournissez un job d'initialisation personnalisé. |
| `max_instance_count` | Laisser à `1` | **Critical** | Le backend de stockage de Radicale utilise le verrouillage de fichiers au niveau du système d'exploitation et n'est pas conçu pour un accès concurrent par plusieurs instances ; augmenter cette valeur expose à une corruption des données. |
| Identifiant administrateur | À récupérer dans Secret Manager après le premier déploiement | **Critical** | Contrairement aux applications dotées d'un identifiant par défaut bien connu, Radicale génère un véritable secret — impossible de se connecter tant que vous n'avez pas récupéré `ADMIN_PASSWORD`. |
| `stateful_pvc_enabled` (sans objet sur Cloud Run) | Utiliser `Radicale_GKE` en production | Medium | Le montage GCS FUSE de Cloud Run offre une sémantique de verrouillage de fichiers plus faible que celle attendue par le backend de stockage de Radicale ; acceptable uniquement parce que la concurrence est limitée à 1 instance. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_CloudRun](App_CloudRun.md)**. La
configuration applicative propre à Radicale partagée avec la variante GKE est
décrite dans **[Radicale_Common](Radicale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Radicale sur Cloud Run](../labs/Radicale_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Radicale sur GKE Autopilot](Radicale_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Radicale Common — Configuration applicative partagée](Radicale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Monica sur Google Cloud Run](Monica_CloudRun.md), [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Personal Organiser**.
