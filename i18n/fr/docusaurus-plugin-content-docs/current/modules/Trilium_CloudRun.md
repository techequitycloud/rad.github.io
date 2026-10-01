---
title: "Trilium sur Google Cloud Run"
description: "Référence de configuration pour déployer Trilium sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Trilium_CloudRun.md @ 3055034 sha256:b772ceed3c4b -->

# Trilium sur Google Cloud Run {#trilium-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_CloudRun.png" alt="Trilium sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (le fork **TriliumNext**, activement maintenu — et non le dépôt archivé
`zadam/trilium`) est une application open source de prise de notes hiérarchique,
auto-hébergée, dotée d'une base de données SQLite intégrée. Ce module déploie Trilium
sur **Cloud Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Trilium et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité
du service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Trilium s'exécute sous forme d'un unique conteneur Node.js/Express sur Cloud Run v2.
Le déploiement assemble un ensemble volontairement restreint de services Google
Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, mise à l'échelle automatique serverless — mais voir les remarques sur la mise à l'échelle ci-dessous |
| Base de données | Aucune (SQLite intégré) | L'intégralité du magasin de documents de Trilium est un unique fichier SQLite, `document.db`, sur le volume persistant |
| Stockage d'objets | Cloud Storage | Un bucket de données dédié, monté via GCS FUSE sur `/home/node/trilium-data` |
| Secrets | Secret Manager | Aucun secret généré — Trilium n'a aucun identifiant défini par variable d'environnement |
| Entrée | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Aucun moteur de base de données à gérer.** `database_type = "NONE"` — il n'y a
  ni instance Cloud SQL, ni chaîne de connexion, ni rien à sauvegarder séparément du
  bucket de données.
- **Une seule instance.** `min_instance_count = max_instance_count = 1`. La base de
  données SQLite intégrée de Trilium ne prend pas en charge plusieurs rédacteurs —
  exécuter plus d'une instance expose à une corruption de la base de données par des
  écritures concurrentes.
- **Aucun identifiant pré-créé.** Contrairement aux applications dont le mot de passe
  est stocké dans Secret Manager, Trilium n'a **aucun** amorçage d'authentification
  piloté par variable d'environnement. À la première visite, l'application affiche
  elle-même un écran « Set Password » ; terminez-le avant de partager l'URL.
- **La sonde de santé est `/api/health-check`, et non `/`.** Le chemin racine (`/`)
  renvoie une redirection 302 vers l'écran de configuration/connexion. Seul
  `/api/health-check` renvoie un `200 {"status":"ok"}` non authentifié — confirmé en
  conditions réelles par des tests de conteneur en local.
- **Le répertoire de données est essentiel.** `/home/node/trilium-data` contient la
  base de données SQLite, toutes les pièces jointes, l'historique des révisions et
  les paramètres. Perdre ce volume revient à tout perdre ; il est persisté par défaut
  via un bucket monté par GCS FUSE.
- **`mount_options` définit `uid=1000,gid=1000`.** Le conteneur de Trilium s'exécute
  en tant qu'utilisateur `node` (confirmé via `docker run ... id node`) ; sans
  options de montage correspondantes, GCS FUSE monte le répertoire avec root comme
  propriétaire et l'application ne parvient pas à démarrer.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des
services et des ressources sont indiqués dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Trilium {#a-cloud-run--the-trilium-service}

Trilium s'exécute en tant que service Cloud Run v2 unique. Comme il doit rester à
exactement une instance, il n'y a pas de mise à l'échelle automatique significative à
observer — le signal intéressant est l'état des révisions et le comportement au
démarrage à froid.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic,
  les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage — le répertoire de données de Trilium {#b-cloud-storage--the-trilium-data-directory}

L'intégralité de l'état de l'application (le fichier SQLite `document.db`, les pièces
jointes, l'historique des révisions, les paramètres) réside dans un bucket Cloud
Storage dédié, monté via GCS FUSE sur `/home/node/trilium-data`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et
CMEK.

### C. Réseau et entrée {#c-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte en option.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Trilium {#3-trilium-application-behaviour}

- **Aucune tâche de configuration de base de données au premier déploiement.**
  Trilium crée et migre son propre schéma SQLite lors de la première visite web, via
  son propre assistant de configuration — il n'existe aucune tâche `db-init` gérée
  par Terraform à inspecter.
- **Écran « Set Password » au premier lancement.** La première visite de l'URL racine
  affiche un formulaire de définition du mot de passe (aucun administrateur ni nom
  d'utilisateur par défaut — Trilium est une application mono-utilisateur). Aucun
  identifiant pré-créé n'est à rechercher dans Secret Manager.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent
  `/api/health-check`, qui renvoie `200 {"status":"ok"}` dès que le serveur HTTP est
  à l'écoute — que la base de données SQLite ait déjà été initialisée ou non (cela
  n'a lieu qu'une fois que l'opérateur a terminé l'étape Set Password).
- **Contrainte d'un rédacteur unique.** N'augmentez jamais `max_instance_count`
  au-delà de `1` — la base de données SQLite intégrée ne supporte pas sans risque des
  rédacteurs concurrents provenant de plusieurs instances.
- **Inspecter la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Trilium ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail bénéficiant d'un accès au projet et des alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `trilium` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Trilium Notes` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Docker ; associé en interne à un ARG de build épinglé (`TRILIUM_VERSION`), et non transmis tel quel sous la forme `latest` au Dockerfile. |
| `enable_password` | `false` | Réservé par souci de cohérence avec les autres modules d'éditeurs mono-utilisateur. **Sans effet** — Trilium n'a aucun amorçage de mot de passe piloté par variable d'environnement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; Trilium est léger, n'augmentez cette valeur que pour de très grandes collections de notes. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Gardez les deux à 1** — la base de données SQLite intégrée ne prend pas en charge plusieurs rédacteurs. |
| `container_port` | `8080` | Port HTTP par défaut de Trilium. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages GCS Fuse. |
| `enable_image_mirroring` | `true` | Duplique l'image Trilium dans Artifact Registry. |

### Groupe 5 — Contrôle des accès et de l'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut ; restreignez à `internal` pour un déploiement privé. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine via le VPC que le trafic RFC 1918. |
| `enable_iap` | `false` | Exige une connexion Google devant Trilium. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket de données de Trilium. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse supplémentaires en plus du bucket de données monté automatiquement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non utilisé — Trilium n'a pas de base de données SQL (SQLite intégré uniquement). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/health-check`, délai de 30s | Sonde d'activité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif sur `/api/health-check`. |

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `trilium_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critical | L'augmenter expose à une corruption de la base de données SQLite intégrée par des rédacteurs concurrents — aucune protection n'existe contre cela au niveau de la couche de requêtes. |
| mount_options du bucket de données / de `gcs_volumes` | `uid=1000,gid=1000` | Critical | Un uid/gid incorrect monte le répertoire de données avec root comme propriétaire ; le processus Trilium non root ne parvient pas à démarrer et renvoie une erreur de permission. |
| Étape « Set Password » de la première visite | À terminer immédiatement | Critical | Une instance Trilium sans mot de passe défini, laissée sur une URL publique, est accessible à tous jusqu'à ce que le mot de passe soit défini. |
| Chemin de `startup_probe` / `liveness_probe` | `/api/health-check` | High | Faire pointer les sondes sur `/` renvoie une redirection 302, que la plupart des contrôles de santé HTTP considèrent comme un échec, ce qui empêche la révision de devenir Ready. |
| `ingress_settings` | `internal` pour un usage privé | Medium | `all` (valeur par défaut) rend l'instance (initialement non authentifiée, avant l'étape Set Password) accessible depuis l'internet public. |
| `memory_limit` | `1Gi` | Low | Trilium est léger ; n'augmentez cette valeur que pour de très grandes collections de notes ou de pièces jointes. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et duplication des
images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à Trilium partagée avec la variante GKE est décrite dans
**[Trilium_Common](Trilium_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Trilium sur Cloud Run](../labs/Trilium_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Trilium sur GKE Autopilot](Trilium_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Trilium Common — Configuration applicative partagée](Trilium_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Personal Knowledge & Reading**.
