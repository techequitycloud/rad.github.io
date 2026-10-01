---
title: "Homepage sur Google Cloud Run"
description: "Référence de configuration pour déployer Homepage sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Homepage_CloudRun.md @ 3055034 sha256:56c00487ade1 -->

# Homepage sur Google Cloud Run {#homepage-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Homepage_CloudRun.png" alt="Homepage sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

[Homepage](https://gethomepage.dev/) (gethomepage/homepage) est un tableau de
bord / lanceur de services auto-hébergé et hautement personnalisable — une
application Next.js 16 / Node 22 dont toute la configuration (services, favoris,
widgets, mise en page) tient dans une poignée de fichiers YAML, avec des widgets
facultatifs d'état et de statistiques en direct pour les autres applications
auto-hébergées que vous exploitez. Ce module déploie Homepage sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Homepage et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Homepage s'exécute sous la forme d'un unique conteneur Node.js/Next.js sur Cloud
Run v2. Contrairement à presque tous les autres modules de ce catalogue, il n'a
**ni base de données ni cache** — tout son état est un répertoire de fichiers
YAML :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Processus Node.js unique, `1000m` de CPU / `512Mi` de mémoire par défaut |
| Base de données | aucune | Homepage n'a aucune base de données ; `database_type = "NONE"` |
| Stockage objet | Cloud Storage | Un bucket `storage` monté sur `/app/config` via GCS FUSE — contient tous les fichiers de configuration YAML (`settings.yaml`, `services.yaml`, `bookmarks.yaml`, `widgets.yaml`, `docker.yaml`) ainsi que les journaux |
| Cache et file d'attente | aucun | `enable_redis = false` est codé en dur dans `main.tf`, remplaçant la valeur par défaut `true` de la fondation |
| Secrets | aucun | Aucun secret n'est généré — Homepage n'a besoin d'aucun identifiant propre |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Réellement préconstruit — pas d'image personnalisée, pas de Cloud Build pour
  l'application.** `Homepage_Common` définit `image_source = "prebuilt"` et
  `container_build_config.enabled = false` ; `ghcr.io/gethomepage/homepage` est
  déployée directement. `enable_image_mirroring = true` la copie tout de même dans
  Artifact Registry (pour éviter les limites de débit de GHCR), mais il s'agit d'un
  miroir, pas d'un build.
- **Port 3000, chemin de santé `/api/healthcheck`.** Confirmé sur un déploiement
  réel : `GET /api/healthcheck` renvoie un `200 "up"` non authentifié dès que
  l'application est prête (adossé à la directive `HEALTHCHECK` de l'image
  elle-même).
- **Ni base de données ni Redis — architecture inhabituelle pour ce catalogue.**
  Presque tous les autres modules applicatifs raccordent une instance Cloud SQL
  et/ou Redis via la fondation ; Homepage n'a besoin ni de l'une ni de l'autre.
  Cela signifie aussi qu'il échappe aux catégories de bugs habituelles —
  raccordement du DSN, socket ou TCP, encodage d'URL du mot de passe — documentées
  ailleurs dans ce dépôt : il n'y a tout simplement aucune connexion à une base de
  données à mal configurer.
- **La mise à l'échelle à zéro et le multi-instance sont tous deux réellement
  sûrs.** Homepage lit sa configuration YAML en direct sur le disque à chaque
  requête (aucun cache dans le processus), et son auto-amorçage unique de la
  configuration au premier démarrage est idempotent. Le module utilise par défaut
  `min_instance_count = 0` / `max_instance_count = 3` — la plupart des
  applications avec état de ce catalogue ont besoin de l'inverse (`min = 1`,
  `max = 1`) pour éviter les pertes au démarrage à froid ou une course entre
  écrivains ; Homepage n'a besoin d'aucun de ces garde-fous.
- **Aucune authentification propre.** `HOMEPAGE_ALLOWED_HOSTS` vaut `"*"` par
  défaut — cela ne conditionne que la vérification de l'en-tête `Host` sur les
  appels `/api/*` de données des widgets de Homepage, et non un véritable contrôle
  d'accès. Placez-le derrière IAP, un VPN ou un reverse proxy si vous devez
  restreindre qui peut y accéder.
- **Un remplacement des options de montage GCS FUSE documenté et vérifié sur
  Cloud Run.** `Homepage_Common` demande `uid=1000,gid=1000` dans les
  `mount_options` du volume (correspondant aux `PUID`/`PGID` du conteneur), mais
  l'intégration gcsfuse intégrée de Cloud Run substitue silencieusement ses propres
  `uid=2000,gid=2000` — confirmé par la ligne de journal GCSFuse « CLI Flags » au
  moment du déploiement. Cela n'a eu aucun impact fonctionnel (le montage est resté
  cohérent et accessible en écriture), mais il est bon de le savoir pour qu'un
  futur mainteneur ne suppose pas que les `mount_options` configurées sont
  respectées à la lettre sur Cloud Run.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Homepage {#a-cloud-run--the-homepage-service}

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence et la répartition du trafic.

### B. Cloud Storage — le volume de configuration {#b-cloud-storage--the-configuration-volume}

Le bucket `storage` est monté sur `/app/config` via GCS FUSE. Il contient tous les
fichiers de configuration YAML que lit Homepage (`settings.yaml`, `services.yaml`,
`bookmarks.yaml`, `widgets.yaml`, `docker.yaml`) ainsi que les journaux de
Homepage — ce bucket **constitue** tout l'état persistant de Homepage ; il n'y a
rien d'autre à sauvegarder.

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~homepage"
  gcloud storage ls "gs://<bucket-name>/"
  gcloud storage cat "gs://<bucket-name>/settings.yaml"
  ```

### C. Secret Manager {#c-secret-manager}

Rien à voir ici — Homepage ne génère aucun secret. Le confirmer constitue en soi
un contrôle de cohérence utile sur un déploiement neuf :

```bash
gcloud secrets list --project "$PROJECT" --filter="name~homepage"
# expect: no results
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
  Recherchez la ligne de journal GCSFuse « CLI Flags » au démarrage pour confirmer
  l'UID/GID réellement monté (voir le §1 ci-dessus — elle indiquera
  `uid=2000,gid=2000` sur Cloud Run, quelles que soient les `mount_options`
  configurées).

---

## 3. Comportement de l'application Homepage {#3-homepage-application-behaviour}

- **Aucun job de schéma de base de données au premier déploiement.** Homepage n'a
  pas de base de données ; `initialization_jobs` est donc vide par défaut et aucun
  job n'est nécessaire.
- **Aucun assistant de configuration au premier lancement.** Il n'y a aucun compte
  administrateur à créer ni parcours d'accueil — Homepage affiche son tableau de
  bord à partir de la configuration présente dans `/app/config` (les valeurs par
  défaut fournies avec l'image amont sur un déploiement neuf, puisque le point
  d'entrée amorce lui-même tout fichier manquant). Personnalisez le tableau de bord
  en modifiant directement les fichiers YAML (voir §2B) ou en configurant
  `docker.yaml` / la découverte par libellés si vous le connectez à une API
  Docker/Kubernetes.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes deux
  `GET /api/healthcheck` — un `200 "up"` non authentifié, confirmé en conditions
  réelles.
- **Inspecter l'exécution des jobs (ne devrait rien afficher, par conception) :**
  ```bash
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

### Le remplacement des options de montage GCS FUSE — bon à savoir, sans motif d'inquiétude {#the-gcs-fuse-mount-option-override--worth-knowing-not-worth-worrying-about}

`Homepage_Common` définit explicitement des `mount_options` avec
`uid=1000,gid=1000` sur le volume GCS `/app/config`, correspondant aux variables
d'environnement `PUID=1000`/`PGID=1000` du conteneur. Sur un déploiement réel, la
ligne GCSFuse « CLI Flags » de Cloud Logging au démarrage du conteneur montre que
le montage *réel* utilise `uid=2000,gid=2000` — l'intégration gcsfuse intégrée de
Cloud Run remplace inconditionnellement la valeur configurée. Lors des tests, cela
n'a eu **aucun impact fonctionnel** : le montage est resté cohérent (l'UID/GID
remplacé par Cloud Run correspondait à celui utilisé par le montage pour toutes
les écritures suivantes) et l'application a démarré et écrit sa configuration sans
problème. La leçon est plus limitée qu'un bug : ne supposez pas que l'UID/GID des
`mount_options` que vous configurez est celui qu'utilise réellement Cloud Run —
vérifiez-le via la ligne de journal si vous devez un jour déboguer un véritable
problème de permissions ici. (Ceci est propre à l'intégration gcsfuse de Cloud
Run ; le pilote CSI GCS FUSE distinct de GKE n'effectue pas un tel remplacement et
exige réellement que l'UID/GID configuré corresponde à l'utilisateur du conteneur
— voir le constat gcsfuse sur GKE mentionné dans le CLAUDE.md de ce dépôt.)

```bash
gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 100 \
  | grep -i "gcsfuse"
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Homepage ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `homepage` | Nom de base des ressources. |
| `application_display_name` | `Homepage` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Transmis tel quel comme tag de l'image `ghcr.io/gethomepage/homepage` — aucune étape de build. |
| `homepage_allowed_hosts` | `*` | `HOMEPAGE_ALLOWED_HOSTS` — liste d'autorisation, séparée par des virgules, de l'en-tête `Host` pour les appels `/api/*` de Homepage lui-même. Ce n'est pas une véritable frontière de contrôle d'accès. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `container_port` | `3000` | Port du serveur Next.js standalone de Homepage. |
| `cpu_limit` / `memory_limit` | `1000m` / `512Mi` | Léger — le plancher de 512Mi de gen2 est largement suffisant. |
| `min_instance_count` / `max_instance_count` | `0` / `3` | Les deux sens sont réellement sûrs ici — voir §1 ; un cas rare dans ce catalogue où la valeur par défaut large est intentionnelle, et non un simple paramètre fictif. |
| `enable_image_mirroring` | `true` | Met l'image préconstruite en miroir dans Artifact Registry (pour éviter les limites de débit de GHCR) — pas un build. |
| `container_protocol` | `http1` | HTTP/1.1 simple ; aucune exigence gRPC/h2c. |
| `enable_cloudsql_volume` | `false` | Homepage n'a pas de Cloud SQL — conservez `false`. |

### Groupe 11 — Cloud Storage et système de fichiers {#group-11--cloud-storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le montage du bucket `storage` sur `/app/config` est ajouté automatiquement ; n'utilisez cette variable que pour des volumes *supplémentaires*. |
| `enable_nfs` | `false` | Inutile — GCS FUSE sur `/app/config` suffit pour la charge de travail de fichiers de configuration de Homepage. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé par `Homepage_Common` — Homepage n'a aucune base de données SQL, un point c'est tout. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Reste vide par défaut — rien à amorcer. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/healthcheck` | `200 "up"` non authentifié — une valeur par défaut exacte, correspondant à la directive `HEALTHCHECK` de l'image, transmise sans modification depuis `Homepage_Common`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `homepage_url` | Nom du service Cloud Run et URL du tableau de bord (port 3000). |
| `storage_buckets` | Le bucket `storage` qui soutient `/app/config`. |
| `container_image` / `container_registry` | Référence de l'image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `initialization_jobs` | Noms des jobs d'initialisation créés (vide pour Homepage). |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `gcs_volumes` / stockage sur `/app/config` | Laisser en place le montage automatique `storage` | **Critique** | Supprimer ou mal configurer ce volume fait perdre tous les fichiers de configuration YAML au prochain démarrage à froid — Homepage n'a aucune autre source de vérité. |
| `HOMEPAGE_ALLOWED_HOSTS` | Laisser `*` sauf si vous connaissez le nom d'hôte final, puis le restreindre | Moyen | Une valeur trop restrictive renvoie un 400 pour chaque widget adossé à l'API (le squelette de la page se charge quand même) si le nom d'hôte réel de la requête ne correspond pas ; le traiter comme une véritable frontière d'authentification procure de toute façon un faux sentiment de sécurité. |
| Chemin de sonde | Laisser `/api/healthcheck` | Élevé | Un chemin de sonde authentifié ou inexistant laisserait la révision durablement non saine alors même que l'application a démarré correctement. |
| `enable_redis` | Ne pas toucher au `false` codé en dur (ne tentez pas de le forcer via `environment_variables`) | Faible | Homepage n'a rien à mettre en cache ; activer Redis ajoute une dépendance Memorystore/NFS-Redis inutile. |
| UID/GID supposé du montage GCS FUSE | Ne pas compter sur le fait que `uid=1000,gid=1000` soit appliqué à la lettre sur Cloud Run | Faible | L'intégration gcsfuse propre à Cloud Run utilise silencieusement `uid=2000,gid=2000` à la place — sans conséquence en pratique, mais une fausse piste si vous déboguez un problème de permissions en lisant le Terraform au lieu de la ligne de journal du montage réel. |

---

Pour le comportement de la fondation évoqué tout au long de ce guide — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à Homepage est décrite dans
**[Homepage_Common](Homepage_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Homepage sur Cloud Run](../labs/Homepage_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Homepage sur GKE Autopilot](Homepage_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Homepage Common — Configuration applicative partagée](Homepage_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md) et [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) dans la solution **Small Business Suite**.
