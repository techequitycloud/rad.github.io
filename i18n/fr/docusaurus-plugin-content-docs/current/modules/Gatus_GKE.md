---
title: "Gatus sur GKE Autopilot"
description: "Référence de configuration pour déployer Gatus sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Gatus_GKE.md @ 3055034 sha256:80a9d3abc69c -->

# Gatus sur GKE Autopilot {#gatus-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Gatus_GKE.png" alt="Gatus sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Gatus est une page de statut et un moniteur de contrôles de santé open source, sous
licence Apache 2.0, orienté développeurs et écrit en Go. Il interroge des points de
terminaison HTTP, TCP, DNS, ICMP et autres, chacun selon sa propre planification,
évalue des conditions de résultat simples (code de statut, temps de réponse, contenu
du corps de la réponse, expiration du certificat TLS) et sert une page de statut
publique en direct ainsi que des alertes — sans base de données externe. Ce module
déploie Gatus sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md),
qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Gatus et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toutes les applications GKE — Workload
Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC
Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Gatus s'exécute comme une unique charge de travail web Go. Le déploiement assemble un
ensemble volontairement restreint de services Google Cloud — Gatus ne dépend
d'aucune base de données, d'aucun cache ni d'aucun stockage d'objets :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Deployment Go unique, 1 vCPU / 512 MiB par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; le stockage d'historique facultatif est un fichier SQLite local, aucune instance Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut), NFS ou PVC en mode bloc (StatefulSet) | Historique SQLite dans `/data/data.db` ; le PVC en mode bloc est la seule option dont la sûreté a été vérifiée pour le SQLite en mode WAL de Gatus (voir ci-dessous) |
| Stockage d'objets | **Aucun** | Gatus ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; Gatus ne dépend d'aucun cache ni d'aucune file d'attente |
| Secrets | Secret Manager | Aucun secret généré automatiquement ; uniquement les `secret_environment_variables` fournies par l'utilisateur |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — le
  stockage d'historique facultatif de Gatus est un fichier SQLite local. Les
  variables liées à la base de données existent par souci d'exhaustivité, mais sont
  inertes sauf si vous choisissez délibérément une base de données externe.
- **La configuration repose entièrement sur un fichier.** Chaque point de
  terminaison surveillé, chaque intégration d'alerte et chaque paramètre de stockage
  se trouve dans un unique fichier YAML intégré à l'image au moment du build — il
  n'existe ni convention de variable d'environnement par paramètre, ni API de
  rechargement de la configuration à l'exécution. Modifiez les points de terminaison
  surveillés en éditant `modules/Gatus_Common/scripts/config.yaml` puis en
  redéployant.
- **Deployment sans état par défaut, avec la SEULE option de durabilité
  véritablement sûre de ce catalogue.** `workload_type = "Deployment"` avec un
  stockage d'historique SQLite **éphémère** dans `/data/data.db`. Gatus code en dur
  le mode de journalisation WAL de SQLite (confirmé en conditions réelles : aucune
  option de configuration ne le désactive), et la documentation de SQLite elle-même
  indique que WAL n'est pas pris en charge sur les systèmes de fichiers réseau — NFS
  présente donc ici un risque réel de corruption. L'option `stateful_pvc_enabled = true`
  de GKE (un véritable périphérique bloc, et non gcsfuse) est la voie recommandée
  pour un historique durable : associez-la à
  `stateful_pvc_storage_class = "standard"` (HDD ; l'historique de Gatus n'a pas
  besoin des IOPS d'un SSD, et le HDD évite le quota régional serré `SSD_TOTAL_GB`).
- **Un seul réplica par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Plusieurs réplicas interrogeraient chacun indépendamment tous les points de
  terminaison et dupliqueraient les alertes — aucune coordination n'existe entre les
  instances Gatus.
- **Exposé via un Service LoadBalancer** (`service_type = "LoadBalancer"`) afin que
  la page de statut soit accessible depuis l'extérieur du cluster ;
  `reserve_static_ip` et `enable_custom_domain` sont tous deux `false` par défaut,
  car Gatus n'intègre aucune URL autoréférente dans sa configuration au démarrage —
  n'activez l'un ou l'autre que si vous avez besoin d'une adresse IP stable ou d'un
  nom d'hôte personnalisé.
- **Le point de terminaison de santé est `/health`**, qui renvoie HTTP 200 dès que
  le serveur se lie à son port.
- **Pour une exécution aux côtés de `Gatus_CloudRun` sur le même tenant**, définissez
  `tenant_id = "gke"` (et `"cr"` sur la variante Cloud Run) — voir la
  recommandation dans `config/deploy.tfvars`. Cela évite une collision de noms sur
  les noms de secrets partagés, les noms de buckets GCS et les sujets de rotation.
- **Le contrôle d'accès, le cas échéant, se configure dans `config.yaml`.** Gatus
  est livré avec une page de statut ouverte par défaut ; une protection facultative
  par basic-auth ou OIDC se configure dans le bloc `security` de `config.yaml` et
  nécessite un nouveau build.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont indiqués dans les [Outputs](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Gatus {#a-gke-autopilot--the-gatus-workload}

Les pods Gatus sont planifiés sur Autopilot, qui facture le CPU et la mémoire
réellement demandés par les pods. Par défaut, la charge de travail est un
`Deployment` sans état avec un seul réplica ; passer à un `StatefulSet` provisionne
un PVC en mode bloc par pod pour un historique durable des vérifications.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de
  travail Gatus pour consulter les pods et les événements. Kubernetes Engine →
  Services et Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle
et du type de charge de travail (Deployment ou StatefulSet).

### B. Persistance — le stockage d'historique SQLite {#b-persistence--the-sqlite-history-store}

Gatus ne possède **aucune instance Cloud SQL**. Son stockage d'historique facultatif
est un fichier SQLite local situé dans `/data/data.db`, dont l'arborescence est
intégrée à l'image. Avec le Deployment sans état par défaut, ce répertoire est
**éphémère** — l'historique ne survit pas à un redémarrage du pod.

- **PVC en mode bloc StatefulSet (recommandé pour un historique durable) :**
  `stateful_pvc_enabled = true` avec `stateful_pvc_mount_path = "/data"` et
  `stateful_pvc_storage_class = "standard"` — un véritable périphérique bloc par pod
  héberge la base de données d'historique. C'est la seule option de persistance de ce
  catalogue dont la sûreté a été vérifiée pour le fichier SQLite en mode WAL de
  Gatus.
- **NFS (Filestore) — à utiliser avec prudence :** `enable_nfs = true` monte le
  volume sur `/data`, mais présente le risque lié à WAL sur un système de fichiers
  réseau décrit à la §1.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Stockage →
  PersistentVolumeClaims (PVC en mode bloc).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                             # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /data           # history store location
  ```

Consultez [App_GKE](App_GKE.md) pour les modèles NFS et PVC StatefulSet.

### C. Secret Manager {#c-secret-manager}

Gatus ne génère **aucun** secret au moment du déploiement — il n'y a ni mot de passe
de base de données ni clé de chiffrement à gérer. Secret Manager n'est utilisé que si
vous fournissez vos propres secrets via `secret_environment_variables` (par exemple
une `${VAR}` référencée dans la configuration des alertes de `config.yaml`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la
rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP Cloud Load Balancing
externe, au moyen d'un Service LoadBalancer. Un domaine personnalisé avec un
certificat géré par Google et une adresse IP statique réservée peuvent tous deux
être activés si nécessaire, mais aucun n'est requis pour un fonctionnement correct,
car la configuration de Gatus n'intègre aucune URL autoréférente.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails de l'adresse IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques
de GKE sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles. Gatus journalise le résultat de chaque
vérification de point de terminaison (réussite/échec, durée) au fil de son
exécution.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Gatus {#3-gatus-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** Gatus n'a ni
  base de données externe ni étape de migration. Il lit `config.yaml`, initialise
  son stockage d'historique SQLite (s'il est configuré) et commence immédiatement à
  servir. Aucun job d'initialisation n'existe par défaut.
- **La persistance dépend du type de charge de travail.** Un `Deployment` sans état
  utilise un stockage d'historique éphémère ; un `StatefulSet` avec un PVC en mode
  bloc le rend durable d'un redémarrage de pod à l'autre.
- **`imagePullPolicy = Always` pour l'image personnalisée.** App_GKE définit ce
  paramètre pour les images construites sur mesure ou mises en miroir, afin qu'une
  reconstruction suivie d'un redéploiement sous un tag inchangé récupère les
  nouvelles couches au lieu de servir un cache de nœud obsolète.
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/health`, qui
  renvoie HTTP 200 dès que le serveur se lie au port 8080. Vérifiez depuis
  l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s -o /dev/null -w '%{http_code}\n' http://<service-name>.$NAMESPACE.svc.cluster.local/health
  ```
- **Consulter la page de statut** (via l'adresse IP externe) :
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -s "http://$EXTERNAL_IP/" | head -20
  ```
- **Les modifications de configuration nécessitent un nouveau build.** Gatus n'a ni
  interface d'administration ni API pour modifier les points de terminaison
  surveillés. Éditez `modules/Gatus_Common/scripts/config.yaml` (ajoutez, supprimez
  ou modifiez des entrées `endpoints`) et redéployez pour appliquer les
  modifications.
- **L'accès est ouvert tant que vous ne le configurez pas.** Par défaut, la page de
  statut n'a aucune authentification. Configurez basic-auth ou OIDC dans le bloc
  `security` de `config.yaml` et redéployez pour restreindre la consultation.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Gatus ou notables pour celui-ci sont
listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur
comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(required)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; définissez `"gke"` pour coexister avec un déploiement `Gatus_CloudRun` sur le même tenant (voir `config/deploy.tfvars`). |
| `application_name` | `gatus` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base épinglée `v5.36.0`. Épinglez une version `v5.x.y` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` déploie directement une image. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (GKE ne permet pas la mise à l'échelle à zéro). |
| `max_instance_count` | `1` | **Conservez 1** — des réplicas interrogeraient chacun indépendamment tous les points de terminaison et dupliqueraient les alertes. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `8080` | Gatus écoute sur le port 8080. |
| `container_protocol` | `http1` | HTTP/1.1 par défaut. |
| `workload_type` | `Deployment` | Valeur par défaut sans état ; `StatefulSet` pour un PVC durable par pod. |
| `enable_cloudsql_volume` | `false` | Désactivé — Gatus n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Gatus dans Artifact Registry. |

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exige une connexion Google. **Bloque la consultation non authentifiée.** Nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Substitutions pour les références de type `${VAR}` dans `config.yaml`, et non des surcharges par paramètre. |
| `secret_environment_variables` | `{}` | Map variable d'environnement → nom du secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Gatus est une page de statut publique ; la valeur par défaut est donc `LoadBalancer`. |
| `session_affinity` | `None` | Définissez `ClientIP` si vous augmentez le nombre de réplicas et souhaitez qu'un client reste sur le même pod. |

### Groupe 7 — StatefulSet (historique durable des vérifications) {#group-7--statefulset-durable-check-history}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC en mode bloc par pod — la seule option durable dont la sûreté a été vérifiée pour l'historique SQLite en mode WAL de Gatus. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/data` | Chemin de montage ; correspond au répertoire `storage.path` intégré dans `config.yaml`. |
| `stateful_pvc_storage_class` | `standard` | HDD par défaut — le stockage d'historique de Gatus n'a pas besoin des IOPS d'un SSD ; évite le quota serré `SSD_TOTAL_GB`. |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/health` | Sonde de démarrage. Gatus devient sain en quelques secondes. |
| `health_check_config` | HTTP `/health` | Sonde d'activité. |
| `uptime_check_config` | disabled | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Montage facultatif pour un historique durable. **Attention :** présente un risque lié à WAL sur un système de fichiers réseau — préférez `stateful_pvc_enabled`. |
| `nfs_mount_path` | `/data` | Chemin de montage NFS ; correspond au `storage.path` intégré de Gatus. |
| `storage_buckets` | `[]` | Non requis — Gatus n'utilise aucun stockage d'objets. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Gatus n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `gatus` | Inertes sauf si une base de données externe est délibérément activée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — Gatus ne dépend pas de Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `false` | Provisionne un Ingress pour un nom d'hôte personnalisé et un certificat géré. Désactivé par défaut — le Service `LoadBalancer` assure déjà l'accessibilité externe. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `false` | Désactivé par défaut — Gatus n'intègre aucune URL autoréférente ; aucune raison fonctionnelle ne justifie donc de réserver une adresse IP stable. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Outputs {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | Adresse IP externe du LoadBalancer. |
| `service_url` | URL permettant d'accéder à Gatus. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de la base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs du point de terminaison de la base de données — inutilisés avec `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des éventuels jobs de configuration et d'importation (aucun par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. Le fichier `validation.tf` propre à la variante GKE applique ces gardes. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` (pour un historique durable) | Préférez plutôt `stateful_pvc_enabled` | Critical | Gatus code en dur le mode de journalisation WAL de SQLite, que la documentation de SQLite elle-même indique comme non pris en charge sur les systèmes de fichiers réseau — un historique sur NFS risque une corruption silencieuse au fil du temps. |
| `stateful_pvc_mount_path` | `/data` | High | Monter le PVC ailleurs que dans le répertoire `storage.path` intégré de Gatus rend persistant le mauvais chemin, et l'historique reste éphémère. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Medium | La classe par défaut adossée au SSD (`standard-rwo`) consomme le quota régional serré `SSD_TOTAL_GB` pour une charge de travail qui n'a pas besoin des IOPS d'un SSD. |
| `max_instance_count` | `1` | High | Au-delà de 1, chaque réplica interroge indépendamment tous les points de terminaison, ce qui duplique les notifications d'alerte sans aucune coordination entre les instances. |
| `enable_cloudsql_volume` | `false` | High | Le définir sur `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à joindre — rejeté par la garde au moment du plan. |
| `enable_iap` | uniquement si l'accès doit être authentifié | High | IAP exige une connexion Google pour chaque requête, ce qui bloque la consultation non authentifiée de la page de statut. |
| `min_instance_count` | `1` | High | GKE exige un minimum d'au moins 1 ; la garde de validation rejette les valeurs invalides, et 0 ne laisserait aucun pod pour servir la page de statut. |
| Bloc `security` de Gatus dans `config.yaml` | À configurer si la page contient des noms de points de terminaison sensibles | Medium | Laissée par défaut, la page de statut (y compris les noms de tous les points de terminaison configurés et leur historique de disponibilité) est visible publiquement par toute personne disposant de l'adresse IP externe. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critical | Les entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Medium | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `application_version` | Épinglez `v5.x.y` en production | Low | `latest` correspond à une base épinglée (`v5.36.0`) ; épinglez explicitement pour maîtriser les mises à niveau. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Gatus, partagée
avec la variante Cloud Run, est décrite dans **[Gatus_Common](Gatus_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Gatus sur GKE Autopilot](../labs/Gatus_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Gatus sur Google Cloud Run](Gatus_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Gatus Common — Configuration applicative partagée](Gatus_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md) dans la solution **Zero-trust Network & DNS**.
