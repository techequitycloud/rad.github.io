---
title: "Trilium sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Trilium sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Trilium_CloudRun.md @ 15fd4c7 sha256:d859ee74cf81 -->

# Trilium sur Google Cloud Run {#trilium-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Trilium_CloudRun.png" alt="Trilium sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Trilium Notes (le fork **TriliumNext** activement maintenu — pas le `zadam/trilium` archivé)
est une application de prise de notes hiérarchique, auto-hébergée et open source
avec une base de données SQLite intégrée. Ce module déploie Trilium sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Trilium utilise et sur la façon
de les explorer et de les opérer depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Trilium s'exécute comme un seul conteneur Node.js/Express sur Cloud Run v2. Le
déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, autoscaling sans serveur — mais voir les notes sur la mise à l'échelle ci-dessous |
| Base de données | Aucune (SQLite intégré) | L'intégralité du magasin de documents de Trilium est un seul fichier SQLite, `document.db`, sur le volume persistant |
| Répertoire de données | Cloud Filestore (NFS) | `/home/node/trilium-data` est sur le volume NFS partagé par défaut ; un bucket GCS FUSE y est monté uniquement si NFS est désactivé |
| Secrets | Secret Manager | Aucun généré — Trilium n'a pas de credential piloté par des variables d'environnement |
| Ingress | URL Cloud Run | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucun moteur de base de données à gérer.** `database_type = "NONE"` — il n'y a pas
  d'instance Cloud SQL, pas de chaîne de connexion, et rien à sauvegarder
  séparément du bucket de données.
- **Instance unique uniquement.** `min_instance_count = max_instance_count = 1`. La base de données SQLite
  intégrée de Trilium ne prend pas en charge l'écriture multi-utilisateurs —
  l'exécution de plusieurs instances risque d'endommager la base de données en
  raison d'écritures concurrentes.
- **Aucun credential pré-rempli.** Contrairement aux applications avec un mot de
  passe géré par Secret Manager, Trilium n'a **pas** de démarrage d'authentification
  piloté par des variables d'environnement. Lors de la première visite,
  l'application elle-même présente un écran "Définir le mot de passe" ;
  complétez-le avant de partager l'URL.
- **La sonde de santé est `/api/health-check`, pas `/`.** Le chemin racine
  (`/`) renvoie une redirection 302 vers l'écran de configuration/connexion.
  Seul `/api/health-check` renvoie un `200 {"status":"ok"}` non authentifié — confirmé en direct
  par des tests de conteneur locaux.
- **Le répertoire de données est tout.** `/home/node/trilium-data` contient la base de
  données SQLite, toutes les pièces jointes, l'historique des révisions et les
  paramètres. Perdre ce volume, c'est tout perdre. Il se trouve sur le volume
  NFS par défaut (`enable_nfs = true`, `nfs_mount_path = /home/node/trilium-data`). Gardez-le là :
  Trilium exécute SQLite en mode WAL, ce qui nécessite un verrouillage en
  mémoire partagée que GCS FUSE ne peut pas fournir, donc sur GCS FUSE les
  écritures récentes sont silencieusement perdues lorsque le conteneur est
  remplacé.
- **`mount_options` définit `uid=1000,gid=1000`** sur le fallback GCS FUSE. Le conteneur
  de Trilium s'exécute en tant qu'utilisateur `node` ; sans options de montage
  correspondantes, GCS FUSE monte le répertoire en tant que root et l'application
  ne démarre pas.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Trilium {#a-cloud-run--the-trilium-service}

Trilium s'exécute comme un seul service Cloud Run v2. Comme il doit rester à
exactement une instance, il n'y a pas d'autoscaling significatif à observer —
le signal intéressant est la santé de la révision et le comportement au
démarrage à froid.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Le répertoire de données Trilium {#b-the-trilium-data-directory}

L'état complet de l'application (SQLite `document.db`, pièces jointes, historique des
révisions, paramètres) se trouve dans `/home/node/trilium-data`, qui est le chemin de montage NFS
par défaut. Un bucket Cloud Storage dédié est également provisionné ; il est
monté à ce chemin via GCS FUSE uniquement lorsque `enable_nfs = false` ou `nfs_mount_path` pointe
ailleurs, de sorte que le répertoire n'a toujours qu'un seul propriétaire.
Évitez ce fallback — GCS FUSE ne peut pas contenir une base de données SQLite
en mode WAL en toute sécurité.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS Fuse et CMEK.

### C. Réseau et ingress {#c-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être
ajouté.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Voir [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des
politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Trilium {#3-trilium-application-behaviour}

- **Pas de job de configuration de base de données au premier déploiement.**
  Trilium crée et migre son propre schéma SQLite lors de la première visite web,
  via son propre assistant de configuration — il n'y a pas de job `db-init` géré
  par Terraform à inspecter.
- **Écran "Définir le mot de passe" au premier démarrage.** Naviguer vers l'URL
  racine pour la première fois présente un formulaire de configuration de mot de
  passe (pas d'administrateur/nom d'utilisateur par défaut — Trilium est une
  application mono-utilisateur). Il n'y a pas de credential pré-rempli dans
  Secret Manager à consulter.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/api/health-check`,
  qui renvoie `200 {"status":"ok"}` une fois que le serveur HTTP écoute —
  indépendamment du fait que la base de données SQLite ait été initialisée (cela
  ne se produit qu'après que l'opérateur ait terminé l'étape "Définir le mot de
  passe").
- **Contrainte d'écriture unique.** Ne jamais augmenter `max_instance_count` au-dessus de
  `1` — la base de données SQLite intégrée n'est pas sûre pour les
  écritures concurrentes de plusieurs instances.
- **Inspecter la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Trilium sont listés ; chaque autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `trilium` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Trilium Notes` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Docker ; mappé en interne à un ARG de build épinglé (`TRILIUM_VERSION`), non transmis comme `latest` au Dockerfile. |
| `enable_password` | `false` | Réservé pour la parité avec d'autres modules d'éditeur mono-utilisateur. **Aucun effet** — Trilium n'a pas de démarrage de mot de passe piloté par des variables d'environnement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `1Gi` | Mémoire par instance ; Trilium est léger, n'augmentez que pour de très grandes collections de notes. |
| `min_instance_count` / `max_instance_count` | `1` / `1` | **Gardez les deux à 1** — pas de support multi-écrivain sur la base de données SQLite intégrée. |
| `container_port` | `8080` | Port HTTP par défaut de Trilium. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Trilium dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut ; restreindre à `internal` pour un déploiement privé. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Trilium. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer le bucket de données Trilium. |
| `gcs_volumes` | `[]` | Volumes GCS Fuse supplémentaires au-delà du bucket de données auto-monté. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Non référencé — Trilium n'a pas de base de données SQL (SQLite intégré uniquement). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/health-check`, délai de 15s | Sonde de démarrage. |
| `liveness_probe` | HTTP `/api/health-check`, délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring optionnelle sur `/api/health-check`. |

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
| `project_id` / `project_number` | Identifiants de projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `max_instance_count` | `1` | Critique | L'augmenter risque de corrompre la base de données SQLite intégrée par des écritures concurrentes — il n'y a pas de protection au niveau de la couche de requête contre cela. |
| `enable_nfs` / `nfs_mount_path` | `true` / `/home/node/trilium-data` (les valeurs par défaut) | Critique | Désactiver NFS ou déplacer le montage place `document.db` sur GCS FUSE, où les écritures WAL sont silencieusement perdues lors du remplacement du conteneur. |
| Bucket de données / `gcs_volumes` mount_options (fallback GCS FUSE uniquement) | `uid=1000,gid=1000` | Critique | Un uid/gid incorrect monte le répertoire de données en tant que root ; le processus Trilium non-root ne démarre pas avec une erreur de permission. |
| Étape "Définir le mot de passe" à la première visite | Terminer immédiatement | Critique | Une instance Trilium sans mot de passe laissée sur une URL publique est accessible à quiconque tant que le mot de passe n'est pas défini. |
| `startup_probe` / `liveness_probe` chemin | `/api/health-check` | Élevé | Pointer les sondes vers `/` entraîne une redirection 302, que la plupart des vérifications de santé HTTP traitent comme un échec, empêchant la révision de devenir prête. |
| `ingress_settings` | `internal` pour usage privé | Moyen | `all` (par défaut) rend l'instance (initialement non authentifiée, avant la définition du mot de passe) accessible depuis l'internet public. |
| `memory_limit` | `1Gi` | Faible | Trilium est léger ; n'augmentez que pour de très grandes collections de notes/pièces jointes. |

---

Pour le comportement de la fondation référencé tout au long — identité du
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Trilium partagée avec la variante GKE est décrite
dans **[Trilium_Common](Trilium_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Trilium sur Cloud Run](../labs/Trilium_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Trilium sur GKE Autopilot](Trilium_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Trilium Common — Configuration d'application partagée](Trilium_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Memos sur Google Cloud Run](Memos_CloudRun.md), [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md), [Wallabag sur Google Cloud Run](Wallabag_CloudRun.md), [FreshRSS sur Google Cloud Run](FreshRSS_CloudRun.md) dans la solution **Connaissances personnelles et lecture**.
