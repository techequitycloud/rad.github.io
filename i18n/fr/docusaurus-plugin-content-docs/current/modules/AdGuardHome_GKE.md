---
title: "AdGuard Home sur GKE Autopilot"
description: "Référence de configuration pour déployer AdGuard Home sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/AdGuardHome_GKE.md @ 3055034 sha256:a6afaf39c6ef -->

# AdGuard Home sur GKE Autopilot {#adguard-home-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AdGuardHome_GKE.png" alt="AdGuard Home sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **CRITIQUE — à lire avant de déployer.** La valeur essentielle d'AdGuard Home
> est le blocage DNS des publicités et des traqueurs à l'échelle du réseau, ce qui
> exige que les clients l'interrogent en DNS sur le port 53 (TCP+UDP). **Ce module
> utilise le modèle Gateway HTTP(S) standard de GKE, qui ne peut pas exposer le
> port 53 brut.** (Un `Service
> type=LoadBalancer` L4 brut secondaire pour le port 53 est possible en principe
> sur GKE — contrairement à Cloud Run, qui ne le permet dans aucune configuration
> — mais il est explicitement **hors périmètre** pour cette première version du
> module.) Ce module déploie **uniquement la console d'administration web**
> d'AdGuard Home (port 3000), pour la gestion de la configuration des listes de
> filtres, des règles personnalisées et des paramètres clients. **L'instance
> déployée n'est PAS accessible en tant que résolveur DNS public.** Consultez
> [§6 Pièges de configuration](#6-configuration-pitfalls--sensible-defaults) pour
> l'explication complète.

AdGuard Home est un serveur DNS open source sous licence GPL-3.0, à l'échelle du
réseau, qui bloque les publicités et les traqueurs au niveau DNS et intègre un
contrôle parental. Il s'agit d'un binaire Go statique sans base de données
externe — toute la configuration réside dans un fichier YAML plat écrit par son
propre assistant de configuration au premier lancement. Ce module déploie la
console d'administration web d'AdGuard Home sur **GKE Autopilot**, au-dessus du
socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure
Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise AdGuard Home et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls et cycle de vie du déploiement —
reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

AdGuard Home s'exécute comme un pod unique de binaire Go statique sur GKE
Autopilot. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod unique de binaire Go, 1 vCPU / 512 MiB par défaut, type de charge de travail `Deployment` |
| Base de données | Aucune | AdGuard Home n'a pas de base de données externe — la configuration est un fichier YAML plat |
| Stockage d'objets | Cloud Storage (×2, GCS Fuse CSI) | Bucket `conf` (configuration) et bucket `work` (journal des requêtes/statistiques), tous deux montés comme volumes de système de fichiers |
| Secrets | Secret Manager | Aucun généré — l'identifiant administrateur est défini via l'assistant web du premier lancement d'AdGuard Home |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe par défaut ; domaine personnalisé + certificat géré en option (pour la console web — voir la note CRITIQUE ci-dessus) |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ce déploiement est une console de gestion de configuration, pas un résolveur
  DNS.** Le modèle Gateway HTTP(S) standard de GKE utilisé ici ne peut pas
  exposer de DNS brut (port 53 TCP/UDP). Ne pointez pas de vrais clients DNS
  vers l'IP ou le nom d'hôte de ce déploiement.
- **Aucune base de données externe.** `database_type = "NONE"` et ne doit pas être
  modifié.
- **Deux volumes GCS Fuse sont précâblés et provisionnés automatiquement** —
  `conf` sur `/opt/adguardhome/conf` et `work` sur `/opt/adguardhome/work` —
  afin que la configuration et le journal des requêtes/statistiques persistent
  lors des redémarrages de pod. Vous n'avez pas besoin de définir `gcs_volumes`
  vous-même, et aucun StatefulSet ni PVC bloc n'est nécessaire
  (`workload_type = "Deployment"`).
- **`container_port = 3000`** — l'assistant de configuration d'AdGuard Home est
  codé en dur pour écouter sur le port 3000 tant que `AdGuardHome.yaml` n'existe
  pas. Si vous modifiez le port de l'interface web elle-même dans l'assistant de
  configuration, conservez 3000, sinon la sonde de santé de la plateforme et
  l'URL publique ne correspondront plus au port sur lequel le pod écoute
  réellement.
- **`service_type = "LoadBalancer"` par défaut.** La console d'administration est
  une interface utilisateur ; elle est donc exposée publiquement comme toute
  autre application web de ce catalogue — contrairement à un outil
  d'administration de base de données réservé à un usage interne.
- **Aucun identifiant administrateur pré-créé.** C'est dans l'assistant de
  configuration du premier lancement d'AdGuard Home, servi à l'URL du
  déploiement, que vous définissez le nom d'utilisateur et le mot de passe
  administrateur — la plateforme n'injecte rien.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la console d'administration web d'AdGuard Home {#a-gke-autopilot--the-adguard-home-web-admin-console}

AdGuard Home s'exécute comme un `Deployment` à réplica unique sur Autopilot.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail AdGuard Home pour voir les pods, les révisions et les événements.
  Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment sont gérés Autopilot, la
mise à l'échelle et le type de charge de travail (Deployment ou StatefulSet).

### B. Cloud Storage (GCS Fuse) — configuration et journal des requêtes/statistiques {#b-cloud-storage-gcs-fuse--config-and-query-logstats}

AdGuard Home stocke toute sa configuration dans un fichier YAML plat
(`AdGuardHome.yaml`) et sa base de journal des requêtes / statistiques dans un
répertoire distinct. Tous deux reposent sur des buckets Cloud Storage dédiés
montés via le pilote GCS Fuse CSI — `conf` et `work` — provisionnés
automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
  gcloud storage ls gs://<conf-bucket>/           # bucket names are in the Outputs
  gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml   # inspect the live config
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les détails des
montages GCS Fuse CSI.

### C. Réseau et entrée {#c-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing
externe. **Il s'agit uniquement de l'URL de la console d'administration web — ce
n'est pas une adresse de serveur DNS.** Un domaine personnalisé avec un
certificat géré par Google peut être activé, et une IP statique peut être
réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les
détails sur les IP statiques.

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE
sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

Le point d'entrée affiche à chaque démarrage une bannière rappelant le périmètre
DNS — visible dans les premières lignes du journal d'un nouveau pod.

---

## 3. Comportement de l'application AdGuard Home {#3-adguard-home-application-behaviour}

- **Aucun amorçage de base de données.** AdGuard Home n'a pas de base de données
  externe ; il n'y a donc pas d'`initialization_jobs` par défaut — la liste est
  disponible uniquement pour des jobs personnalisés fournis par l'opérateur.
- **Assistant de configuration du premier lancement.** Lors de la première
  visite de l'IP externe (avant que `AdGuardHome.yaml` n'existe), AdGuard Home
  sert son propre assistant de configuration sur le port 3000 : choisissez le
  port de l'interface web d'administration (conservez 3000), définissez le nom
  d'utilisateur et le mot de passe administrateur, et sélectionnez les serveurs
  DNS en amont. Rien n'est pré-configuré par la plateforme.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — il
  n'existe pas de point de terminaison de santé dédié ; la racine renvoie `200`
  avant comme après la configuration initiale.
- **La résolution DNS n'est pas accessible.** L'écouteur DNS interne du pod peut
  démarrer, mais rien en dehors du pod/du Service ne peut atteindre le port 53
  via la Gateway HTTP(S) standard de GKE. Seule la console d'administration web
  est accessible.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à AdGuard Home ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `adguardhome` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de suivi du déploiement. Correspond à l'ARG de build spécifique à l'application `ADGUARDHOME_VERSION` dans le Dockerfile (et non à l'`APP_VERSION` générique). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. |
| `container_port` | `3000` | Le port fixe de l'assistant de configuration. **Pas le port DNS 53.** |
| `container_resources` | `{cpu_limit="1000m", memory_limit="512Mi"}` | Limites de ressources du pod. |
| `enable_cloudsql_volume` | `false` | Non utilisé — pas de base de données. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposé publiquement par défaut — une interface utilisateur, pas un outil de base de données réservé à un usage interne. |
| `workload_type` | `Deployment` | Aucun StatefulSet nécessaire ; la persistance passe par GCS Fuse. |

### Groupe 10 — IAP et VPC-SC {#group-10--iap--vpc-sc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Activation recommandée — place l'authentification par identité Google devant la console de politique de filtrage DNS. |

### Groupe 11 — Domaine personnalisé et réseau {#group-11--custom-domain--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `enable_custom_domain` | (valeur par défaut du socle) | Provisionne un Ingress pour des noms d'hôte personnalisés + certificat géré. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets `conf`/`work` toujours provisionnés, ainsi que ceux de `storage_buckets`. |
| `gcs_volumes` | `[]` | Laissez vide pour utiliser les montages `conf`/`work` propres au module. |

### Groupe 16 — Configuration de la base de données {#group-16--database-configuration}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — ne doit pas être modifié. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `health_check_config` | HTTP `/` | Pas de point de terminaison de santé dédié ; la racine renvoie 200 avant et après la configuration. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut — AdGuard Home n'a besoin d'aucun amorçage de base de données. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |

### Groupe 7 — StatefulSet {#group-7--statefulset}

Non utilisé par défaut — la persistance passe par des volumes GCS Fuse, et non
par un PVC bloc. `stateful_pvc_enabled` vaut `null` par défaut (désactivé).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour accéder à la console d'administration d'AdGuard Home (**pas** une adresse de résolveur DNS). |
| `storage_buckets` | Buckets Cloud Storage créés (`conf`, `work`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa
> configuration par le moteur du socle [App_GKE](App_GKE.md), qui valide
> les valeurs et leurs combinaisons au moment du plan. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant toute
> création de ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à une vraie résolution DNS de la part de ce déploiement | Ne pas compter dessus | **Critique** | Le modèle Gateway HTTP(S) standard de GKE utilisé par ce module ne peut pas exposer le port 53 TCP/UDP brut — les clients qui utilisent l'IP/le nom d'hôte de ce déploiement pour le DNS n'obtiendront aucune réponse. Un `Service type=LoadBalancer` L4 brut secondaire pour le port 53 est possible en principe sur GKE (contrairement à Cloud Run), mais il est explicitement hors périmètre pour cette première version du module. |
| `container_port` modifié sans modifier aussi le port de l'interface web de l'assistant de configuration | Conserver les deux à `3000` | Critique | Le port d'exécution de l'interface web d'AdGuard Home provient de `AdGuardHome.yaml` (défini pendant la configuration) — s'il diverge de `container_port`, la sonde de santé de la plateforme et l'URL publique ne correspondent plus au port sur lequel le pod écoute réellement, et le pod ne devient jamais Ready après le premier redémarrage. |
| `database_type` | `NONE` (ne pas modifier) | Critique | AdGuard Home n'a aucune intégration de base de données ; y définir un vrai moteur n'a aucun effet, mais traduit une mauvaise compréhension du module. |
| `gcs_volumes` | Laisser vide (valeur par défaut du module) | Critique | Le remplacer sans monter aussi `conf`/`work` fait perdre la configuration et l'historique des requêtes d'AdGuard Home à chaque redémarrage de pod. |
| Console d'administration laissée sans IAP | Activer `enable_iap` | Élevé | La console d'administration contrôle la politique de filtrage DNS ; une console ouverte et non authentifiée permet à toute personne disposant de l'IP du LoadBalancer de reconfigurer le filtrage ou de lire les journaux des requêtes. |
| `workload_type` changé en `StatefulSet` | Conserver `Deployment` (valeur par défaut du module) | Moyen | Inutile — la persistance passe par GCS Fuse, pas par un PVC bloc ; un StatefulSet ajoute de la complexité sans aucun bénéfice ici. |
| `memory_limit` inférieur à `512Mi` | Conserver `512Mi` | Moyen | Une mémoire sous-dimensionnée expose à des arrêts OOM avec le bin-packing d'Autopilot. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et
Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP,
Binary Authorization, VPC-SC et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à AdGuard Home,
partagée avec la variante Cloud Run, est décrite dans
**[AdGuardHome_Common](AdGuardHome_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AdGuardHome sur GKE Autopilot](../labs/AdGuardHome_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [AdGuard Home sur Google Cloud Run](AdGuardHome_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [AdGuardHome Common — Configuration applicative partagée](AdGuardHome_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Headscale sur GKE Autopilot](Headscale_GKE.md), [TechnitiumDNS sur GKE Autopilot](TechnitiumDNS_GKE.md) et [Gatus sur GKE Autopilot](Gatus_GKE.md) dans la solution **Zero-trust Network & DNS**.
