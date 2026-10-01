---
title: "UrBackup sur GKE Autopilot"
description: "Référence de configuration pour déployer UrBackup sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/UrBackup_GKE.md @ 3055034 sha256:ffc58916d54c -->

# UrBackup sur GKE Autopilot {#urbackup-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/UrBackup_GKE.png" alt="UrBackup sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

UrBackup est un système open source de sauvegarde réseau client/serveur pour
Windows, Linux et macOS, qui prend en charge à la fois les sauvegardes au niveau
des fichiers et les images disque complètes, avec une déduplication côté client
(par liens physiques) et une interface web de gestion. Ce module déploie le
**serveur** UrBackup sur **GKE Autopilot** en s'appuyant sur le socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée. Les véritables agents **clients** UrBackup s'exécutent sur
les propres PC des utilisateurs — entièrement en dehors de ce projet GCP — et se
connectent à ce serveur selon leur propre planning de sauvegarde.

**Il n'existe pas de `UrBackup_CloudRun`, et il n'y en aura pas.** Le protocole
client d'UrBackup a besoin que trois ports TCP bruts (`55413` back-end FastCGI,
`55414` interface web directe, `55415` transfert client en mode internet) ainsi
que la diffusion UDP de découverte LAN (`35622`-`35623`) soient joignables
simultanément. L'entrée de Cloud Run (le GFE) n'accepte qu'un seul port HTTP(S)
et ne peut exposer ni du TCP brut multiport, ni aucun trafic UDP — consultez
[UrBackup_Common](UrBackup_Common.md) pour l'explication complète ; il s'agit de
la même catégorie architecturale de lacune que celle des autres modules
**Common + GKE uniquement** de ce catalogue (Kopia, RocketChat, Immich, Temporal,
Prowlarr, VictoriaMetrics, Plausible, LobeChat, Supabase, Woodpecker).

Ce guide se concentre sur les services cloud utilisés par UrBackup et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, entrée, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

> **Ce module n'a pas été déployé sur un projet GCP réel pendant le développement**
> (aucune application sur un cluster GKE), mais son image de conteneur
> personnalisée A BIEN été construite et exécutée localement avec `docker build` +
> `docker run` (un montage bind explicite sur `/var/urbackup`, simulant un
> volumeMount Kubernetes) — ce qui a confirmé que le serveur démarre réellement,
> initialise sa base de données et sert une véritable interface web
> (`HTTP 200`, intitulée *« UrBackup - Keeps your data safe »*). Validez le chemin
> de la sonde de santé et la gestion des permissions PUID/PGID sur un véritable
> cluster GKE avant de vous y fier en production.

---

## 1. Vue d'ensemble {#1-overview}

UrBackup s'exécute sous la forme d'un **pod unique**, adossé à une Persistent
Volume Claim de stockage en mode bloc GKE (et non à Cloud SQL — UrBackup n'a pas
de base de données externe) :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Un pod exécute le serveur UrBackup, 1 vCPU / 1Gi par défaut |
| Base de données | Aucune (SQLite intégré) | Le serveur initialise sa propre base de données au premier démarrage |
| Stockage persistant | Persistent Volume GKE (bloc, StorageClass HDD `standard`) | Contient À LA FOIS la base de données du serveur et toutes les données de sauvegarde des clients — voir §3 |
| Accès client | Un Service `LoadBalancer` multiport dédié, provisionné directement par ce module | Couvre 55413/55414/55415 tcp + 35622-35623 udp — au-delà de ce que la ressource Service propre à App_GKE peut exprimer |
| Secrets | Aucun | Le compte administrateur est créé via le propre assistant de configuration web d'UrBackup au premier lancement |
| Entrée (interface web uniquement) | Cloud Load Balancing (facultatif, via Gateway) | Le Service géré par le socle vaut `ClusterIP` par défaut — voir §6 |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Les données persistantes résident sur un seul PVC en mode bloc, monté sur `/var/urbackup`, et non sur GCS.**
  L'image en amont attend deux volumes distincts (base de données `/var/urbackup`,
  données clients `/backups`) ; l'image personnalisée de ce module corrige le
  point d'entrée propre de l'image de base (au moment du build) pour rediriger
  plutôt les données de sauvegarde des clients vers un sous-répertoire `backups/`
  de `/var/urbackup`, afin que les deux soient conservés sur l'UNIQUE PVC que
  prend en charge le StatefulSet de ce module — vérifié localement : le point
  d'entrée corrigé démarre un serveur fonctionnel. `stateful_pvc_enabled = true`
  par défaut.
- **La classe de stockage est HDD (`standard`), et non SSD.** Les données de
  sauvegarde sont écrites séquentiellement et rarement lues ; le HDD puise dans
  le quota `DISKS_TOTAL_GB`, bien plus large, plutôt que dans le quota serré
  `SSD_TOTAL_GB`.
- **`stateful_pvc_size` exige une véritable planification de capacité.** La
  valeur par défaut de 200Gi est un point de départ pour un petit pilote —
  dimensionnez-la en fonction de votre parc de clients réel et de votre
  politique de rétention.
- **`min_instance_count` vaut 1 par défaut, sans mise à l'échelle à zéro.** Les
  vrais clients se connectent selon leur propre planning automatique, à des
  moments arbitraires ; un serveur mis à l'échelle à zéro manquerait
  silencieusement ces connexions. `max_instance_count` est plafonné à 1 — SQLite
  intégré et la déduplication par liens physiques ne prennent pas en charge les
  instances concurrentes.
- **Pas de secret d'initialisation administrateur.** La première visite de
  l'interface web dans un navigateur présente le propre assistant de
  configuration d'UrBackup pour créer le compte administrateur.
- **Un Service multiport dédié constitue le véritable point d'entrée externe**,
  et non le Service propre au socle (qui vaut `ClusterIP` par défaut) — voir §6.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définies. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail UrBackup {#a-gke-autopilot--the-urbackup-workload}

Un pod unique exécute le serveur UrBackup (un StatefulSet par défaut, puisque
`stateful_pvc_enabled = true` sélectionne automatiquement ce type de charge de travail).

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail
  UrBackup pour consulter le pod et les événements.
- **CLI :**
  ```bash
  kubectl get statefulset,pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" statefulset/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour le fonctionnement de la planification
Autopilot et de Workload Identity.

### B. Stockage persistant — le PVC en mode bloc {#b-persistent-storage--the-block-pvc}

```bash
kubectl get pvc -n "$NAMESPACE"
kubectl describe pvc -n "$NAMESPACE" <pvc-name>
```

Vérifiez que la StorageClass du PVC est HDD (`standard`) et que sa capacité
correspond à ce que vous avez configuré dans `stateful_pvc_size`. Il est monté
sur `/var/urbackup` et contient À LA FOIS la base de données du serveur
(directement) et toutes les données de sauvegarde des clients (redirigées vers
un sous-répertoire `backups/` par un correctif appliqué au moment du build au
point d'entrée de l'image de base — voir [UrBackup_Common](UrBackup_Common.md)).

### C. Le Service multiport dédié d'accès client {#c-the-dedicated-multi-port-client-access-service}

```bash
kubectl get svc -n "$NAMESPACE" -o wide
kubectl describe svc -n "$NAMESPACE" <service-name>-client-ports
```

Ce Service `LoadBalancer` (provisionné dans `urbackup.tf`, et non par la
ressource Service propre à App_GKE) expose les cinq ports dont ont besoin les
vrais clients UrBackup : `55413` (back-end FastCGI), `55414` (interface web),
`55415` (transfert client en mode internet, TCP) et `35622`-`35623` (découverte
LAN, UDP). Configurez les agents clients pour qu'ils se connectent à son IP
externe (sortie `urbackup_client_external_ip`).

### D. Réseau et entrée (interface web uniquement) {#d-networking--ingress-web-ui-only}

```bash
kubectl get svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

`service_type` sur le Service géré par le socle vaut `ClusterIP` par défaut — le
Service multiport dédié ci-dessus est le seul point d'entrée externe dont ont
besoin les vrais clients (il couvre aussi le port de l'interface web), ce Service
reste donc interne plutôt que de consommer une seconde IP externe. Il fonctionne
toujours comme back-end de la Gateway API si `enable_custom_domain` est défini
pour offrir un nom d'hôte convivial à l'interface web.

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques
GKE sont envoyées à Cloud Monitoring.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application UrBackup {#3-urbackup-application-behaviour}

- **Un correctif appliqué au moment du build redirige les données de sauvegarde vers l'unique PVC monté.**
  L'image en amont attend `/var/urbackup` (base de données SQLite du serveur) et
  `/backups` (données de sauvegarde des clients, liées par liens physiques pour
  la déduplication entre sauvegardes incrémentielles) comme volumes distincts.
  Comme un seul chemin de montage de PVC est disponible, le Dockerfile de ce
  module corrige avec `sed` le point d'entrée propre de l'image de base, afin
  qu'il écrive la destination des données de sauvegarde
  (`/var/urbackup/backupfolder`) sous la forme d'un sous-répertoire de
  `/var/urbackup` plutôt que du chemin distinct `/backups` — vérifié localement
  (voir la note en haut de ce guide) : le point d'entrée corrigé démarre un
  serveur fonctionnel.
- **Aucune migration de base de données ni job d'initialisation.** UrBackup
  initialise sa propre base de données SQLite au premier démarrage ; il n'existe
  aucune étape de schéma gérée par Terraform.
- **Aucun identifiant administrateur injecté par variable d'environnement.**
  L'interface web (port 55414) présente le propre assistant de configuration
  d'UrBackup lors de la première visite pour créer le compte administrateur
  (confirmé en conditions réelles lors des tests locaux).
- **Les sondes de santé sont de type TCP, et non HTTP.** Les tests locaux ont
  confirmé que le chemin `/` de l'interface web renvoie BIEN une véritable
  réponse `HTTP 200` sans authentification — mais comme cette confirmation
  provient d'un test Docker local plutôt que d'un déploiement GKE réel,
  `startup_probe` et `liveness_probe` utilisent par défaut une sonde TCP sur le
  port d'écoute, choix indépendant de la plateforme.
- **PUID/PGID/TZ contrôlent la propriété des fichiers.** Le point d'entrée propre
  de l'image de base attribue (chown) `/var/urbackup` (le PVC monté) à
  l'uid/gid configuré avant de démarrer `urbackupsrv`.
- **Écrivain unique, instance unique.** `max_instance_count` est plafonné à
  `1` — la base de données SQLite intégrée et la déduplication par liens
  physiques ne prennent pas en charge des instances de serveur concurrentes sur
  les mêmes données.
- **Le Service multiport personnalisé dépend du module socle.** Il utilise son
  propre bloc `provider "kubernetes" {}` (`provider-auth.tf`), car un module
  parent ne peut pas accéder à la configuration de provider interne propre à
  `App_GKE` — le même modèle déjà établi pour les ressources RBAC de
  `Woodpecker_GKE`. Son sélecteur de pods est calculé à partir de l'appel
  `module.deployment_id` propre à ce module (déterministe, garanti de
  correspondre à ce que le StatefulSet d'App_GKE applique à ses pods), et non
  deviné ni codé en dur.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à UrBackup ou notables
pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard. Consultez `modules/UrBackup_GKE/README.md` pour la référence exhaustive
des entrées, groupe par groupe.

### Groupes 1–2 — Projet et identité {#group-12--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `urbackup` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Se résout en interne en une version épinglée `2.5.x`. |
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | Limite de CPU du conteneur UrBackup. |
| `memory_limit` | `1Gi` | Limite de mémoire du conteneur UrBackup. |
| `min_instance_count` | `1` | SANS mise à l'échelle à zéro — voir §1. |
| `max_instance_count` | `1` | Plafonné en pratique. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `ClusterIP` | UNIQUEMENT pour le Service géré par le socle (port unique 55414) — voir §2D. |
| `workload_type` | `null` | Se résout automatiquement en `StatefulSet`, puisque `stateful_pvc_enabled = true`. |
| `namespace_name` | `""` (auto) | Généré automatiquement à partir de `application_name` + `tenant_id`. |

### Groupe 7 — StatefulSet / stockage persistant {#group-7--statefulset--persistent-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Obligatoire en pratique — voir §1/§3. |
| `stateful_pvc_size` | `200Gi` | **Planifiez la capacité en fonction de votre parc de clients réel + rétention.** |
| `stateful_pvc_mount_path` | `/var/urbackup` | Doit rester `/var/urbackup` — le répertoire de la base de données du serveur ; le correctif appliqué au moment du build de l'image personnalisée dépend de ce chemin exact pour rediriger également les données de sauvegarde. |
| `stateful_pvc_storage_class` | `standard` (HDD) | Les données de sauvegarde n'ont pas besoin des IOPS d'un SSD. |
| `stateful_fs_group` | `0` (non défini) | Le point d'entrée du conteneur, exécuté en root, gère déjà la propriété des fichiers. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | TCP, port 55414 | Voir §3 — pas de point de terminaison HTTP confirmé comme sûr. |
| `uptime_check_config` | désactivé | S'il est activé, nécessiterait un chemin accessible sur le Service du socle. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | UrBackup n'en a besoin d'aucun — pas de schéma à créer. |
| `cron_jobs` | `[]` | CronJobs Kubernetes. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage_volume` | `false` | Bucket facultatif servant d'échappatoire, et NON stockage principal d'UrBackup (qui est le PVC en mode bloc). |

### Groupes 16-17 — Base de données, sauvegarde et maintenance {#group-16-17--database-backup--maintenance}

Sans objet — UrBackup n'a pas de base de données SQL. Toutes les variables liées
à la base de données sont des copies inertes conservées par convention de
reprise des variables du socle.

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne une Gateway pour accéder à l'interface web via un nom d'hôte convivial (facultatif). |
| `reserve_static_ip` | `true` | Uniquement pour le chemin FACULTATIF Gateway/domaine personnalisé — pas pour le Service multiport exposé aux clients. |

### Groupe 23 — Accès réseau des clients de sauvegarde {#group-23--backup-client-network-access}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `urbackup_puid` / `urbackup_pgid` | `1000` / `1000` | Transmises au comportement chown PUID/PGID de l'image de base. |
| `urbackup_timezone` | `Etc/UTC` | Influe sur la planification et l'horodatage des sauvegardes. |
| `urbackup_static_ip_address` | `""` (éphémère) | IP statique pré-réservée que vous fournissez pour le Service multiport dédié — ce module n'en réserve pas automatiquement. |

### Groupes 8, 9, 12, 18, 20, 21, 22 {#groups-8-9-12-18-20-21-22}

Comportement standard d'`App_GKE` — Resource Quota, règles de fiabilité, CI/CD et
Binary Authorization, Custom SQL (sans objet), IAP, Redis (sans objet — UrBackup
n'utilise pas de cache) et Cloud Armor, VPC Service Controls. Consultez
[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

| Sortie | Description |
|---|---|
| `service_name` / `namespace` / `service_cluster_ip` / `service_external_ip` / `service_url` | Détails du Service géré par le socle (interne — `ClusterIP` par défaut). |
| `urbackup_client_service_name` | Nom du Service multiport dédié auquel se connectent les vrais clients. |
| `urbackup_client_external_ip` | IP externe du Service multiport dédié — configurez les clients pour qu'ils s'y connectent. |
| `urbackup_client_ports` | La table fixe des ports (55413/55414/55415 tcp, 35622-35623 udp). |
| `storage_buckets` | Le bucket GCS facultatif servant d'échappatoire (non monté par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster et la charge de travail sont prêts. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service
> dégradé) — **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs et leurs
> combinaisons au moment du plan. Le `validation.tf` propre à `UrBackup_GKE`
> rejette en outre `min_instance_count > max_instance_count` ainsi que
> `enable_iap = true` sans les deux identifiants OAuth.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `stateful_pvc_size` | Planifiez la capacité en fonction de votre parc de clients réel + politique de rétention | **Critical** | Un sous-dimensionnement fait échouer les sauvegardes des clients avec « disk full » dès que le PVC est plein — il s'agit d'une application à gros volume de données, et non d'une application à petite configuration ; la valeur par défaut de 200Gi n'est qu'un point de départ pour un petit pilote. |
| `stateful_pvc_mount_path` | Conservez `/var/urbackup` | **Critical** | Le correctif du point d'entrée appliqué au moment du build de l'image personnalisée redirige les données de sauvegarde vers un sous-répertoire de ce chemin exact ; le modifier sans modifier également le Dockerfile casse entièrement l'organisation base de données/données de sauvegarde. |
| `stateful_pvc_storage_class` | Conservez `standard` (HDD), sauf besoin spécifique d'IOPS élevées | **Medium** | Le SSD (`standard-rwo`/`premium-rwo`) puise dans le quota serré `SSD_TOTAL_GB` (500GB seulement sur certains projets contraints) — un PVC de grande capacité de sauvegarde sur SSD peut épuiser rapidement ce quota sans réel gain de performances (les écritures de sauvegarde sont séquentielles, et non limitées par les IOPS). |
| Connectivité des clients | Dirigez les agents clients vers `urbackup_client_external_ip`, jamais vers `service_url`/`service_external_ip` | **High** | Ces dernières sorties correspondent au Service du socle, interne uniquement (port de l'interface web seulement) ; les clients qui y sont dirigés ne peuvent pas mener à bien le véritable protocole de transfert des données de sauvegarde. |
| `min_instance_count` | Conservez `1` | **High** | Avec une mise à l'échelle à zéro, le serveur peut ne pas être en cours d'exécution lorsqu'arrive la tentative de sauvegarde automatique d'un client, planifiée à un moment arbitraire — des sauvegardes manquées en silence, et non une erreur visible. |
| `max_instance_count` | Conservez `1` | **Critical** | La base de données SQLite intégrée et la déduplication par liens physiques n'ont aucune coordination multi-instance ; des serveurs concurrents corrompraient l'état les uns des autres ou entreraient en concurrence. |
| Sondes de santé | Conservez TCP (valeur par défaut du module) | **Medium** | Il n'est pas confirmé qu'un chemin HTTP de l'interface web soit accessible sans authentification en toute sécurité pour cette image — une sonde HTTP incorrecte pourrait bloquer le déploiement progressif si l'hypothèse est fausse. |
| `urbackup_static_ip_address` | Laissez vide, sauf si vous avez pré-réservé une adresse | **Low** | Ce module ne provisionne pas automatiquement de réservation (pour éviter d'épuiser silencieusement un quota d'IP statiques rare, à l'échelle du projet) — définir ici une adresse que vous n'avez pas réellement réservée fait échouer l'application. |

---

Pour le comportement du socle évoqué tout au long de cette page — IAM et
Workload Identity, autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à UrBackup est
décrite dans **[UrBackup_Common](UrBackup_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : UrBackup sur GKE Autopilot](../labs/UrBackup_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [UrBackup Common — Configuration applicative partagée](UrBackup_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Kopia sur GKE Autopilot](Kopia_GKE.md), [Filebrowser sur GKE Autopilot](Filebrowser_GKE.md) dans la solution **Backup & Disaster Recovery**.
