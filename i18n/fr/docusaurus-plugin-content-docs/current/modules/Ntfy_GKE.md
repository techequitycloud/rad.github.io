---
title: "Ntfy sur GKE Autopilot"
description: "Référence de configuration pour déployer Ntfy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Ntfy_GKE.md @ 3055034 sha256:04877371b5c0 -->

# Ntfy sur GKE Autopilot {#ntfy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ntfy_GKE.png" alt="Ntfy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ntfy est un serveur open source de notifications push pub/sub sous licence Apache 2.0, écrit
en Go. Les applications publient des messages via une API REST/HTTP simple et les clients les reçoivent
instantanément via des flux WebSocket ou Server-Sent-Events (SSE) — aucune base de données
externe n'est requise. Ce module déploie ntfy sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par ntfy et sur la manière de les explorer et de
les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de
les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ntfy s'exécute sous forme d'une unique charge de travail web en Go. Le déploiement assemble un ensemble
volontairement restreint de services Google Cloud — ntfy ne dépend lui-même d'aucune base de données, d'aucun cache
ni d'aucun stockage d'objets :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Deployment Go unique, 1 vCPU / 512 MiB par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; le cache de messages est un fichier SQLite local, aucune instance Cloud SQL n'est provisionnée |
| Persistance | Disque éphémère (par défaut), NFS ou PVC en mode bloc (StatefulSet) | Cache SQLite dans `/var/cache/ntfy/cache.db` ; NFS ou PVC pour un historique durable |
| Stockage d'objets | **Aucun** | ntfy ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; ntfy utilise un bus de messages interne au processus |
| Secrets | Secret Manager | Aucun secret généré automatiquement ; uniquement les `secret_environment_variables` fournies par l'utilisateur |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut raisonnables à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — ntfy conserve son cache
  de messages dans un fichier SQLite local. Les variables liées à la base de données existent par
  souci d'exhaustivité mais restent inertes, sauf si vous optez délibérément pour une base de données externe.
- **Deployment sans état par défaut.** `workload_type = "Deployment"` avec un cache SQLite
  **éphémère** dans `/var/cache/ntfy/cache.db`. L'historique des messages est perdu
  au redémarrage d'un pod. Pour la durabilité, activez NFS (`enable_nfs = true`) ou
  passez à un **PVC en mode bloc de StatefulSet** (`stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"`).
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Le flux d'un abonné est ancré au pod qui le détient et il n'existe aucun bus de messages
  partagé ; le scale-out n'est donc pas le comportement par défaut. Conservez un maximum de 1, sauf si vous placez un
  cache/broker partagé derrière ntfy.
- **Exposé via un Service LoadBalancer** (`service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, `enable_custom_domain = true`), afin que les éditeurs et
  les abonnés puissent l'atteindre depuis l'extérieur du cluster.
- **Le point de terminaison de santé est `/v1/health`**, qui renvoie `{"healthy":true}` avec un HTTP
  200 dès que le serveur s'est lié à son port.
- **La variante GKE s'exécute dans son propre espace de noms de locataire.** `Ntfy_GKE` ajoute `-gke` à
  `tenant_id`, ce qui lui permet de s'exécuter à côté de `Ntfy_CloudRun` sur le même locataire
  sans collision de noms.
- **Le contrôle d'accès est une étape postérieure au déploiement.** ntfy est livré en accès ouvert ; configurez
  ensuite les utilisateurs et les ACL de sujets via sa CLI ou les variables d'environnement `NTFY_AUTH_*`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ntfy {#a-gke-autopilot--the-ntfy-workload}

Les pods ntfy sont planifiés sur Autopilot, qui facture la CPU/mémoire que les pods
demandent réellement. Par défaut, la charge de travail est un `Deployment` sans état avec un seul
réplica ; passer à un `StatefulSet` provisionne un PVC en mode bloc par pod pour un historique
des messages durable.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail ntfy pour voir les pods
  et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment ou StatefulSet).

### B. Persistance — le cache de messages SQLite {#b-persistence--the-sqlite-message-cache}

ntfy n'a **aucune instance Cloud SQL**. Son cache de messages est un fichier SQLite local situé à
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), créé par le point d'entrée au démarrage.
Avec le Deployment sans état par défaut, le cache est **éphémère** — l'historique des messages
ne survit pas au redémarrage d'un pod. Deux façons de le rendre durable :

- **NFS (Filestore) :** `enable_nfs = true`, et faites pointer le répertoire de cache vers le
  point de montage.
- **PVC en mode bloc de StatefulSet :** `stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"` — un disque persistant par pod héberge la
  base de données du cache.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Storage →
  PersistentVolumeClaims (PVC en mode bloc).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                   # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /var/cache/ntfy       # cache location
  ```

Consultez [App_GKE](App_GKE.md) pour les modèles NFS et PVC de StatefulSet.

### C. Secret Manager {#c-secret-manager}

ntfy ne génère **aucun** secret au moment du déploiement — il n'y a ni mot de passe de base de données ni
clé de chiffrement à gérer. Secret Manager n'est utilisé que si vous fournissez vos propres secrets via
`secret_environment_variables` (par exemple une valeur `NTFY_AUTH_*` ou un identifiant
de push en amont).

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration du Secret Store CSI et la rotation.

### D. Réseau et entrée {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe au moyen d'un
Service LoadBalancer. Un domaine personnalisé avec certificat géré par Google peut être
activé, et une IP statique est réservée par défaut afin que l'adresse survive aux redéploiements.
Si les clients utilisent le streaming HTTP/2, définissez `container_protocol = "h2c"`.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés, Cloud CDN et l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE vers Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles. ntfy journalise son adresse
d'écoute et le chemin de cache résolu au démarrage.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ntfy {#3-ntfy-application-behaviour}

- **Aucune configuration de base de données au premier déploiement.** ntfy n'a ni base de données externe ni
  étape de migration. Le point d'entrée prépare le répertoire du cache SQLite et lance immédiatement
  `ntfy serve` via exec. Il n'y a pas de tâche `db-init` par défaut.
- **La persistance dépend du type de charge de travail.** Un `Deployment` sans état utilise un
  cache éphémère ; un `StatefulSet` avec un PVC en mode bloc (ou un montage NFS) rend l'historique
  des messages durable entre les redémarrages de pods.
- **`imagePullPolicy = Always` pour l'image personnalisée.** App_GKE définit cette valeur pour les
  images construites sur mesure/dupliquées, afin qu'un rebuild suivi d'un redéploiement sous un tag inchangé tire
  les nouvelles couches au lieu de servir un cache de nœud obsolète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/v1/health`, qui renvoie
  `{"healthy":true}` et un HTTP 200 dès que le serveur s'est lié au port 80. Vérification depuis
  l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>.$NAMESPACE.svc.cluster.local/v1/health   # {"healthy":true}
  ```
- **Test rapide de publication / abonnement** (sur l'IP externe) :
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -d "hello from ntfy" "http://$EXTERNAL_IP/mytopic"    # publish
  ```
- **L'accès reste ouvert tant que vous ne le verrouillez pas.** Par défaut, n'importe quel client peut publier sur
  n'importe quel sujet et s'y abonner. Configurez les utilisateurs et les ACL par sujet après le déploiement via la
  CLI de ntfy (`ntfy user add`, `ntfy access`) ou les variables d'environnement `NTFY_AUTH_*`.
- **URL de base publique pour les pièces jointes / le web push.** Si vous utilisez les pièces jointes ou le web push
  du navigateur, définissez `NTFY_BASE_URL` (via `environment_variables`) sur l'URL externe afin que
  les liens générés soient résolus correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à ntfy ou notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe ; `Ntfy_GKE` ajoute `-gke` en interne afin de pouvoir coexister avec la variante Cloud Run. |
| `application_name` | `ntfy` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base épinglée `v2.11.0`. Épinglez `v2.x.y` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image d'encapsulation via Cloud Build ; `prebuilt` déploie directement une image. |
| `min_instance_count` | `1` | Nombre minimal de réplicas (GKE ne permet pas de descendre à zéro). |
| `max_instance_count` | `1` | **Conservez 1** — les flux sont locaux au pod, sans broker partagé. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `80` | ntfy écoute sur le port 80. |
| `container_protocol` | `http1` | Définissez `h2c` pour un streaming HTTP/2 de bout en bout. |
| `workload_type` | `Deployment` | Valeur par défaut sans état ; `StatefulSet` pour un PVC durable par pod. |
| `enable_cloudsql_volume` | `false` | Désactivé — ntfy n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Duplique l'image ntfy dans Artifact Registry. |

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Impose une connexion Google. **Bloque les publications/abonnements non authentifiés.** Nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `NTFY_*` supplémentaires (par ex. `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom de secret Secret Manager (facultatif ; aucun n'est requis). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `None` | Définissez `ClientIP` pour rattacher le flux d'un client à un pod si vous augmentez le nombre de réplicas. |

### Groupe 7 — StatefulSet (historique des messages durable) {#group-7--statefulset-durable-message-history}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC en mode bloc par pod — cache de messages durable entre les redémarrages. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage du PVC par pod. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Chemin de montage ; correspond au répertoire de `NTFY_CACHE_FILE`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass du PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods disponibles pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/v1/health` | Sonde de démarrage. ntfy devient sain en quelques secondes. |
| `health_check_config` | HTTP `/v1/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | À activer pour adosser le cache SQLite à NFS afin d'obtenir un historique durable (alternative à un PVC). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage NFS. |
| `storage_buckets` | `[]` | Non requis — ntfy n'utilise aucun stockage d'objets. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy n'a pas de base de données externe ; conservez `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inertes, sauf si une base de données externe est délibérément activée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — ntfy ne dépend pas de Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés et un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable entre les redéploiements. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ntfy. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de la base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs du point de terminaison de la base de données — inutilisés avec `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des éventuelles tâches de configuration et d'import (aucune par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation au moment du plan héritée.** Ce module fait transiter sa configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. Le `validation.tf` propre à la variante GKE applique ces garde-fous. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` / `enable_nfs` (pour un historique durable) | Activer l'un des deux lorsque l'historique compte | Élevé | Avec le Deployment sans état et le cache éphémère par défaut, tout l'historique des messages est perdu à chaque redémarrage de pod. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Élevé | Monter le PVC ailleurs que dans le répertoire de `NTFY_CACHE_FILE` rend persistant le mauvais chemin, et le cache reste éphémère. |
| `max_instance_count` | `1` | Élevé | Monter au-delà de 1 répartit les abonnés entre plusieurs pods sans bus partagé : un message publié sur un pod n'est pas distribué aux abonnés d'un autre. |
| `enable_cloudsql_volume` | `false` | Élevé | La valeur `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à atteindre — rejeté par le garde-fou au moment du plan. |
| `session_affinity` | `ClientIP` si vous augmentez le nombre de réplicas | Élevé | Sans affinité, un abonné qui se reconnecte atterrit sur un autre pod et manque les messages en cache détenus par le pod d'origine. |
| `enable_iap` | uniquement si un accès authentifié est voulu | Élevé | IAP impose une connexion Google pour chaque requête, bloquant les publications/abonnements non authentifiés. |
| `min_instance_count` | `1` | Élevé | GKE exige un minimum ≥ 1 ; le garde-fou de validation rejette les valeurs invalides, et 0 ne laisserait aucun pod pour détenir les flux. |
| `NTFY_BASE_URL` | URL externe réelle | Moyen | Si elle n'est pas définie, les liens des pièces jointes et du web push pointent vers le mauvais hôte. |
| Contrôle d'accès ntfy | À configurer après le déploiement | Moyen | Laissé par défaut, n'importe quel client peut publier sur n'importe quel sujet d'une IP publique et s'y abonner. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Des entiers nus sont interprétés en octets et bloquent toute planification de pods dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `application_version` | Épingler `v2.x.y` en production | Faible | `latest` correspond à une base épinglée (`v2.11.0`) ; épinglez explicitement pour maîtriser les mises à niveau. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et duplication d'images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à ntfy partagée avec la variante Cloud Run est
décrite dans **[Ntfy_Common](Ntfy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ntfy sur GKE Autopilot](../labs/Ntfy_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Ntfy Common — Configuration applicative partagée](Ntfy_Common.md) — la configuration partagée par les deux cibles de déploiement.
