---
title: "Linkwarden sur GKE Autopilot"
description: "Référence de configuration pour déployer Linkwarden sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Linkwarden_GKE.md @ 3055034 sha256:fe44e295c9ce -->

# Linkwarden sur GKE Autopilot {#linkwarden-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Linkwarden_GKE.png" alt="Linkwarden sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Linkwarden est un gestionnaire de favoris open source auto-hébergé qui va au-delà
du simple enregistrement de liens : chaque favori peut être archivé
automatiquement sous forme de capture d'écran pleine page, de PDF et d'instantané
« monolith » en un seul fichier grâce à un Chrome headless intégré, afin que vos
liens continuent de fonctionner même après la modification ou la disparition de la
page source. Ce module déploie Linkwarden sur **GKE Autopilot** en s'appuyant sur le
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud
et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Linkwarden et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Linkwarden s'exécute sous forme d'un pod Next.js unique. Le serveur web et un worker
d'archivage en arrière-plan s'exécutent côte à côte dans le MÊME conteneur (via
`concurrently`) — il n'existe pas de Deployment worker distinct. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Next.js + Chrome headless, 2 vCPU / 2 GiB par défaut, `min_instance_count = 1` |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — le schéma Prisma de Linkwarden est exclusivement PostgreSQL |
| Stockage d'objets | Cloud Storage (volume CSI GCS Fuse) | Monté par défaut sur `/data/data` pour les captures d'écran, PDF et monoliths archivés |
| Cache et file d'attente | Aucun | Le worker d'archivage interroge directement PostgreSQL ; aucune dépendance à Redis/BullMQ |
| Secrets | Secret Manager | `NEXTAUTH_SECRET` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option, `reserve_static_ip = true` |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le schéma Prisma de Linkwarden code en dur le
  fournisseur `postgresql` ; sélectionner un autre moteur fait échouer la migration
  du premier démarrage.
- **`DATABASE_URL` se connecte via l'interface de bouclage du cloud-sql-proxy.**
  `enable_cloudsql_volume = true` est requis — il lance le sidecar du proxy qui
  répond sur `127.0.0.1`, que le point d'entrée cloud utilise avec
  `sslmode=disable` (le proxy assure déjà la terminaison TLS). Cela diffère de la
  variante Cloud Run, qui se connecte directement à l'IP privée avec
  `sslmode=require`.
- **`NEXTAUTH_URL` est dérivé automatiquement**, en ajoutant le suffixe requis
  `/api/v1/auth` à l'URL calculée du service.
- **`reserve_static_ip = true` par défaut.** Le `NEXTAUTH_URL` de Linkwarden fige
  l'URL du service au démarrage du conteneur ; une IP externe stable évite donc la
  situation de concurrence avec le repli sur le DNS interne documentée pour d'autres
  applications de ce catalogue qui référencent leur propre URL.
- **Au moins 1 réplica est maintenu** (GKE ne prend pas en charge la mise à
  l'échelle à zéro) afin que le worker d'archivage en arrière-plan intégré au
  conteneur continue à traiter la file d'attente.
- **Chrome headless s'exécute dans le même processus que le serveur web.**
  Dimensionnez `container_resources` pour le pic de l'ensemble du conteneur
  (2 vCPU / 2Gi par défaut ; augmentez la mémoire à 4Gi pour des charges
  d'archivage importantes).
- **Un volume GCS est monté automatiquement sur `/data/data`.** Il s'agit du chemin
  absolu vers lequel le code de stockage de Linkwarden résout `STORAGE_FOLDER`.
  L'ensemble du conteneur de l'image s'exécute en tant que root ; aucun
  remplacement des options de montage uid/gid de gcsfuse n'est donc nécessaire
  (contrairement à certains autres modules GKE de ce catalogue).
- **Aucun super-utilisateur pré-créé.** Le premier utilisateur qui s'inscrit via le
  flux d'inscription NextAuth standard devient le propriétaire de l'instance.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Linkwarden {#a-gke-autopilot--the-linkwarden-workload}

Les pods Linkwarden sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Linkwarden pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour le fonctionnement d'Autopilot, de la mise à
l'échelle et du cycle de vie de la charge de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Linkwarden stocke toutes les données applicatives (favoris, collections, tags,
utilisateurs, métadonnées d'archive) dans une instance gérée Cloud SQL for
PostgreSQL 15. Le sidecar cloud-sql-proxy (activé via
`enable_cloudsql_volume = true`) écoute sur `127.0.0.1` ; le point d'entrée cloud y
connecte `DATABASE_URL` avec `sslmode=disable`. Lors du premier déploiement, un
job d'initialisation crée la base de données applicative et l'utilisateur ;
Linkwarden exécute ensuite son propre `prisma migrate deploy` à chaque démarrage du
conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes,
  les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (contenu archivé) {#c-cloud-storage-archived-content}

Un bucket **Cloud Storage** dédié est provisionné automatiquement et monté par
défaut via le pilote CSI GCS Fuse sur `/data/data` — le chemin absolu vers lequel le
code de stockage de Linkwarden résout `STORAGE_FOLDER` à l'exécution.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options du pilote CSI GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Un secret est généré automatiquement et stocké dans Secret Manager :
`NEXTAUTH_SECRET` (signe les JWT de session NextAuth). Il est matérialisé dans
l'espace de noms et injecté en tant que variable d'environnement du pod. Le mot de
passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est exposé par défaut via un Service Kubernetes `LoadBalancer` avec une
IP statique réservée (`reserve_static_ip = true`). Un Ingress avec un domaine
personnalisé et un certificat géré, Cloud CDN et Cloud Armor peut y être ajouté.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services →
  Load balancing.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés à Cloud Logging ; les métriques de GKE et de
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards /
  Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Linkwarden {#3-linkwarden-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte
  via le sidecar cloud-sql-proxy et crée de manière idempotente la base de données
  applicative et l'utilisateur, puis accorde les privilèges. La tâche peut être
  réexécutée sans risque.
- **Les migrations du schéma s'exécutent à chaque démarrage.** Le `CMD` de l'image
  de base de Linkwarden exécute `prisma migrate deploy` avant de démarrer les
  processus web et worker ; la mise à niveau de la version de l'application applique
  donc automatiquement les modifications du schéma.
- **`NEXTAUTH_SECRET` est immuable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager. Sa rotation invalide toutes les sessions
  actives.
- **Aucun compte administrateur pré-créé.** Le premier utilisateur qui s'inscrit via
  le flux d'inscription NextAuth standard devient le propriétaire de l'instance.
- **Worker d'archivage en arrière-plan.** Un processus distinct (`worker.ts`, lancé
  via `concurrently` aux côtés du serveur web dans le même conteneur) interroge
  directement PostgreSQL et traite les liens en file d'attente par lots
  (`ARCHIVE_TAKE_COUNT`, `5` par défaut). Chaque lot lance des instances de Chrome
  headless pour les captures d'écran, PDF et monoliths.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` par défaut
  — Linkwarden ne dispose d'aucun point de terminaison de santé dédié confirmé. La
  sonde de démarrage accorde une fenêtre généreuse pour le démarrage à froid de
  Next.js ainsi que l'initialisation de Chrome headless/Playwright.
- **Inspecter l'exécution des tâches :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Linkwarden ou notables pour celui-ci
sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec
leur comportement standard.

### Groupe 1 / 2 — Projet et identité {#group-1--2--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région des ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `linkwarden` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Linkwarden` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Linkwarden publie un véritable tag `latest` en amont. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit="2000m", memory_limit="2Gi" }` | L'archivage par Chrome headless s'exécute dans le même processus ; augmentez la mémoire à `4Gi` pour des charges importantes. |
| `min_instance_count` | `1` | GKE ne prend pas en charge la mise à l'échelle à zéro ; maintient le worker d'archivage actif. |
| `max_instance_count` | `5` | Limite supérieure du HPA. |
| `container_port` | `3000` | Linkwarden (Next.js) écoute sur le port 3000. |
| `enable_cloudsql_volume` | `true` | Requis — lance le sidecar cloud-sql-proxy auquel se connecte le point d'entrée. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Linkwarden dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement statiques. `DATABASE_URL` et `NEXTAUTH_URL` sont définis automatiquement — ne les définissez pas ici. |
| `disable_browser` | `false` | Définit `DISABLE_BROWSER` — ignore toutes les tâches d'archivage par Chrome headless. |
| `archive_take_count` | `5` | Nombre de liens traités par lot du worker en arrière-plan (`ARCHIVE_TAKE_COUNT`). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | L'interface web publique doit être exposée à l'extérieur. |
| `session_affinity` | `ClientIP` | Routage persistant pour les cookies de session NextAuth. |
| `namespace_name` | `""` | Laissez vide pour une génération automatique. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut — Linkwarden utilise plutôt un volume GCS par souci de simplicité. |
| `nfs_mount_path` | `/data/data` | Utilisé uniquement lorsque `enable_nfs = true`. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gcs_volumes` | `[]` (repli sur une valeur par défaut intégrée) | Un volume « storage » par défaut monté sur `/data/data` est configuré automatiquement, sauf si vous fournissez votre propre liste, qui le remplace entièrement. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Imposé — le schéma Prisma de Linkwarden est exclusivement PostgreSQL. |
| `application_database_name` | `linkwarden` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `linkwarden` | Utilisateur de base de données de l'application. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | Le `NEXTAUTH_URL` de Linkwarden fige l'URL du service au démarrage — une IP stable évite une situation de concurrence avec le repli sur le DNS interne. |
| `enable_custom_domain` | `true` | Provisionne un Ingress + un certificat géré pour les noms d'hôte personnalisés. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non utilisé par Linkwarden — son worker d'archivage interroge directement PostgreSQL. Conservé par souci de parité avec les variables du socle. |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` / `service_external_ip` | IP interne au cluster / externe. |
| `service_url` | URL permettant d'accéder à Linkwarden. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des tâches de configuration. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan. La plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `NEXTAUTH_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation invalide toutes les sessions actives et oblige tous les utilisateurs à se reconnecter. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critical | Immuables après le premier déploiement ; un renommage recrée la base de données et l'utilisateur et détruit toutes les données. |
| `database_type` | `POSTGRES_15` (imposé) | Critical | Tout autre moteur fait entièrement échouer la migration Prisma du premier démarrage. |
| `enable_cloudsql_volume` | `true` (requis) | Critical | Le désactiver supprime le sidecar cloud-sql-proxy dont dépend le point d'entrée — `DATABASE_URL` ne se connecte à rien. |
| `min_instance_count` | `1` | High | Une mise à l'échelle à 0 (non prise en charge par défaut sur GKE) arrêterait le worker d'archivage en arrière-plan. |
| `container_resources.memory_limit` | `2Gi` minimum | High | L'archivage par Chrome headless subit un OOM en dessous de ce seuil ; le serveur web peut continuer à répondre alors que l'archivage échoue silencieusement. |
| `service_type` | `LoadBalancer` | High | Définir `ClusterIP` pour une interface publique de favoris la rend inaccessible depuis un navigateur (un schéma de bogue de copier-coller connu ailleurs dans ce catalogue). |
| `reserve_static_ip` | `true` | Medium | `false` risque de faire résoudre le `NEXTAUTH_URL` figé de Linkwarden vers un DNS interne inaccessible si l'IP éphémère n'est pas connue au moment de l'apply. |
| `disable_browser` | `false` sauf si Chrome se comporte mal | Medium | Le laisser à `true` sans nécessité désactive tout l'archivage des captures d'écran, PDF et monoliths. |
| `gcs_volumes` | Utiliser la valeur par défaut intégrée | Medium | Fournir une liste personnalisée sans respecter le chemin de montage `/data/data` rend le contenu archivé non inscriptible ou le répartit entre plusieurs backends de stockage. |

---

Pour le comportement du socle mentionné tout au long de ce guide — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Linkwarden
partagée avec la variante Cloud Run est décrite dans
**[Linkwarden_Common](Linkwarden_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Linkwarden sur GKE Autopilot](../labs/Linkwarden_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Linkwarden sur Google Cloud Run](Linkwarden_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Linkwarden Common — Configuration applicative partagée](Linkwarden_Common.md) — la configuration partagée par les deux cibles de déploiement.
