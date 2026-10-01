---
title: "Headscale sur GKE Autopilot"
description: "Référence de configuration pour déployer Headscale sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Headscale_GKE.md @ 3055034 sha256:0ea76b2e4337 -->

# Headscale sur GKE Autopilot {#headscale-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Headscale_GKE.png" alt="Headscale sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Headscale est une implémentation open source et auto-hébergée du serveur de
coordination Tailscale — un plan de contrôle pour un VPN maillé privé WireGuard,
compatible avec les clients Tailscale officiels. Headscale n'est **pas** lui-même
une passerelle ni un relais VPN : il authentifie les nœuds, distribue la clé
publique et l'adresse IP attribuée de chaque pair, et maintient à jour la carte
réseau du maillage. Le trafic chiffré proprement dit entre les appareils circule
directement, de pair à pair, via WireGuard (ou via l'infrastructure publique de
relais DERP de Tailscale). Ce module déploie Headscale sur **GKE Autopilot**
au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Headscale et sur la manière
de les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application GKE — Workload Identity,
entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Headscale s'exécute comme un pod contenant un unique binaire Go sur GKE Autopilot,
construit à partir d'une image amont personnalisée basée sur `ko`. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot, StatefulSet | Charge de travail Go, 1 vCPU / 1 GiB par défaut ; épinglée de manière stricte à un seul réplica |
| Base de données | SQLite intégré | Aucune instance Cloud SQL — `database_type = "NONE"` |
| Persistance | **Véritable PVC de stockage en mode bloc** (par défaut) | `stateful_pvc_enabled = true` par défaut — `/var/lib/headscale` sur disque HDD `pd-standard`, et non GCS Fuse |
| Secrets | Secret Manager | Aucun — Headscale n'a pas de secret applicatif dans ce module |
| Entrée | Cloud Load Balancing / Gateway API | IP statique externe + domaine personnalisé par défaut (`reserve_static_ip = true`, `enable_custom_domain = true`) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **SQLite est la seule base de données prise en charge.** Il n'existe aucune
  instance Cloud SQL externe ; tout l'état (registre des nœuds, clés de
  pré-authentification, clé privée du protocole Noise) réside dans un unique
  fichier SQLite sous `/var/lib/headscale`.
- **StatefulSet + véritable PVC en mode bloc est la disposition par défaut, et non
  une option à activer.** `stateful_pvc_enabled = true` par défaut exécute
  Headscale comme un StatefulSet avec un PVC par pod — c'est la variante de
  plateforme qui résout réellement le problème de SQLite et du verrouillage de
  fichiers que Cloud Run ne peut pas résoudre. `stateful_pvc_storage_class` vaut
  `standard` par défaut (HDD `pd-standard`, et non SSD), car les fichiers de
  Headscale sont petits et n'ont pas besoin d'un nombre élevé d'IOPS.
- **`max_instance_count` est codé en dur à `1` en aval, et non simplement défini
  par défaut.** `Headscale_Common` fixe `config.max_instance_count = 1` comme valeur
  littérale, quelle que soit la valeur de la variable de ce module. Headscale ne
  prend pas en charge le mode actif-actif.
- **La mise à zéro est activée par défaut** (`min_instance_count = 0`).
- **Un point d'entrée public et stable compte davantage ici que pour la plupart
  des applications.** `reserve_static_ip = true` et `enable_custom_domain = true`
  sont tous deux des valeurs par défaut — chaque appareil enregistré auprès de ce
  serveur a besoin d'une URL durable, et pas seulement d'une session de
  navigateur.
- **MagicDNS est désactivé par défaut.** Il exige que `dns.base_domain` soit
  défini et réellement différent du domaine de `server_url`.
- **Aucun job d'initialisation par défaut.** Le fichier SQLite de Headscale est
  créé automatiquement au premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#6-outputs) du déploiement.

### A. GKE Autopilot — le StatefulSet Headscale {#a-gke-autopilot--the-headscale-statefulset}

Headscale s'exécute par défaut comme un StatefulSet à réplica unique
(`workload_type` se résout automatiquement en `StatefulSet` lorsque
`stateful_pvc_enabled = true`). Comme `max_instance_count` est codé en dur à
`1`, il n'y a ici aucune mise à l'échelle horizontale à observer.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  Headscale pour consulter les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,pvc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour la manière dont Autopilot et le type de
charge de travail (Deployment ou StatefulSet) sont gérés.

### B. Volume persistant — le PVC de stockage SQLite {#b-persistent-volume--the-sqlite-storage-pvc}

Avec `stateful_pvc_enabled = true` (la valeur par défaut), un véritable PVC de
stockage en mode bloc est monté sur `/var/lib/headscale` ; il contient `db.sqlite`
(+ les fichiers annexes `-wal`/`-shm` en mode WAL), `noise_private.key` et
l'ancienne clé WireGuard. Cela offre au mode WAL de SQLite un véritable
verrouillage de fichiers POSIX — confirmé en conditions réelles comme totalement
exempt des erreurs d'écriture gcsfuse observées sur la variante Cloud Run.

- **Console :** Kubernetes Engine → Storage → Persistent Volume Claims.
- **CLI :**
  ```bash
  kubectl get pvc -n "$NAMESPACE"
  kubectl describe pvc -n "$NAMESPACE" <pvc-name>
  ```

Consultez [App_GKE](App_GKE.md) pour les mécanismes du PVC de StatefulSet et les
options de classe de stockage.

### C. Réseau et entrée {#c-networking--ingress}

Par défaut, la charge de travail obtient une IP externe statique réservée et un
Ingress Gateway API pour un nom d'hôte personnalisé — important ici, car chaque
appareil client Tailscale enregistré a besoin d'une URL durable pour joindre le
serveur de coordination.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get gateway,httproute,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les détails sur les domaines personnalisés,
Cloud CDN et l'IP statique.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging. Au démarrage,
un pod sain journalise la génération de la clé privée, « database opened
successfully » et « listening and serving HTTP ». Les métriques GKE sont envoyées
vers Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Headscale {#3-headscale-application-behaviour}

- **SQLite s'initialise automatiquement au démarrage.** Aucun job distinct de
  configuration de la base de données — au premier démarrage, Headscale crée
  `db.sqlite` sous `/var/lib/headscale` et applique automatiquement ses propres
  migrations de schéma internes.
- **Génération automatique de la clé privée.** Au premier démarrage, Headscale
  génère sa clé privée du protocole Noise dans `noise_private.key` si elle
  n'existe pas déjà. La perte de cette clé (ou du PVC) oblige chaque nœud client
  déjà enregistré à se réenregistrer.
- **Endpoint de santé.** `/health` est un véritable endpoint non authentifié —
  confirmé en conditions réelles, renvoyant HTTP 200 en même temps que
  « listening and serving HTTP » dans les journaux de l'application. Les sondes de
  démarrage et de vivacité le ciblent toutes deux par défaut.
- **La configuration initiale est une étape manuelle, après le déploiement —
  l'accès shell de GKE la rend simple.** Headscale n'est livré avec aucun
  parcours d'inscription web. Créez le premier utilisateur et une clé de
  pré-authentification en exécutant directement des commandes dans le pod en
  cours d'exécution :
  ```bash
  POD=$(kubectl get pods -n "$NAMESPACE" -l app=<service-name> -o jsonpath='{.items[0].metadata.name}')

  # Create the first user/namespace:
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale users create myuser

  # Issue a pre-auth key for that user (valid 1 hour, reusable):
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale preauthkeys create \
    --user myuser --reusable --expiration 1h
  ```
  Consultez le [lab pratique](../labs/Headscale_GKE.md) pour la procédure
  complète.
- **Connecter un vrai client Tailscale.** Une fois qu'une clé de
  pré-authentification existe :
  ```bash
  tailscale up --login-server=<server_url> --authkey=<preauthkey>
  ```
- **Inspecter les nœuds enregistrés :**
  ```bash
  kubectl exec -n "$NAMESPACE" "$POD" -- /ko-app/headscale nodes list
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à Headscale ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `headscale` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | `"latest"` se résout vers le build amont épinglé `HEADSCALE_VERSION=0.26.1`. |
| `server_url` | `""` | URL publique du plan de contrôle, intégrée à l'enregistrement de chaque client. Prend par défaut l'URL interne du cluster, ou l'IP statique réservée / le domaine personnalisé lorsqu'ils sont configurés. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `min_instance_count` | `0` | Mise à zéro. |
| `max_instance_count` | `1` | **Codé en dur à `1` en aval, quelle que soit cette valeur** — consultez les [pièges](#7-pitfalls--gotchas). |
| `cpu_limit` / `memory_limit` | `1000m` / `1Gi` | Limites de ressources par pod. |
| `container_port` | `8080` (déclarée, non transmise) | Fixé à 8080 via `Headscale_Common`, quelle que soit la valeur de cette variable. |

### Groupe 6 — Configuration du backend GKE {#group-6--gke-backend-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `workload_type` | `null` (se résout automatiquement en `StatefulSet`) | Parce que `stateful_pvc_enabled = true` par défaut. |
| `service_type` | `LoadBalancer` | L'accessibilité publique provient de la Gateway (`enable_custom_domain`), et non de ce type de Service — il ne s'agit pas du même bogue « devrait être LoadBalancer », répandu dans toute la flotte, observé ailleurs dans ce catalogue sur les applications accessibles par navigateur, puisque le véritable point d'entrée côté client est le chemin Gateway/IP statique. |

### Groupe 7 — StatefulSet {#group-7--statefulset}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | **`true`** | La valeur par défaut, et la raison pour laquelle cette variante de plateforme ne partage pas le risque SQLite/gcsfuse de Cloud Run — consultez les [pièges](#7-pitfalls--gotchas). |
| `stateful_pvc_mount_path` | `/var/lib/headscale` | Ne doit pas être modifié — c'est là que Headscale stocke sa base SQLite et ses clés. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Volontairement pas SSD — petits fichiers, aucun besoin d'IOPS élevées, et le HDD puise dans le quota `DISKS_TOTAL_GB`, bien plus large. |
| `stateful_pvc_size` | `20Gi` | Taille du PVC par pod. |

### Groupe 12 — Base de données (transmise par compatibilité) {#group-12--database-forwarded-for-compatibility}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixée par `Headscale_Common` — aucune instance Cloud SQL n'est jamais créée. |

### Groupe 19 — Domaine personnalisé et réseau {#group-19--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne l'Ingress Gateway API — le véritable point d'entrée public. |
| `reserve_static_ip` | `true` | Une URL de serveur stable compte pour chaque appareil client enregistré. |

### Groupe 20 — Identity-Aware Proxy {#group-20--identity-aware-proxy}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | **Ne l'activez jamais en usage normal** — IAP exige une identité Google, que la CLI `tailscale` ne peut pas présenter, ce qui bloque l'enregistrement des clients. |

### Groupe 22 — Observabilité et santé {#group-22--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health`, délai de 15s, seuil de 10 | Véritable endpoint Headscale non authentifié. |
| `liveness_probe` | HTTP `/health`, délai de 30s, seuil de 3 | Même endpoint. |

---

## 5. Référence d'exploration des services GCP {#5-gcp-service-exploration-reference}

Consultez le §2 ci-dessus — GKE Autopilot/StatefulSet, le volume persistant, le
réseau et la journalisation/supervision constituent l'ensemble complet des
services que ce module utilise directement (au-delà de l'infrastructure partagée
VPC/IAM/Artifact Registry commune à tout déploiement `App_GKE`).

---

## 6. Sorties {#6-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le
plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer / IP réservée. |
| `api_url` | URL permettant de joindre Headscale — c'est ce que `server_url` prévoit et ce auprès de quoi les clients s'enregistrent. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `storage` — inutilisé comme montage lorsque `stateful_pvc_enabled = true`, la valeur par défaut). |
| `statefulset_name` | Nom du StatefulSet (présent avec la valeur par défaut `workload_type = "StatefulSet"`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des éventuels jobs de configuration personnalisés (vide par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. Vaut false lors du premier apply d'un cluster intégré tout neuf — relancez l'apply pour terminer. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 7. Pièges et points d'attention {#7-pitfalls--gotchas}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs et leurs
> combinaisons au moment du plan — consultez [App_GKE](App_GKE.md) pour le
> comportement général de validation, ainsi que la section Validation Guards
> propre au module dans `modules/Headscale_GKE/README.md`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_enabled` | Conservez `true` (la valeur par défaut) | **Critique si remplacé par `false`** | C'est le paramètre qui offre à la base SQLite de Headscale un véritable verrouillage de fichiers POSIX. Le définir à `false` revient au même volume reposant sur GCS Fuse que `Headscale_CloudRun`, réintroduisant le risque d'erreurs d'écriture SQLite/gcsfuse confirmé en conditions réelles (`BufferedWriteHandler.OutOfOrderError`) que cette variante de plateforme existe précisément pour éviter. Ne le désactivez que si vous avez une raison indépendante solide. |
| `stateful_pvc_storage_class` | `standard` (HDD, la valeur par défaut) | Moyen (coût/quota) | Passer à `standard-rwo`/`premium-rwo` (SSD) puise dans le quota régional `SSD_TOTAL_GB`, bien plus restreint, sans réel bénéfice — les fichiers de Headscale sont petits et n'ont pas besoin d'IOPS élevées. |
| `max_instance_count` | Laissez `1` (elle est de toute façon codée en dur) | Élevé | La variable est déclarée mais jamais réellement lue par `Headscale_Common` — `config.max_instance_count` est un `1` littéral. La définir plus haut donne la fausse impression qu'une mise à l'échelle horizontale est possible. |
| `server_url` | Définissez-la une fois, avant d'enregistrer des clients | Critique | Intégrée à l'enregistrement de chaque client. La modifier après l'enregistrement des clients impose de réenregistrer chaque nœud. |
| `enable_iap` | `false` | Critique | IAP exige une identité Google pour chaque requête. La CLI `tailscale` ne peut pas en présenter, si bien qu'activer IAP bloque tout enregistrement de client et tout le trafic de synchronisation du maillage. |
| Suppression du PVC/StatefulSet | Ne supprimez jamais tant que des nœuds sont enregistrés | Critique | La clé privée du protocole Noise et l'intégralité du registre des nœuds se trouvent sur le PVC. Sa perte oblige chaque client à se réenregistrer de zéro. Rappel de la règle valable pour tout le catalogue : la mise à zéro ne libère **pas** le PVC — seule sa suppression le fait. |
| MagicDNS (`dns.magic_dns`) | Laissez `false` à moins de définir aussi un véritable `dns.base_domain` | Moyen | Activer MagicDNS sans `base_domain` valide et distinct du domaine de `server_url` entraîne une résolution DNS défaillante pour les clients. |
| `reserve_static_ip` / `enable_custom_domain` | Conservez `true` (les valeurs par défaut) | Moyen | Sans URL stable, une adresse éphémère ou de DNS interne peut changer lors d'un redéploiement, empêchant silencieusement chaque client enregistré de joindre le serveur de coordination. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et Workload
Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à Headscale,
partagée avec la variante Cloud Run, est décrite dans
**[Headscale_Common](Headscale_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Headscale sur GKE Autopilot](../labs/Headscale_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Headscale sur Google Cloud Run](Headscale_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Headscale Common — Configuration applicative partagée](Headscale_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md), [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md), [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Zero-trust Network & DNS**.
