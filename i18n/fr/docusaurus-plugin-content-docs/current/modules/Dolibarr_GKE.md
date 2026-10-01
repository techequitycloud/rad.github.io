---
title: "Dolibarr sur GKE Autopilot"
description: "Référence de configuration pour déployer Dolibarr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Dolibarr_GKE.md @ 3055034 sha256:5f38e6449b72 -->

# Dolibarr sur GKE Autopilot {#dolibarr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dolibarr_GKE.png" alt="Dolibarr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dolibarr est une suite ERP et CRM gratuite et open source couvrant les clients et
prospects, les devis, les commandes, les factures, les produits et les stocks, les RH,
les projets et la comptabilité au moyen d'une interface web PHP modulaire. Ce module
déploie Dolibarr sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui
provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Dolibarr et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Dolibarr s'exécute comme une charge de travail web PHP/Apache unique. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les documents/PDF téléversés persistent sous `/var/lib/dolibarr`, partagés entre les pods |
| Stockage objet | Cloud Storage | Un bucket `dolibarr-documents` provisionné automatiquement |
| Secrets | Secret Manager | `DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` générés automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée (la variante transmet `database_type = null`, ce qui conserve la
  valeur par défaut `MYSQL_8_0` de Common) ; les autres moteurs ne sont pas pris en
  charge.
- **Cloud SQL est joint via le sidecar Auth Proxy sur l'interface de bouclage.** La
  variante définit `DB_HOST = 127.0.0.1` ; un sidecar cloud-sql-proxy
  (`enable_cloudsql_volume = true`) écoute sur `127.0.0.1:3306`, et l'entrypoint du
  wrapper reporte les `DB_*` injectées sur `DOLI_DB_*`.
- **Réplique unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Dolibarr conserve un état de session et de verrouillage ; la charge de travail
  adossée à NFS se déploie avec la stratégie `Recreate`, donc ne dépassez pas 1 sans
  avoir vérifié le comportement du stockage partagé.
- **NFS est activé par défaut** (`enable_nfs = true`, monté sur `/var/lib/dolibarr`)
  afin que les documents téléversés et les PDF générés persistent et puissent être
  partagés entre les pods.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client
  atteignent le même pod.
- **Installation automatique au premier démarrage.** `DOLI_INSTALL_AUTO = 1` fait
  créer le schéma par l'installateur Dolibarr au premier démarrage ; il n'y a pas de
  job de migration distinct.
- **`DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` sont générés automatiquement**
  et stockés dans Secret Manager. Le mot de passe administrateur crée le compte
  super-administrateur initial (nom d'utilisateur `DOLI_ADMIN_LOGIN`, `admin` par
  défaut).
- **`DOLI_URL_ROOT` n'est pas prédéfini sur GKE.** Définissez-le via
  `environment_variables` sur l'URL du LoadBalancer externe ou du domaine personnalisé
  une fois l'IP attribuée, afin que les liens absolus et les redirections de connexion
  soient correctement résolus.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Dolibarr {#a-gke-autopilot--the-dolibarr-workload}

Les pods Dolibarr sont planifiés sur Autopilot, qui facture le CPU/la mémoire
effectivement demandés par les pods. Comme la charge de travail est adossée à NFS, le
Deployment utilise la stratégie `Recreate` (une mise à jour progressive ferait
tourner deux pods sur le même volume NFS et la même base partagée, et provoquerait un
interblocage).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Dolibarr pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Dolibarr stocke toutes les données applicatives (tiers, factures, produits,
utilisateurs, comptabilité) dans une instance Cloud SQL for MySQL 8.0 gérée. Les pods
y accèdent via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP
publique n'est exposée. Au premier déploiement, le job `db-init` crée la base de
données applicative, l'utilisateur et les droits ; l'installateur Dolibarr crée
ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager
contenant le mot de passe figurent tous dans les [Outputs](#5-outputs). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes automatisées et la
rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `dolibarr-documents`) est provisionné
automatiquement et le compte de service de la charge de travail reçoit l'accès. Par
ailleurs, l'arborescence documentaire de Dolibarr réside sur **NFS (Cloud Filestore)**
dans `/var/lib/dolibarr`, partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Dolibarr sont générés automatiquement et stockés dans Secret Manager :
`DOLI_ADMIN_PASSWORD` (le mot de passe du super-administrateur initial) et
`DOLI_INSTANCE_UNIQUE_ID` (un sel de sécurité propre à l'instance). Le mot de passe de
la base de données est géré séparément par le socle. Sur GKE, les secrets sont
projetés dans les pods via le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive
aux redéploiements). Un domaine personnalisé avec un certificat géré par Google peut
être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

La sortie stdout/stderr des pods est envoyée à Cloud Logging ; les métriques de GKE et
de Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des
règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Dolibarr {#3-dolibarr-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `db-init.sh` avec `mysql:8.0-debian`. Il se connecte à Cloud SQL (socket
  Unix sous `/cloudsql` via le sidecar Auth Proxy), crée de manière idempotente la base
  de données applicative, l'utilisateur et les droits, vérifie que l'utilisateur
  applicatif peut se connecter, puis arrête le sidecar du proxy. Le job peut être
  relancé sans risque (`execute_on_apply = true`, `max_retries = 3`).
- **Installation automatique au premier démarrage (pas de job de migration distinct).**
  Avec `DOLI_INSTALL_AUTO = 1`, l'image Dolibarr exécute son propre installateur au
  premier démarrage du pod et crée le schéma dans la base vide. Les montées de version
  exécutent les propres étapes de mise à niveau de l'image au démarrage.
- **Compte administrateur.** L'installateur crée un super-administrateur dont le nom
  d'utilisateur est `DOLI_ADMIN_LOGIN` (`admin` par défaut) et dont le mot de passe est
  le secret généré `DOLI_ADMIN_PASSWORD`. Récupérez-le avant la première connexion.
- **Alias des variables d'environnement de la base sur l'interface de bouclage.** La
  plateforme injecte `DB_HOST = 127.0.0.1` (le sidecar du proxy) et les autres valeurs
  `DB_*` ; Dolibarr lit `DOLI_DB_*`. L'entrypoint du wrapper crée ces alias et
  privilégie les valeurs injectées par rapport aux valeurs par défaut `mysql`/`dolidb`
  intégrées à l'image.
- **Les déploiements adossés à NFS utilisent `Recreate`.** Les mises à jour arrêtent
  l'ancien pod avant de démarrer le nouveau, ce qui évite que deux pods ne
  s'interbloquent sur le volume NFS partagé et sur les verrous de la base.
- **Définissez `DOLI_URL_ROOT` une fois l'IP connue.** Il n'est pas prédéfini sur GKE —
  modifiez le déploiement ou définissez `environment_variables` sur l'URL externe une
  fois l'IP du LoadBalancer attribuée :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"dolibarr","env":[
      {"name":"DOLI_URL_ROOT","value":"https://dolibarr.example.com"}]}]}}}}'
  ```
- **Chemin de santé.** La sonde de démarrage est en **TCP** sur le port 80 ; la sonde
  de vivacité est en **HTTP** `GET /` (la page de connexion renvoie 200 sans
  authentification). Prévoyez plusieurs minutes au premier démarrage pour
  l'installateur.
- **Inspecter le job d'initialisation et la configuration en cours :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DOLI_DB
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Dolibarr ou notables pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dolibarr` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `dolibarr/dolibarr` utilisée comme base du build personnalisé ; `latest` est épinglé sur un tag éprouvé (`23.0.3`) au moment du build. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour des modules lourds ou de grandes bibliothèques de documents. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléversement / de POST ; gardez `post_max_size ≥ upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU minimum pour Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512Mi ; 2Gi recommandés en production. |
| `min_instance_count` | `1` | Gardez 1 pour que la charge de travail reste joignable. |
| `max_instance_count` | `1` | **Gardez 1**, sauf si le partage multi-pod a été vérifié. |
| `container_port` | `80` | Dolibarr s'exécute sur Apache, port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (bouclage) — obligatoire sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface Dolibarr. |
| `workload_type` | `null` → `Deployment` | Deployment (adossé à NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant (sticky) afin qu'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les documents téléversés persistent et soient partagés. |
| `nfs_mount_path` | `/var/lib/dolibarr` | Emplacement où Dolibarr stocke les documents/PDF. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Conserve la valeur par défaut MySQL 8.0 de Common. |
| `application_database_name` | `dolibarr` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `dolibarr` | Utilisateur applicatif de la base ; mot de passe généré automatiquement dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `application_domains` | `[]` | Noms d'hôte personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à Dolibarr. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
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

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `StatefulSet` imposé en parallèle d'un paramètre sans état, IAP sans identité autorisée, des `quota_memory_*` fournis en entiers nus, un `container_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critical | Choisir un moteur autre que MySQL casse l'installateur et toutes les requêtes. |
| `application_database_name` / `application_database_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et rend toutes les données orphelines. |
| `DOLI_INSTANCE_UNIQUE_ID` (généré automatiquement) | Ne jamais le modifier | Critical | Modifier le sel après le premier démarrage invalide les jetons signés et les URL cron. |
| `enable_nfs` | `true` | High | Le désactiver rend les documents/PDF téléversés éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base sur GKE. |
| `max_instance_count` | `1` | High | Dépasser 1 sans avoir vérifié le comportement du stockage partagé et des verrous expose à des sessions scindées et à de la contention de verrous NFS/base. |
| `session_affinity` | `ClientIP` | High | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `DOLI_URL_ROOT` (défini une fois l'IP connue) | URL du LoadBalancer externe/du domaine | High | Une URL racine erronée ou absente casse les liens absolus et la redirection de connexion. |
| `memory_limit` | `2Gi` | High | En dessous de 512Mi, le pod PHP/Apache subit un OOM sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés comme des octets et bloquent toute planification de pods dans l'espace de noms. |
| `DOLI_ADMIN_PASSWORD` (généré automatiquement) | Le récupérer avant la première connexion | Medium | Sans lui, vous ne pouvez pas accéder au premier compte super-administrateur tant qu'il n'est pas réinitialisé via la base. |
| `reserve_static_ip` | `true` | Medium | Sans elle, l'IP externe peut changer d'un redéploiement à l'autre, ce qui casse le DNS et `DOLI_URL_ROOT`. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences réglementaires. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC, sauvegardes et duplication d'images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Dolibarr, partagée avec
la variante Cloud Run, est décrite dans **[Dolibarr_Common](Dolibarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dolibarr sur GKE Autopilot](../labs/Dolibarr_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Dolibarr Common — Configuration applicative partagée](Dolibarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
