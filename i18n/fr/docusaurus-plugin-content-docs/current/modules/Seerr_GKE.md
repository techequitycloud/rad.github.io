---
title: "Seerr sur GKE Autopilot"
description: "Référence de configuration pour déployer Seerr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Seerr_GKE.md @ 3055034 sha256:732fe16733e6 -->

# Seerr sur GKE Autopilot {#seerr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Seerr_GKE.png" alt="Seerr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Seerr est la fusion, en 2026, de **Jellyseerr** et d'**Overseerr** — une
interface de demandes open source sous licence MIT, placée devant un serveur
multimédia Jellyfin, Plex ou Emby. Les utilisateurs parcourent et demandent des
titres ; un administrateur approuve la demande, et Seerr appelle les API de
Sonarr et Radarr pour déclencher l'acquisition. Ce module déploie Seerr sur
**GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Seerr et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne
de commande. Pour les mécanismes communs à toute application GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

Seerr s'exécute comme un unique pod Node.js/Next.js. Le déploiement assemble un
petit ensemble de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un seul pod exécutant un processus Node.js, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL PostgreSQL 15 | Contient les données de demandes et d'utilisateurs ; les migrations s'exécutent automatiquement à chaque démarrage du pod |
| Stockage d'objets | Cloud Storage | Un bucket `storage` monté sur `/app/config` via GCS FUSE (ou un PVC de StatefulSet facultatif) — contient `settings.json`, les paramètres propres à Seerr |
| Cache et file d'attente | aucun | Seerr ne dépend ni de Redis ni d'une file d'attente |
| Secrets | Secret Manager | Uniquement le mot de passe de base de données généré — le premier administrateur de Seerr provient de l'assistant de configuration web de l'application |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Réellement préconstruit — aucune image personnalisée.** Le répertoire
  `scripts/` de `Seerr_Common` est vide. `container_image_source = "prebuilt"`
  déploie directement `ghcr.io/seerr-team/seerr`.
- **`DB_TYPE=postgres` est défini sans condition** par `Seerr_Common` — voir le
  [§3 du guide Cloud Run](Seerr_CloudRun.md#-the-db_type-trap--the-most-important-thing-to-know-about-this-module)
  pour l'explication complète ; le même piège et le même correctif s'appliquent
  ici.
- **Port 5055, chemin de santé `/api/v1/status`.** Confirmé par des tests locaux
  avec `docker run` et par un déploiement réel (le pod indiquait `3/3 Running`,
  et `GET /api/v1/status` a renvoyé du vrai JSON via `kubectl exec`).
- **Un bug de permissions GCS-FUSE propre à GKE, détecté et corrigé.** Le
  conteneur de Seerr s'exécute en tant que `uid=1000/gid=1000`. L'intégration
  gcsfuse propre à Cloud Run applique automatiquement cet UID/GID au montage ;
  le **pilote CSI GCS FUSE de GKE ne le fait pas** — sans correctif explicite, le
  pod redémarre en boucle dès le premier démarrage avec
  `EACCES: permission denied` en tentant de créer `/app/config/logs/`.
  `Seerr_Common` monte le volume avec `uid=1000`, `gid=1000`,
  `file-mode=0664`, `dir-mode=0775` pour y remédier. Voir le §3.
- **Deux éléments d'état distincts.** PostgreSQL contient les données de
  demandes et d'utilisateurs. Les paramètres propres à Seerr (serveurs
  multimédias connectés, curseurs de découverte, agents de notification) résident
  dans un simple fichier `settings.json` sous `/app/config` — quel que soit le
  backend de base de données.
- **`DB_PASS`, et non `DB_PASSWORD`.** La source de données TypeORM de Seerr lit
  une variable d'environnement nommée précisément `DB_PASS`. Ce module définit
  `db_password_env_var_name = "DB_PASS"` en conséquence.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis.

### A. GKE Autopilot — la charge de travail Seerr {#a-gke-autopilot--the-seerr-workload}

- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

### B. Cloud SQL — données de demandes et d'utilisateurs {#b-cloud-sql--requestuser-data}

- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql databases list --instance=<instance-name> --project "$PROJECT"
  ```

### C. Stockage — Cloud Storage ou un PVC en mode bloc {#c-storage--cloud-storage-or-a-block-pvc}

- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~seerr"
  kubectl get pvc -n "$NAMESPACE"    # only when stateful_pvc_enabled = true
  ```

### D. Secret Manager {#d-secret-manager}

- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~seerr"
  ```

### E. Réseau et entrée {#e-networking--ingress}

- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Seerr {#3-seerr-application-behaviour}

- **Aucun job de schéma de base de données au premier déploiement.** Le fichier
  `dist/index.js` de Seerr appelle explicitement `dbConnection.runMigrations()`
  à chaque démarrage du pod ; ce module ne comporte donc aucun job
  d'initialisation, et aucun n'est nécessaire. `initialization_jobs` est vide
  par défaut.
- **La configuration initiale se fait entièrement dans l'interface web de
  l'application.** Aucun identifiant administrateur n'est amorcé, de quelque
  sorte que ce soit — connectez-vous au service et terminez l'assistant de
  configuration de Seerr : d'abord le serveur multimédia, puis Sonarr/Radarr.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent toutes
  deux `GET /api/v1/status`.
- **Inspecter l'exécution des jobs (ne devrait rien afficher, par conception) :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  ```

### ⚠ Le bug UID/GID de GCS-FUSE — le piège propre à GKE que corrige ce module {#-the-gcs-fuse-uidgid-bug--the-gke-specific-gotcha-this-module-fixes}

Le conteneur de Seerr s'exécute en tant que `uid=1000/gid=1000` (l'utilisateur
`node` — confirmé via `docker run ghcr.io/seerr-team/seerr id`) et, au premier
démarrage, tente un `mkdir '/app/config/logs/'`.

- **Sur Cloud Run**, l'intégration gcsfuse propre à la plateforme applique
  automatiquement `uid:1000/gid:1000` au volume monté, si bien que cela
  fonctionne sans aucune configuration supplémentaire.
- **Sur GKE**, le **pilote CSI GCS FUSE n'utilise pas par défaut un UID
  disposant des droits d'écriture.** Un simple montage `gcs_volumes` appartient
  à root, et le conteneur non root redémarre en boucle avec
  `EACCES: permission denied`.

`Seerr_Common` corrige ce problème en définissant des `mount_options`
explicites sur le volume de stockage qu'il déclare pour `/app/config` :

```hcl
mount_options = [
  "implicit-dirs", "stat-cache-ttl=60s", "type-cache-ttl=60s",
  "uid=1000", "gid=1000", "file-mode=0664", "dir-mode=0775",
]
```

Il s'agit d'une catégorie de bug connue dans ce catalogue — la même forme de
défaillance avait déjà été détectée et corrigée sur les variantes GKE de
Paperless, CodeServer et CloudBeaver (voir le constat « GKE gcsfuse UID/GID
permission denied » dans le `CLAUDE.md` du dépôt). Seerr en est le dernier cas
confirmé, désormais corrigé dans la couche `Seerr_Common` afin que les deux
modules applicatifs héritent uniformément du correctif.

**Signe diagnostique**, si vous constatez un jour ce symptôme sur un fork de ce
module :

```bash
kubectl describe pod -n "$NAMESPACE" <seerr-pod>
# Look for: EACCES: permission denied, mkdir '/app/config/logs/'
```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Seerr ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Défaut | Description |
|---|---|---|
| `application_name` | `seerr` | Nom de base des ressources. |
| `application_display_name` | `Seerr` | Nom lisible affiché dans l'interface de la plateforme. |
| `application_version` | `latest` | Récupéré directement comme tag de l'image `ghcr.io/seerr-team/seerr` — aucune étape de build. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Défaut | Description |
|---|---|---|
| `container_port` | `5055` | Confirmé via `docker run` en local et un déploiement réel ; le Service K8s et les sondes doivent tous s'accorder sur cette valeur. |
| `container_image_source` | `prebuilt` | Seerr ne prend en charge que l'image officielle ; `Seerr_Common` code également cette valeur en dur en interne. |
| `min_instance_count` / `max_instance_count` | `1` / `5` | Voir le §6 ci-dessous. |

### Groupe 31 — Configuration du StatefulSet {#group-31--statefulset-configuration}

| Variable | Défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `false` | `settings.json` est un petit état JSON écrit en fichier entier — sûr sur un volume GCS FUSE avec `max_instance_count = 1` ; un PVC en mode bloc est donc facultatif ici, contrairement aux applications SQLite en mode WAL de ce catalogue. |
| `stateful_pvc_mount_path` | `/app/config` | Correspond au chemin de montage GCS FUSE par défaut. |
| `stateful_pvc_storage_class` | `standard` | HDD `pd-standard` — `settings.json` n'a pas besoin d'un nombre élevé d'IOPS. |

### Groupe 16 — Base de données {#group-16--database}

| Variable | Défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Obligatoire — Seerr ne dispose d'aucun chemin hors Postgres. |
| `application_database_name` / `application_database_user` | `seerr` / `seerr` | Transmis à `Seerr_Common`, injectés sous forme de `DB_NAME`/`DB_USER`. |
| `db_password_env_var_name` | `DB_PASS` | **Critique** — la source de données de Seerr lit précisément `DB_PASS`, et non le `DB_PASSWORD` par défaut du socle. |

### Groupe 11 — Automatisation des charges de travail {#group-11--workload-automation}

| Variable | Défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Vide, et le reste généralement — `dbConnection.runMigrations()` s'exécute à chaque démarrage du pod au sein même de l'application. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` | Le montage du bucket `storage` sur `/app/config`, aux permissions corrigées, est ajouté automatiquement (voir le §3) ; utilisez ce paramètre uniquement pour des volumes *supplémentaires*. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/api/v1/status` (via `Seerr_Common`) | Point de terminaison d'état JSON non authentifié renvoyant `200` ; la valeur par défaut du `variables.tf` propre à la variante (HTTP `/`) est remplacée par la valeur par défaut plus précise de `Seerr_Common`. |

---

## 5. Outputs {#5-outputs}

| Output | Description |
|---|---|
| `service_name` / `service_url` / `service_external_ip` | Identité et adresse du Service Kubernetes. |
| `database_instance_name` / `database_name` / `database_user` / `database_password_secret` | Identifiants de l'instance Cloud SQL et de la base de données Seerr. |
| `storage_buckets` | Le bucket `storage` qui sous-tend `/app/config` (non utilisé comme montage si `stateful_pvc_enabled = true`). |
| `kubernetes_ready` | Indique si la charge de travail a atteint l'état Ready. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Variable d'environnement `DB_TYPE` | Laissez intacte la valeur par défaut de `Seerr_Common` (`postgres`) | **Critical** | Un `DB_TYPE` manquant ou écrasé fait basculer silencieusement Seerr sur un fichier SQLite propre à chaque pod, effacé à chaque redémarrage. |
| `mount_options` GCS FUSE sur `/app/config` | Conservez le correctif `uid=1000`/`gid=1000` de `Seerr_Common` | **Critical** | Sans lui, le pod redémarre en boucle avec `EACCES: permission denied` dès le premier démarrage — un mode de défaillance propre à GKE, absent sur Cloud Run. |
| `db_password_env_var_name` | Laissez à `DB_PASS` | **Critical** | La source de données TypeORM de Seerr ne lit que `DB_PASS` ; le `DB_PASSWORD` par défaut du socle n'est jamais lu à lui seul. |
| `max_instance_count` | Définissez `1` si les modifications de paramètres ne doivent jamais entrer en concurrence | Medium | `settings.json` est un unique fichier modifiable — des écrivains concurrents issus de plusieurs pods risquent une écriture perdue. La valeur par défaut du module est `5`, plus permissive que la valeur sûre pour un écrivain unique. |
| `stateful_pvc_enabled` | Laissez à `false` sauf raison précise de recourir au stockage en mode bloc | Low | `settings.json` n'a pas besoin du verrouillage de fichiers POSIX comme une application SQLite en mode WAL ; GCS FUSE est ici une valeur par défaut appropriée, contrairement aux applications qui exigent réellement un véritable périphérique en mode bloc. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et réplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Seerr, partagée
avec la variante Cloud Run, est décrite dans
**[Seerr_Common](Seerr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Seerr sur GKE Autopilot](../labs/Seerr_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Seerr sur Google Cloud Run](Seerr_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Seerr Common — configuration applicative partagée](Seerr_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Jellyfin sur GKE Autopilot](Jellyfin_GKE.md), [Prowlarr sur GKE Autopilot](Prowlarr_GKE.md), [Jellystat sur GKE Autopilot](Jellystat_GKE.md) et [Homepage sur GKE Autopilot](Homepage_GKE.md) dans la solution **Media Server**.
