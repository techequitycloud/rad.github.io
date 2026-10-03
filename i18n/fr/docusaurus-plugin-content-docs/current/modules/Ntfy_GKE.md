---
title: "Ntfy sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Ntfy sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Ntfy_GKE.md @ 15fd4c7 sha256:44524c735003 -->

# Ntfy sur GKE Autopilot {#ntfy-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Ntfy_GKE.png" alt="Ntfy sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

ntfy est un serveur de notifications push pub/sub open-source, sous licence Apache 2.0,
écrit en Go. Les applications publient des messages via une API REST/HTTP simple et les clients les reçoivent
instantanément via des flux WebSocket ou Server-Sent-Events (SSE) — aucune base de données externe
n'est requise. Ce module déploie ntfy sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par ntfy et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et le cycle de vie du déploiement —
référez-vous au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

ntfy s'exécute comme une seule charge de travail web Go. Le déploiement relie un ensemble
délibérément restreint de services Google Cloud — ntfy n'a pas de dépendance
propre à une base de données, un cache ou un stockage d'objets :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Déploiement Go unique, 1 vCPU / 512 Mio par défaut |
| Base de données | **Aucune** | `database_type = "NONE"` ; le cache de messages est un fichier SQLite local, aucun Cloud SQL n'est provisionné |
| Persistance | Disque éphémère (par défaut), NFS ou PVC de bloc (StatefulSet) | Cache SQLite à `/var/cache/ntfy/cache.db` ; NFS ou PVC pour un historique durable |
| Stockage d'objets | **Aucun** | ntfy ne stocke rien dans Cloud Storage |
| Cache / file d'attente | **Aucun** | Pas de Redis ; ntfy utilise un bus de messages in-process |
| Secrets | Secret Manager | Pas de secrets auto-générés ; seulement ceux fournis par l'utilisateur `secret_environment_variables` |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Aucune base de données n'est provisionnée.** `database_type = "NONE"` — ntfy conserve son cache de messages
  dans un fichier SQLite local. Les variables liées à la base de données existent pour
  être complètes mais sont inertes à moins que vous n'optiez délibérément pour une base de données externe.
- **Déploiement sans état par défaut.** `workload_type = "Deployment"` avec un
  cache SQLite **éphémère** à `/var/cache/ntfy/cache.db`. L'historique des messages est perdu
  lorsqu'un pod redémarre. Pour la durabilité, activez NFS (`enable_nfs = true`) ou
  passez à un **PVC de bloc StatefulSet** (`stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"`).
- **Réplica unique par défaut** (`min_instance_count = 1`, `max_instance_count = 1`).
  Le flux d'un abonné est ancré au pod qui le détient et il n'y a pas de bus de messages partagé,
  donc la mise à l'échelle n'est pas la valeur par défaut. Gardez le maximum à 1 à moins que vous ne placiez un
  cache/courtier partagé derrière ntfy.
- **Exposé via un service LoadBalancer** (`service_type = "LoadBalancer"`,
  `reserve_static_ip = true`, `enable_custom_domain = true`), afin que les éditeurs et
  les abonnés puissent l'atteindre depuis l'extérieur du cluster.
- **Le point de terminaison de santé est `/v1/health`**, qui renvoie `{"healthy":true}` avec HTTP
  200 dès que le serveur lie son port.
- **La variante GKE s'exécute sur son propre espace de noms de locataire.** `Ntfy_GKE` ajoute `-gke` à
  `tenant_id`, afin qu'il puisse s'exécuter aux côtés de `Ntfy_CloudRun` sur le même locataire
  sans collision de noms.
- **Le contrôle d'accès est une étape post-déploiement.** ntfy est livré avec un accès ouvert ; configurez
  les utilisateurs et les ACL de sujets par la suite via son CLI ou les variables d'environnement `NTFY_AUTH_*`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail ntfy {#a-gke-autopilot--the-ntfy-workload}

Les pods ntfy sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Par défaut, la charge de travail est un `Deployment` sans état avec un seul
réplica ; le passage à un `StatefulSet` provisionne un PVC de bloc par pod pour un historique
de messages durable.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail ntfy pour voir les pods
  et les événements. Kubernetes Engine → Services et Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl get statefulset -n "$NAMESPACE"          # when stateful_pvc_enabled = true
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Déploiement vs StatefulSet).

### B. Persistance — le cache de messages SQLite {#b-persistence--the-sqlite-message-cache}

ntfy n'a **pas d'instance Cloud SQL**. Son cache de messages est un fichier SQLite local à
`NTFY_CACHE_FILE` (`/var/cache/ntfy/cache.db`), créé par le point d'entrée au démarrage.
Avec le déploiement sans état par défaut, le cache est **éphémère** — l'historique des messages
ne survit pas à un redémarrage de pod. Deux façons de le rendre durable :

- **NFS (Filestore) :** `enable_nfs = true`, et pointez le répertoire du cache vers le
  montage.
- **PVC de bloc StatefulSet :** `stateful_pvc_enabled = true` avec
  `stateful_pvc_mount_path = "/var/cache/ntfy"` — un disque persistant par pod contient la
  base de données du cache.

- **Console :** Filestore → Instances (NFS) ; Kubernetes Engine → Stockage →
  PersistentVolumeClaims (PVC de bloc).
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"                                   # StatefulSet PVCs
  kubectl exec -n "$NAMESPACE" <pod> -- ls -l /var/cache/ntfy       # cache location
  ```

Voir [App_GKE](App_GKE.md) pour les modèles NFS et StatefulSet PVC.

### C. Secret Manager {#c-secret-manager}

ntfy ne génère **aucun** secret au moment du déploiement — il n'y a pas de mot de passe de base de données ou
de clé de chiffrement à gérer. Secret Manager est utilisé uniquement si vous fournissez le vôtre via
`secret_environment_variables` (par exemple une valeur `NTFY_AUTH_*` ou une
crential de push en amont).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### D. Réseau et ingress {#d-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing via un
service LoadBalancer. Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une adresse IP statique est réservée par défaut afin que l'adresse survive aux redéploiements.
Si les clients utilisent le streaming HTTP/2, définissez `container_protocol = "h2c"`.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont acheminées vers Cloud Logging ; les métriques GKE sont acheminées vers Cloud Monitoring.
Des vérifications de disponibilité et des politiques d'alerte optionnelles sont disponibles. ntfy enregistre son
adresse d'écoute et le chemin du cache résolu au démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Ntfy {#3-ntfy-application-behaviour}

- **Pas de configuration de base de données au premier déploiement.** ntfy n'a pas de base de données externe et pas d'étape de migration.
  Le point d'entrée prépare le répertoire du cache SQLite et exécute immédiatement
  `ntfy serve`. Il n'y a pas de job `db-init` par défaut.
- **La persistance dépend du type de charge de travail.** Un `Deployment` sans état utilise un
  cache éphémère ; un `StatefulSet` avec un PVC de bloc (ou un montage NFS) rend l'historique des messages
  durable après les redémarrages de pod.
- **`imagePullPolicy = Always` pour l'image personnalisée.** App_GKE définit cela pour
  les images personnalisées/miroirs afin qu'une reconstruction et un redéploiement sous une balise inchangée tirent
  les nouvelles couches plutôt que de servir un cache de nœud obsolète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/v1/health`, qui renvoie
  `{"healthy":true}` et HTTP 200 dès que le serveur lie le port 80. Vérifiez depuis
  l'intérieur du cluster :
  ```bash
  kubectl run curl --rm -it --image=curlimages/curl -n "$NAMESPACE" -- \
    curl -s http://<service-name>.$NAMESPACE.svc.cluster.local/v1/health   # {"healthy":true}
  ```
- **Test de fumée de publication/abonnement** (contre l'IP externe) :
  ```bash
  EXTERNAL_IP=$(kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
  curl -d "hello from ntfy" "http://$EXTERNAL_IP/mytopic"    # publish
  ```
- **L'accès est ouvert jusqu'à ce que vous le verrouilliez.** Par défaut, tout client peut publier et
  s'abonner à n'importe quel sujet. Configurez les utilisateurs et les ACL par sujet après le déploiement via le
  CLI de ntfy (`ntfy user add`, `ntfy access`) ou les variables d'environnement `NTFY_AUTH_*`.
- **URL de base publique pour les pièces jointes / web push.** Si vous utilisez des pièces jointes ou le web-push du navigateur,
  définissez `NTFY_BASE_URL` (via `environment_variables`) sur l'URL externe afin que les liens générés
  se résolvent correctement.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour ntfy sont listés ; toute autre entrée est héritée
de [App_GKE](App_GKE.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour la charge de travail et les ressources régionales. |

### Groupe 2 / 3 — Environnement de déploiement et identité de l'application {#group-2--3--deployment-environment--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court ; `Ntfy_GKE` ajoute `-gke` en interne afin qu'il puisse coexister avec la variante Cloud Run. |
| `application_name` | `ntfy` | Nom de base pour les ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de version de l'image ; `latest` correspond à une base `v2.11.0` épinglée. Épinglez `v2.x.y` en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | `custom` construit l'image wrapper via Cloud Build ; `prebuilt` déploie une image directement. |
| `min_instance_count` | `1` | Réplicas minimum (GKE n'a pas de mise à l'échelle à zéro). |
| `max_instance_count` | `1` | **Gardez à 1** — les flux sont locaux au pod sans courtier partagé. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="512Mi" }` | CPU/mémoire par pod. |
| `container_port` | `80` | ntfy écoute sur le port 80. |
| `container_protocol` | `http1` | Définissez `h2c` pour le streaming HTTP/2 de bout en bout. |
| `workload_type` | `Deployment` | Par défaut sans état ; `StatefulSet` pour un PVC par pod durable. |
| `enable_cloudsql_volume` | `false` | Désactivé — ntfy n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Miroir de l'image ntfy dans Artifact Registry. |

### Groupe 5 — Identity-Aware Proxy (IAP) {#group-5--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la publication/abonnement non authentifié.** Nécessite `iap_oauth_client_id` / `_secret`. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `NTFY_*` supplémentaires (par exemple `NTFY_BASE_URL`, `NTFY_AUTH_DEFAULT_ACCESS`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (facultatif ; aucun requis). |

### Groupe 6 — Cluster GKE {#group-6--gke-cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `gke_cluster_name` | `""` | Laissez vide pour découvrir automatiquement le cluster Services_GCP. |
| `service_type` | `LoadBalancer` | Comment le service est exposé. |
| `session_affinity` | `None` | Définissez `ClientIP` pour épingler le flux d'un client à un pod si vous mettez à l'échelle les réplicas. |

### Groupe 7 — StatefulSet (historique de messages durable) {#group-7--statefulset-durable-message-history}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `null` | Définissez `true` pour un PVC de bloc par pod — cache de messages durable après les redémarrages. |
| `stateful_pvc_size` | `10Gi` | Taille de stockage PVC par pod. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Chemin de montage ; correspond au répertoire de `NTFY_CACHE_FILE`. |
| `stateful_pvc_storage_class` | `standard-rwo` | StorageClass pour le PVC. |

### Groupe 9 — Politiques de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protéger la disponibilité pendant les mises à niveau de nœuds. |
| `pdb_min_available` | `1` | Nombre minimum de pods disponibles pendant les perturbations volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/v1/health` | Sonde de démarrage. ntfy devient sain en quelques secondes. |
| `health_check_config` | HTTP `/v1/health` | Sonde de vivacité. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring facultative. |

### Groupe 13 / 14 — Système de fichiers et Cloud Storage {#group-13--14--filesystem--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Activer pour sauvegarder le cache SQLite avec NFS pour un historique durable (alternative à un PVC). |
| `nfs_mount_path` | `/var/cache/ntfy` | Chemin de montage NFS. |
| `storage_buckets` | `[]` | Non requis — ntfy n'utilise pas de stockage d'objets. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | ntfy n'a pas de base de données externe ; laissez `NONE`. |
| `application_database_name` / `application_database_user` | `ntfy` | Inerte à moins qu'une base de données externe ne soit délibérément activée. |

### Groupe 15 — Cache Redis {#group-15--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Non requis — ntfy n'a pas de dépendance Redis. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionner Ingress pour les noms d'hôtes personnalisés + certificat géré. |
| `application_domains` | `[]` | Noms d'hôtes à servir. |
| `reserve_static_ip` | `true` | IP externe stable après les redéploiements. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre ntfy. |
| `database_instance_name` / `database_name` / `database_user` | Identifiants de base de données — vides pour le moteur `NONE` par défaut. |
| `database_password_secret` / `database_host` / `database_port` | Champs de point de terminaison de base de données — inutilisés pour `NONE`. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'importation (aucun par défaut). |
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

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identifiants OAuth, `enable_cloudsql_volume = true` avec `database_type = "NONE"`, `min_instance_count > max_instance_count`, `quota_memory_*` sans unités binaires. La propre `validation.tf` de la variante GKE applique ces protections. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` / `enable_nfs` (pour l'historique durable) | Activez-en un lorsque l'historique est important | Élevé | Avec le déploiement sans état par défaut et le cache éphémère, tout l'historique des messages est perdu à chaque redémarrage de pod. |
| `stateful_pvc_mount_path` | `/var/cache/ntfy` | Élevé | Monter le PVC ailleurs que dans le répertoire `NTFY_CACHE_FILE` persiste le mauvais chemin et le cache reste éphémère. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 divise les abonnés entre les pods sans bus partagé, de sorte qu'un message publié sur un pod n'est pas livré aux abonnés sur un autre. |
| `enable_cloudsql_volume` | `false` | Élevé | Définir `true` avec `database_type = "NONE"` démarre un sidecar Auth Proxy sans instance à atteindre — rejeté par la protection au moment de la planification. |
| `session_affinity` | `ClientIP` si vous mettez à l'échelle | Élevé | Sans persistance, un abonné qui se reconnecte atterrit sur un pod différent et manque les messages mis en cache par le pod d'origine. |
| `enable_iap` | uniquement lorsque l'authentification est activée | Élevé | IAP nécessite une connexion Google pour chaque requête, bloquant la publication/abonnement non authentifié. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la protection de validation rejette les valeurs invalides, et 0 ne laisserait aucun pod pour contenir les flux. |
| `NTFY_BASE_URL` | URL externe réelle | Moyen | Non défini, les liens de pièces jointes et de web-push se résolvent vers le mauvais hôte. |
| Contrôle d'accès ntfy | Configurer après le déploiement | Moyen | Par défaut, tout client peut publier et s'abonner à n'importe quel sujet sur une IP publique. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `application_version` | Épinglez `v2.x.y` en production | Faible | `latest` correspond à une base épinglée (`v2.11.0`) ; épinglez explicitement pour contrôler les mises à niveau. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à ntfy partagée avec la variante Cloud Run est
décrite dans **[Ntfy_Common](Ntfy_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Ntfy sur GKE Autopilot](../labs/Ntfy_GKE.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Ntfy sur Google Cloud Run](Ntfy_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Ntfy Common — Configuration d'application partagée](Ntfy_Common.md) — la configuration partagée par les deux cibles de déploiement.
