---
title: "Logto sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Logto sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Logto_GKE.md @ 15fd4c7 sha256:9d565adb236c -->

# Logto sur GKE Autopilot {#logto-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Logto_GKE.png" alt="Logto sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Logto est un fournisseur d'identité open-source sous licence MPL-2.0 — une
alternative à Auth0 qui prend en charge OIDC et OAuth 2.0 et qui est livré avec
des flux de connexion, des connecteurs sociaux/d'entreprise, la multi-location
et une console d'administration. Ce module déploie Logto sur **GKE Autopilot**
sur la base de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Logto et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Logto s'exécute comme une charge de travail web Node.js. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js, 2 vCPU / 4 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Logto ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage d'objets | Cloud Storage | Un bucket provisionné automatiquement ; optionnel pour Logto (tout l'état du cœur est dans Postgres) |
| Secrets | Secret Manager | Seulement le mot de passe de la base de données — Logto n'a **pas** de secret d'application externe (les clés OIDC sont amorcées par la base de données) |
| Ingress | Cloud Load Balancing | LoadBalancer externe ; domaine personnalisé optionnel + certificat géré (hôte nip.io par défaut) |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par
  la couche d'application partagée ; une garde au moment de la planification
  rejette tout non-PostgreSQL `database_type`.
- **Le cœur de Logto est publié sur le port 3001 ; la console d'administration
  (3002) ne l'est pas.** Un seul service GKE publie un port, donc seul le point
  de terminaison de l'API/OIDC (3001) est accessible. La console
  d'administration — où le premier compte administrateur et les applications
  sont enregistrés — s'exécute sur le port 3002 et nécessite un itinéraire
  séparé (par exemple `kubectl port-forward`) pour la configuration initiale (voir §3).
- **Il n'y a pas de secret d'application à protéger.** Logto génère ses clés de
  signature OIDC au premier démarrage et les stocke **dans la base de données**.
  Rien dans Secret Manager n'a besoin d'être protégé ou renouvelé, à l'exception
  du mot de passe de la base de données géré par la fondation. Protéger les
  clés de Logto signifie protéger Cloud SQL.
- **Cloud SQL via la boucle de rappel du proxy d'authentification.** Sur GKE, le
  sidecar du proxy d'authentification écoute sur `127.0.0.1` ; le point d'entrée de
  Logto se connecte via une boucle de rappel TCP simple avec SSL désactivé (le
  proxy termine TLS vers Cloud SQL).
- **L'affinité de session est `ClientIP` par défaut** afin qu'un client atteigne
  toujours le même pod.
- **`service_type = LoadBalancer` avec une IP statique et un domaine personnalisé nip.io par
  défaut** (`reserve_static_ip = true`, `enable_custom_domain = true`), offrant à Logto un hôte HTTPS stable
  et accessible de l'extérieur dès la sortie de la boîte.
- **Pas de Redis.** Logto est basé sur Postgres ; `enable_redis` par défaut à
  `false`.
- **`ENDPOINT` est dérivé de l'URL du service.** Le point d'entrée définit
  l'émetteur OIDC de Logto et les URL absolues à partir de `GKE_SERVICE_URL` injecté ;
  mettez à jour `ENDPOINT` vers l'URL du LoadBalancer externe / du domaine
  personnalisé une fois qu'elle est connue.
- **Un minimum de 1 réplica est maintenu** (GKE ne prend pas en charge la
  mise à l'échelle à zéro) pour que le point de terminaison d'identité soit
  toujours accessible.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Logto {#a-gke-autopilot--the-logto-workload}

Les pods Logto sont planifiés sur Autopilot, qui facture le CPU/la mémoire que
les pods demandent réellement. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimum et maximum de réplicas. Le conteneur et le
service publient le port **3001** (cœur de Logto).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge
  de travail Logto pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|DB_IP|ENDPOINT'
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Déploiement vs StatefulSet).

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Logto stocke tout — utilisateurs, applications, connecteurs, clés de signature
OIDC et rôles par locataire — dans une instance gérée de Cloud SQL pour
PostgreSQL 15. Les pods y accèdent via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1` ; le point d'entrée se connecte via une boucle de rappel TCP simple (le
proxy termine TLS). Lors du premier déploiement, un Job d'initialisation crée
la base de données et le rôle de l'application (avec `CREATEROLE`, requis pour les
rôles RLS par locataire de Logto).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`logto`), l'utilisateur (`logto`) et
le secret Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** est provisionné automatiquement et le compte de
service de la charge de travail se voit accorder l'accès. Logto conserve tout
l'état du cœur dans PostgreSQL, de sorte que ce bucket est disponible pour des
actifs optionnels plutôt que pour un stockage d'exécution requis.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Logto n'a **pas de secret d'application externe** — ses clés de signature OIDC
sont générées et stockées dans la base de données au premier démarrage. Le seul
secret en jeu est le **mot de passe de la base de données**, que la fondation
génère, gère et synchronise dans le pod via le pilote CSI du Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~logto"
  gcloud secrets versions access latest --secret=<database_password_secret> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI.

### E. Réseau et Ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe de Cloud Load
Balancing avec une adresse statique réservée et un domaine personnalisé basé
sur nip.io + un certificat géré. L'émetteur OIDC de Logto et toutes les URL de
redirection absolues sont construits à partir de `ENDPOINT`, de sorte que l'hôte
externe, l'émetteur et les URI de redirection enregistrés doivent tous
concorde — mettez à jour `ENDPOINT` vers l'URL externe une fois que l'IP / le
domaine du LoadBalancer est attribué.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails des IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les
métriques GKE et Cloud SQL sont acheminées vers Cloud Monitoring. Le point
d'entrée imprime une ligne `[cloud-entrypoint]` signalant le mode de connexion à la base de
données résolu et `ENDPOINT` — utile pour diagnostiquer les problèmes de connexion
ou d'URL d'émetteur.

- **Console :** Journalisation → Explorateur de journaux ; Surveillance → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Logto {#3-logto-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job
  d'initialisation exécute `db-init.sh` en utilisant `postgres:15-alpine`. Il crée de manière
  idempotente le rôle d'application **avec `CREATEDB CREATEROLE`** (requis pour les rôles RLS
  par locataire de Logto) et la base de données d'application, accorde les
  privilèges, transfère la propriété du schéma `public` au rôle d'application,
  puis signale au sidecar Auth Proxy de s'arrêter afin que le pod du Job puisse
  se terminer. Le job peut être réexécuté en toute sécurité.
- **Schéma et clés OIDC amorcés au démarrage.** Au démarrage, Logto exécute
  `npm run cli db seed -- --swe` (`--swe` = amorcer-si-vide, idempotent) qui crée son schéma et
  génère les clés de signature privées OIDC **dans la base de données** —
  uniquement lorsque la base de données est vide. Ces clés ne sont pas stockées
  dans Secret Manager ; la base de données est leur seul dépositaire. Effacer la
  base de données régénère de nouvelles clés et invalide tous les jetons
  précédemment émis et les clients enregistrés.
- **Pas de secret d'application à renouveler.** Il n'y a pas de clé de
  chiffrement ou de secret JWT dans Secret Manager — seulement le mot de passe
  de la base de données géré par la fondation.
- **La console d'administration (3002) n'est pas publiée.** Le service expose
  uniquement le cœur (3001). Accédez à la console d'administration pour créer
  le premier administrateur et enregistrer les applications via un
  port-forward :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3002:3002
  # then open http://localhost:3002
  ```
  `ADMIN_ENDPOINT` par défaut au même hôte que `ENDPOINT` pour la cohérence des URL.
- **`ENDPOINT` doit correspondre à l'hôte visible par le navigateur.** Logto
  construit son émetteur OIDC et ses URL de redirection à partir de `ENDPOINT` ;
  le point d'entrée le définit à partir de `GKE_SERVICE_URL`. Mettez-le à jour vers
  l'URL du LoadBalancer externe ou du domaine personnalisé via `environment_variables` une fois
  que l'adresse externe est connue.
- **Chemin de santé.** La sonde de démarrage cible `/api/status` ; les sondes de
  vivacité et de disponibilité ciblent `/oidc/.well-known/openid-configuration`. Le chemin de vivacité doit
  retourner un `200` littéral car App_GKE le reflète dans la vérification de
  santé de la passerelle, et `/api/status` retourne `204`, que l'équilibreur de
  charge traite comme non sain (la passerelle servirait 503). Le port du
  conteneur et les sondes doivent tous être `3001`. Vérifier :
  ```bash
  kubectl port-forward -n "$NAMESPACE" deploy/<service-name> 3001:3001 &
  curl -s http://localhost:3001/oidc/.well-known/openid-configuration
  ```
- **Inspecter l'exécution du job d'initialisation :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Logto sont listés ; toute autre entrée est héritée de [App_GKE](App_GKE.md)
avec son comportement standard et ses valeurs par défaut.

### Groupe 1 — Projet et Identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `logto` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Logto (`svhd/logto:<tag>`) ; épingler à une version spécifique (par exemple `1.33`) en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimum de réplicas ; GKE exige ≥ 1. Maintient le point de terminaison d'identité accessible. |
| `max_instance_count` | `5` | Nombre maximum de réplicas. |
| `container_resources` | `{cpu_limit="2000m", memory_limit="4Gi"}` | Limites et requêtes CPU/mémoire pour le conteneur Logto ; Logto a besoin d'au moins 2 GiB de mémoire. |
| `container_port` | `3001` | Le cœur de Logto écoute sur le port 3001 ; la console d'administration (3002) n'est pas publiée. Le port et les sondes doivent correspondre à 3001. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (boucle de rappel TCP). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Comment le service Kubernetes est exposé. |
| `workload_type` | `null` (→ Déploiement) | `Deployment` (sans état ; Logto conserve tout l'état dans Postgres) ou `StatefulSet`. |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client reste sur un seul pod. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` (désactivé) | Non nécessaire — Logto stocke tout l'état dans PostgreSQL. L'activation sélectionne automatiquement `StatefulSet`. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/status`, large fenêtre de premier démarrage | Permet du temps pour l'étape d'amorçage. |
| `liveness_probe` | HTTP `/oidc/.well-known/openid-configuration` | Sonde de vivacité/disponibilité. Doit retourner un `200` littéral — il est reflété dans la vérification de santé de la passerelle, et `/api/status` retourne `204`. |
| `uptime_check_config` | désactivé — `/` | Vérification de disponibilité Cloud Monitoring optionnelle contre l'hôte LoadBalancer ; désactivée par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Provisionne un volume Filestore partagé. Non requis par Logto (il stocke tout l'état dans PostgreSQL) — peut être remplacé en toute sécurité par `false`. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Logto utilise Postgres pour toute la persistance — laisser `false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `logto` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `logto` | Utilisateur de la base de données de l'application (octroyé `CREATEROLE`). Immuable après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne Ingress + certificat géré (hôte nip.io par défaut). |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes à servir ; définir `ENDPOINT` pour qu'ils correspondent. |

### Groupe 20 — Proxy conscient de l'identité (IAP) {#group-20--identity-aware-proxy-iap}

> **Attention :** L'activation d'IAP nécessite une authentification Google
> Identity pour **toutes** les requêtes entrantes, y compris les flux OIDC/de
> connexion que Logto est censé servir. Laissez désactivé pour un fournisseur
> d'identité public.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google devant Logto. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIP pour les services spécifiques à l'étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre le cœur de Logto. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via le proxy d'authentification) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (optionnel). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration au moteur de fondation [App_GKE](App_GKE.md), qui valide les
> valeurs *et les combinaisons* au moment de la planification — un
> non-PostgreSQL `database_type`, `min_instance_count > max_instance_count`, Redis activé sans hôte résoluble, IAP sans
> identités autorisées, un domaine personnalisé sans noms d'hôtes. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Base de données Cloud SQL | Sauvegarder ; ne jamais effacer | Critique | Les clés de signature OIDC de Logto résident dans la base de données. L'effacement régénère de nouvelles clés et invalide tous les jetons émis et les clients enregistrés. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/le rôle et détruit toutes les données d'identité. |
| `database_type` | `POSTGRES_15` | Critique | MySQL/autres moteurs sont rejetés au moment de la planification ; Logto ne fonctionne que sur PostgreSQL. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `ENDPOINT` | URL du LoadBalancer externe / du domaine personnalisé | Élevé | Un émetteur non concordant rompt la découverte OIDC, les URI de redirection et chaque rappel OAuth. |
| `container_port` | `3001` | Élevé | Le cœur écoute sur le port 3001 ; un mauvais port fait échouer toutes les sondes et requêtes. La console d'administration (3002) n'est intentionnellement pas publiée. |
| `enable_iap` | `false` pour un IdP public | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les flux OIDC/de connexion que Logto est censé servir. |
| `container_resources.memory_limit` | `4Gi` (≥ 2 GiB) | Élevé | En dessous de ~2 GiB, Logto est sujet aux OOM sous charge. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes séquentielles d'un client peuvent atteindre différents pods en cours de flux. |
| Accès à la console d'administration (3002) | `kubectl port-forward` pour la configuration | Élevé | L'interface utilisateur du premier administrateur/de la configuration est sur le port 3002, inaccessible via le LoadBalancer — la configuration initiale échoue sans port-forward. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la garde de validation rejette les valeurs invalides. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy est requis pour le chemin PostgreSQL en boucle de rappel sur GKE. |
| `enable_redis` | `false` | Faible | Logto n'utilise pas Redis ; l'activation connecte une dépendance inutilisée. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload
Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_GKE](App_GKE.md)**. La configuration d'application spécifique à Logto
partagée avec la variante Cloud Run est décrite dans
**[Logto_Common](Logto_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Logto sur GKE Autopilot](../labs/Logto_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Logto sur Google Cloud Run](Logto_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Logto Common — Configuration d'application partagée](Logto_Common.md) — la configuration partagée par les deux cibles de déploiement.
