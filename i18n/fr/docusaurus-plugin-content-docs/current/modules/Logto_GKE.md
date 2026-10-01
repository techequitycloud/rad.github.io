---
title: "Logto sur GKE Autopilot"
description: "Référence de configuration pour déployer Logto sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Logto_GKE.md @ 3055034 sha256:7e2f64d6fba4 -->

# Logto sur GKE Autopilot {#logto-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Logto_GKE.png" alt="Logto sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Logto est un fournisseur d'identité open source sous licence MPL-2.0 — une alternative à Auth0
qui parle OIDC et OAuth 2.0 et fournit des parcours de connexion, des connecteurs sociaux et
d'entreprise, la multi-location et une console d'administration. Ce module déploie Logto sur
**GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Logto et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que
de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Logto s'exécute comme une charge de travail web Node.js. Le déploiement assemble un ensemble ciblé de
services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Logto ne prend en charge ni MySQL ni d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement ; facultatif pour Logto (tout l'état principal est dans Postgres) |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données — Logto n'a **aucun** secret applicatif externe (les clés OIDC sont amorcées dans la base) |
| Ingress | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé et certificat géré en option (hôte nip.io par défaut) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; une garde au moment du plan rejette tout `database_type` non PostgreSQL.
- **Le cœur de Logto est publié sur le port 3001 ; la console d'administration (3002) ne l'est pas.** Un
  Service GKE unique publie un seul port, si bien que seul le point de terminaison API principal / OIDC (3001) est
  accessible. La console d'administration — où sont enregistrés le premier compte administrateur et les applications
  — s'exécute sur 3002 et nécessite une route distincte (p. ex. `kubectl port-forward`)
  pour la configuration initiale (voir §3).
- **Il n'y a aucun secret applicatif à protéger.** Logto génère ses clés de signature OIDC
  au premier démarrage et les stocke **dans la base de données**. Rien dans Secret Manager n'a besoin
  d'être protégé ni renouvelé, à l'exception du mot de passe de la base géré par le socle. Protéger les
  clés de Logto revient à protéger Cloud SQL.
- **Cloud SQL via le loopback de l'Auth Proxy.** Sur GKE, le sidecar Auth Proxy écoute sur
  `127.0.0.1` ; le point d'entrée de Logto se connecte en TCP simple sur le loopback, SSL désactivé
  (le proxy termine TLS vers Cloud SQL).
- **L'affinité de session est `ClientIP` par défaut**, afin qu'un client atteigne toujours le
  même pod.
- **`service_type = LoadBalancer` avec une IP statique et un domaine personnalisé nip.io par
  défaut** (`reserve_static_ip = true`, `enable_custom_domain = true`), ce qui donne à Logto un
  hôte HTTPS stable et accessible de l'extérieur dès l'installation.
- **Pas de Redis.** Logto s'appuie sur Postgres ; `enable_redis` vaut `false` par défaut.
- **`ENDPOINT` est dérivé de l'URL du service.** Le point d'entrée définit l'émetteur OIDC
  de Logto et ses URL absolues à partir de `GKE_SERVICE_URL` injectée ; mettez à jour `ENDPOINT` avec
  l'URL externe du LoadBalancer / du domaine personnalisé dès qu'elle est connue.
- **Un minimum d'un réplica est maintenu** (GKE ne prend pas en charge la mise à l'échelle à zéro) pour que le
  point de terminaison d'identité reste toujours accessible.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Logto {#a-gke-autopilot--the-logto-workload}

Les pods Logto sont planifiés sur Autopilot, qui facture le CPU et la mémoire que les pods demandent
réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre minimal et le
nombre maximal de réplicas. Le conteneur et le Service publient le port **3001** (cœur de Logto).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Logto pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|ENDPOINT'
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Logto stocke tout — utilisateurs, applications, connecteurs, clés de signature OIDC et
rôles par locataire — dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods l'atteignent
via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ; le point d'entrée se connecte
en TCP simple sur le loopback (le proxy termine TLS). Au premier déploiement, un Job
d'initialisation crée la base de données applicative et le rôle (avec `CREATEROLE`, requis pour les
rôles RLS par locataire de Logto).

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`logto`), l'utilisateur (`logto`) et le secret Secret Manager
contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour le modèle de
connexion, les sauvegardes automatiques et la rotation du mot de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement et l'accès est accordé au compte de service
de la charge de travail. Logto conserve tout son état principal dans PostgreSQL ; ce bucket est donc
disponible pour des ressources facultatives plutôt que comme stockage d'exécution requis.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Logto n'a **aucun secret applicatif externe** — ses clés de signature OIDC sont générées et
stockées dans la base de données au premier démarrage. Le seul secret en jeu est le **mot de passe de la
base de données**, que le socle génère, gère et synchronise dans le pod via le
pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe avec une
adresse statique réservée et un domaine personnalisé basé sur nip.io avec certificat géré. L'émetteur
OIDC de Logto et toutes les URL de redirection absolues sont construits à partir d'`ENDPOINT` ; l'hôte
externe, l'émetteur et les URI de redirection enregistrées doivent donc tous concorder — mettez à jour `ENDPOINT` avec
l'URL externe dès que l'IP du LoadBalancer / le domaine est attribué.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Le point d'entrée affiche une ligne `[cloud-entrypoint]` indiquant le mode de connexion
à la base résolu et `ENDPOINT` — utile pour diagnostiquer des problèmes de connexion ou d'URL
d'émetteur.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Logto {#3-logto-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` avec
  `postgres:15-alpine`. Il crée de façon idempotente le rôle applicatif **avec
  `CREATEDB CREATEROLE`** (requis pour les rôles RLS par locataire de Logto) et la
  base de données applicative, accorde les privilèges, transfère la propriété du schéma `public` au
  rôle applicatif, puis signale au sidecar Auth Proxy de s'arrêter afin que le pod du Job puisse
  se terminer. Le job peut être relancé sans risque.
- **Schéma et clés OIDC amorcés au démarrage.** Au démarrage, Logto exécute
  `npm run cli db seed -- --swe` (`--swe` = seed-when-empty, idempotent), qui crée
  son schéma et génère les clés privées de signature OIDC **dans la base de données** — uniquement
  lorsque la base est vide. Ces clés ne sont pas stockées dans Secret Manager ; la base de données
  en est l'unique dépositaire. Effacer la base régénère de nouvelles clés et invalide tous
  les jetons émis précédemment et les clients enregistrés.
- **Aucun secret applicatif à renouveler.** Il n'y a ni clé de chiffrement ni secret JWT dans
  Secret Manager — uniquement le mot de passe de la base géré par le socle.
- **La console d'administration (3002) n'est pas publiée.** Le Service n'expose que le cœur (3001).
  Atteignez la console d'administration pour créer le premier administrateur et enregistrer les applications
  via un port-forward :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3002:3002
  # then open http://localhost:3002
  ```
  `ADMIN_ENDPOINT` prend par défaut le même hôte qu'`ENDPOINT` par souci de cohérence des URL.
- **`ENDPOINT` doit correspondre à l'hôte vu par le navigateur.** Logto construit son émetteur OIDC et
  ses URL de redirection à partir d'`ENDPOINT` ; le point d'entrée le définit à partir de `GKE_SERVICE_URL`. Mettez-le
  à jour avec l'URL externe du LoadBalancer ou du domaine personnalisé via `environment_variables` dès que
  l'adresse externe est connue.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent `/api/status` — un
  point de terminaison non authentifié qui renvoie `200` dès que le cœur est opérationnel. Le port du conteneur
  et les sondes doivent tous être `3001`. Vérifiez :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3001:3001 &
  curl -s http://localhost:3001/api/status
  ```
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
propres à Logto ou notables pour lui sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `logto` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Logto (`svhd/logto:<tag>`) ; épinglez une version précise (p. ex. `1.33`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1. Maintient le point de terminaison d'identité accessible. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | Limites et requêtes CPU/mémoire du conteneur Logto ; Logto a besoin d'au moins 2 GiB de mémoire. |
| `container_port` | `3001` | Le cœur de Logto écoute sur 3001 ; la console d'administration (3002) n'est pas publiée. Le port et les sondes doivent correspondre à 3001. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (TCP loopback). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` (→ Deployment) | `Deployment` (sans état ; Logto conserve tout son état dans Postgres) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant afin qu'un client reste sur un même pod. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Inutile — Logto stocke tout son état dans PostgreSQL. L'activer sélectionne automatiquement `StatefulSet`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, large fenêtre au premier démarrage | Laisse le temps à l'étape d'amorçage. |
| `liveness_probe` | HTTP `/api/status` | Sonde de vivacité. |
| `uptime_check_config` | désactivé — `/` | Test de disponibilité Cloud Monitoring facultatif sur l'hôte du LoadBalancer ; désactivé par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un volume Filestore partagé. Non requis par Logto (qui stocke tout son état dans PostgreSQL) — peut sans risque être surchargé à `false`. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Logto utilise Postgres pour toute la persistance — laissez `false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `logto` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `logto` | Utilisateur de la base de données applicative (doté de `CREATEROLE`). Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress et un certificat géré (hôte nip.io par défaut). |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte à servir ; définissez `ENDPOINT` en conséquence. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

> **Avertissement :** l'activation d'IAP exige une authentification par identité Google pour **toutes** les requêtes
> entrantes, y compris les parcours OIDC/de connexion que Logto existe pour servir. Laissez-le désactivé pour un
> fournisseur d'identité public.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google devant Logto. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'atteindre le cœur de Logto. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données applicative. |
| `database_user` | Utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs d'initialisation et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `database_type` non PostgreSQL, `min_instance_count > max_instance_count`, Redis activé sans hôte résolvable, IAP sans identités autorisées, un domaine personnalisé sans noms d'hôte. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Base de données Cloud SQL | La sauvegarder ; ne jamais l'effacer | Critique | Les clés de signature OIDC de Logto résident dans la base. L'effacer régénère de nouvelles clés et invalide chaque jeton émis et chaque client enregistré. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/le rôle et détruit toutes les données d'identité. |
| `database_type` | `POSTGRES_15` | Critique | MySQL et les autres moteurs sont rejetés au moment du plan ; Logto ne fonctionne que sur PostgreSQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `ENDPOINT` | URL externe du LoadBalancer / du domaine personnalisé | Élevé | Un émetteur incohérent casse la découverte OIDC, les URI de redirection et chaque callback OAuth. |
| `container_port` | `3001` | Élevé | Le cœur écoute sur 3001 ; un mauvais port fait échouer chaque sonde et chaque requête. La console d'administration (3002) n'est volontairement pas publiée. |
| `enable_iap` | `false` pour un IdP public | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les parcours OIDC/de connexion que Logto existe pour servir. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous d'environ 2 GiB, Logto est sujet aux OOM sous charge. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, des requêtes successives d'un même client peuvent atteindre des pods différents en plein parcours. |
| Accès à la console d'administration (3002) | `kubectl port-forward` pour la configuration | Élevé | L'interface de premier administrateur/de configuration est sur 3002, inaccessible via le LoadBalancer — la configuration initiale est bloquée sans port-forward. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour le chemin PostgreSQL par loopback sur GKE. |
| `enable_redis` | `false` | Faible | Logto n'utilise pas Redis ; l'activer câble une dépendance inutilisée. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers nus sont des octets et bloquent toute planification de pods dans l'espace de noms. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration
applicative propre à Logto partagée avec la variante Cloud Run est décrite dans
**[Logto_Common](Logto_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Logto sur GKE Autopilot](../labs/Logto_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Logto sur Google Cloud Run](Logto_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Logto Common — Configuration applicative partagée](Logto_Common.md) — la configuration partagée par les deux cibles de déploiement.
