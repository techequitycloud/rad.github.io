---
title: "Docuseal sur GKE Autopilot"
description: "Référence de configuration pour déployer Docuseal sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Docuseal_GKE.md @ 3055034 sha256:dc522e5e2976 -->

# Docuseal sur GKE Autopilot {#docuseal-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Docuseal_GKE.png" alt="Docuseal sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

DocuSeal est une plateforme open source de signature de documents — une alternative
auto-hébergée à DocuSign pour créer, remplir et signer des documents PDF, avec un
générateur de formulaires visuel, des modèles réutilisables et des pistes d'audit.
Ce module déploie DocuSeal sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise DocuSeal et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

DocuSeal s'exécute comme une charge de travail web Ruby on Rails (Puma) unique. Le
déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — DocuSeal ne prend pas en charge MySQL ni d'autres moteurs |
| Documents persistants | Filestore / NFS **ou** PVC bloc | Les documents téléversés résident dans `/data/docuseal` |
| Stockage objet | Cloud Storage | Un bucket provisionné automatiquement (ce n'est pas le stockage de documents par défaut) |
| Secrets | Secret Manager | `SECRET_KEY_BASE` généré automatiquement ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche applicative partagée ; choisir un autre moteur empêche le démarrage.
- **`container_port = 3000` et les sondes doivent y correspondre.** Sur GKE, la
  variable d'environnement `PORT` n'est **pas** injectée (contrairement à Cloud Run) ;
  Puma utilise donc la valeur par défaut de sa configuration, 3000. Si
  `container_port` ou les sondes pointent ailleurs, elles visent un port mort et le
  pod ne devient jamais Ready alors que l'application est saine.
- **Le sidecar Auth Proxy est utilisé sur GKE.** `enable_cloudsql_volume = true`
  exécute le sidecar Cloud SQL Auth Proxy ; DocuSeal joint donc PostgreSQL via
  `127.0.0.1` (TCP simple, TLS assuré par le proxy) — le point d'entrée emprunte la
  branche de boucle locale.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il
  ne doit jamais faire l'objet d'une rotation après le premier démarrage — cela
  invaliderait tous les cookies de session signés et déconnecterait tous les
  utilisateurs.
- **Les documents téléversés nécessitent un volume persistant.** Par défaut,
  `enable_nfs = true` monte le volume NFS partagé sur `/data/docuseal` ; vous pouvez
  aussi définir `stateful_pvc_enabled = true` (ce qui sélectionne automatiquement un
  StatefulSet) avec `stateful_pvc_mount_path = /data/docuseal` pour un PVC bloc par
  pod.
- **Au moins 1 réplica** (GKE ne prend pas en charge la mise à zéro) ;
  `session_affinity` vaut `ClientIP` par défaut et une IP statique est réservée afin
  que l'adresse du LoadBalancer survive aux redéploiements.
- **Pas de Redis.** DocuSeal utilise une file d'attente / un cache adossés à
  PostgreSQL (`enable_redis = false`).
- **Les migrations s'exécutent au démarrage.** DocuSeal applique ses propres
  migrations ActiveRecord à chaque démarrage ; le seul job d'initialisation crée le
  rôle et la base de données PostgreSQL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail DocuSeal {#a-gke-autopilot--the-docuseal-workload}

Les pods DocuSeal sont ordonnancés sur Autopilot, qui facture le CPU et la mémoire
demandés par les pods. L'autoscaling horizontal des pods dimensionne le déploiement
entre les nombres minimal et maximal de réplicas. Lorsqu'un PVC bloc est activé, la
charge de travail devient un StatefulSet.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  DocuSeal pour voir les pods, les révisions et les événements. Kubernetes Engine →
  Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"           # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la mise à
l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

DocuSeal stocke toutes les données applicatives (modèles, soumissions, signataires,
utilisateurs, piste d'audit) dans une instance gérée Cloud SQL for PostgreSQL 15. Les
pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1` ; aucune IP publique n'est exposée. Lors du premier déploiement, un Job
d'initialisation crée la base de données et le rôle de l'application.

- **Console :** SQL → sélectionnez l'instance pour voir les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=docuseal --database=docuseal --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe figurent tous dans les [sorties](#5-outputs). Pour
le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. Documents persistants — NFS ou PVC bloc {#c-persistent-documents--nfs-or-block-pvc}

DocuSeal écrit les documents et pièces jointes téléversés dans `/data/docuseal`. Par
défaut, ce chemin est adossé au volume **NFS** partagé (`enable_nfs = true`) ; à la
place, un **PVC bloc** par pod (`stateful_pvc_enabled = true`, 10 GiB par défaut)
monté sur le même chemin peut l'adosser au sein d'un StatefulSet.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Storage (PVC).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- ls -la /data/docuseal
  ```

Consultez [App_GKE](App_GKE.md) pour le modèle de découverte NFS et les modèles de PVC
des StatefulSet.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **Cloud Storage** (suffixe de nom `storage`) est provisionné
automatiquement et le compte de service de la charge de travail y reçoit l'accès. Le
stockage de documents de DocuSeal utilise par défaut le volume persistant ci-dessus ;
ce bucket est donc disponible pour un usage auxiliaire plutôt que comme stockage
principal des documents.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/           # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
`SECRET_KEY_BASE` (utilisé par Rails pour signer les cookies de session et d'autres
valeurs signées). Le mot de passe de la base de données est géré séparément par le
socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~docuseal"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base figure dans les [sorties](#5-outputs).
Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`) avec une IP statique réservée, afin que l'adresse
survive aux redéploiements. Un domaine personnalisé avec un certificat géré par
Google peut être activé.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur l'IP statique.

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les sorties stdout/stderr des pods (Rails journalise sur stdout) sont envoyées vers
Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Docuseal {#3-docuseal-application-behaviour}

- **Configuration de la base au premier déploiement.** Un Job d'initialisation
  exécute `db-init.sh` avec `postgres:15-alpine`. Il se connecte via le Cloud SQL
  Auth Proxy et, de manière idempotente, crée le rôle et la base de données
  `docuseal`, accorde tous les privilèges, réattribue la propriété du schéma `public`
  au rôle de l'application (PostgreSQL 15 n'accorde plus `CREATE` sur `public` par
  défaut) et signale au sidecar du proxy de s'arrêter afin que le pod du Job se
  termine. Le job peut être relancé sans risque.
- **Migrations au démarrage.** DocuSeal exécute automatiquement ses propres
  migrations ActiveRecord à chaque démarrage sous le rôle de l'application ; la mise à
  niveau de la version de l'application applique donc les changements de schéma sans
  étape de migration distincte.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une
  seule fois et écrit dans Secret Manager. Le faire tourner invalide tous les cookies
  de session signés, obligeant chaque utilisateur à se reconnecter. Ne le faites
  tourner que pendant une fenêtre de maintenance planifiée.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité (readiness)
  ciblent `/up` — le point de terminaison de santé intégré de Rails, qui renvoie un
  `200` non authentifié dès que l'application est prête. Les sondes s'exécutent sur le
  port 3000 ; comme GKE n'injecte pas `PORT`, `container_port` et le port des sondes
  doivent tous deux valoir 3000.
- **Configuration au premier lancement.** DocuSeal n'a pas d'identifiants par défaut.
  Une fois l'IP du LoadBalancer attribuée, ouvrez l'URL du service et remplissez
  l'écran de configuration pour créer le compte administrateur initial (e-mail + mot
  de passe) avant d'inviter des utilisateurs ou de créer des modèles.
- **Documents persistants.** Les documents téléversés résident dans `/data/docuseal`
  sur le volume NFS (ou le PVC bloc). Inspectez le montage depuis un pod :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- df -h /data/docuseal
  ```
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à DocuSeal ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail recevant un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `docuseal` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DocuSeal (`FROM docuseal/docuseal:<tag>`) ; épinglez une version précise en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_resources` | `{ cpu_limit = "2000m", memory_limit = "4Gi" }` | Limites et demandes de CPU / mémoire du conteneur DocuSeal. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE exige ≥ 1. |
| `max_instance_count` | `5` | Nombre maximal de réplicas. |
| `container_port` | `3000` | Puma écoute sur 3000 ; les sondes doivent correspondre. Ne le modifiez pas. |
| `enable_image_mirroring` | `true` | Met en miroir l'image DocuSeal dans Artifact Registry. |
| `container_image_source` | `custom` | Enveloppe légère construite à partir de `docuseal/docuseal`. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs essentielles (`RAILS_LOG_TO_STDOUT`, `WORKDIR`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom de secret Secret Manager. `SECRET_KEY_BASE` est injecté automatiquement. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `null` | Sélectionne automatiquement Deployment ; devient StatefulSet lorsque `stateful_pvc_enabled = true`. |
| `session_affinity` | `ClientIP` | Routage persistant pour les sessions d'interface. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `database_type` | `POSTGRES_15` | Moteur PostgreSQL 15 fixe. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy → TCP en boucle locale. Laissez-le activé. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC bloc par pod (sélectionne automatiquement un StatefulSet), en alternative à NFS. |
| `stateful_pvc_mount_path` | `/data/docuseal` | Chemin de montage du PVC — doit correspondre au `WORKDIR` de DocuSeal. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_fs_group` | `0` | fsGroup appliqué au volume PVC. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai de 60 s, timeout de 10 s, période de 15 s, 30 tentatives | Sonde de démarrage sur le point de terminaison de santé de Rails. |
| `liveness_probe` | HTTP `/up`, délai de 60 s, timeout de 5 s, période de 30 s, 3 tentatives | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init` (crée le rôle + la base de données). |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Monte le volume NFS partagé sur `/data/docuseal` pour des documents persistants (le modèle de persistance par défaut). |
| `nfs_mount_path` | `/data/docuseal` | Chemin de montage — doit correspondre au `WORKDIR` de DocuSeal. |

### Groupe 15 — Cache et file d'attente Redis {#group-15--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | DocuSeal utilise une file d'attente / un cache adossés à PostgreSQL ; laissez-le désactivé. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `docuseal` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `docuseal` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à DocuSeal. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails de la CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster / la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `workload_type` `Deployment` avec `stateful_pvc_enabled = true`, des unités `quota_memory_*` non binaires, IAP sans identité autorisée, un `database_type` qui ne correspond pas à une extension activée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (généré automatiquement) | Ne jamais le faire tourner après le premier démarrage | Critique | Une rotation invalide tous les cookies de session signés — chaque utilisateur est déconnecté. |
| `enable_nfs` / `stateful_pvc_enabled` | Exactement un des deux activé | Critique | Sans aucun des deux, les documents sont écrits sur le disque éphémère du pod et perdus au redémarrage / au réordonnancement. |
| `nfs_mount_path` / `stateful_pvc_mount_path` | `/data/docuseal` | Critique | Doit correspondre au `WORKDIR` de DocuSeal ; un chemin différent signifie que les documents sont écrits sur un stockage non persistant. |
| `application_database_name` / `application_database_user` | À définir une fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base / l'utilisateur et détruit toutes les données. |
| `container_port` | `3000` | Élevé | GKE n'injecte pas `PORT` ; un port différent fait viser un port mort aux sondes et le pod ne devient jamais Ready. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy fournit le chemin en boucle locale qu'attend le point d'entrée ; le désactiver casse la connectivité à la base sur GKE. |
| `workload_type` | `null` / `StatefulSet` | Élevé | Imposer `Deployment` avec `stateful_pvc_enabled = true` échoue au moment du plan. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions de signature en plusieurs étapes peuvent être routées vers des pods différents. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent tout ordonnancement de pod dans l'espace de noms. |
| `memory_limit` | `4Gi` | Moyen | Le rendu et la signature des PDF sont gourmands en mémoire ; trop réduire expose à des arrêts OOM en charge. |
| `application_version` | À épingler en production | Moyen | `latest` peut récupérer une nouvelle version majeure au redéploiement et appliquer des migrations que vous n'avez pas examinées. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à DocuSeal, partagée
avec la variante Cloud Run, est décrite dans **[Docuseal_Common](Docuseal_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DocuSeal sur GKE Autopilot](../labs/Docuseal_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Docuseal Common — Configuration applicative partagée](Docuseal_Common.md) — la configuration partagée par les deux cibles de déploiement.
