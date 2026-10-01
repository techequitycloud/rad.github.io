---
title: "AdGuard Home sur Google Cloud Run"
description: "Référence de configuration pour déployer AdGuard Home sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/AdGuardHome_CloudRun.md @ 3055034 sha256:dbd1e063b28f -->

# AdGuard Home sur Google Cloud Run {#adguard-home-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/AdGuardHome_CloudRun.png" alt="AdGuard Home sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

> ⚠️ **CRITIQUE — à lire avant de déployer.** La valeur essentielle d'AdGuard Home
> est le blocage DNS des publicités et des traqueurs à l'échelle du réseau, ce qui
> exige que les clients l'interrogent en DNS sur le port 53 (TCP+UDP). **Cloud Run
> n'accepte qu'un ingress HTTP(S) et ne peut exposer le port 53 brut dans aucune
> configuration.** Ce module déploie **uniquement la console d'administration web**
> d'AdGuard Home (port 3000), pour la gestion de la configuration des listes de
> filtres, des règles personnalisées et des paramètres clients. **L'instance
> déployée n'est PAS accessible en tant que résolveur DNS public sur Cloud Run.** Si
> vous avez besoin qu'AdGuard Home résolve réellement les requêtes DNS de vrais
> clients, ce module (dans son périmètre actuel) ne peut pas le faire — consultez
> [§6 Pièges de configuration](#6-configuration-pitfalls--sensible-defaults)
> pour l'explication complète et le contournement (hors périmètre) que ce module
> n'implémente pas.

AdGuard Home est un serveur DNS open source sous licence GPL-3.0, à l'échelle du
réseau, qui bloque les publicités et les traqueurs au niveau DNS et intègre un
contrôle parental. Il s'agit d'un binaire Go statique sans base de données
externe — toute la configuration réside dans un fichier YAML plat écrit par son
propre assistant de configuration au premier lancement. Ce module déploie la
console d'administration web d'AdGuard Home sur **Cloud Run v2**, au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise AdGuard Home et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité du service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls
et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## 1. Vue d'ensemble {#1-overview}

AdGuard Home s'exécute comme un conteneur unique de binaire Go statique sur Cloud
Run v2. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go unique, 1 vCPU / 512 MiB par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro par défaut |
| Base de données | Aucune | AdGuard Home n'a pas de base de données externe — la configuration est un fichier YAML plat |
| Stockage d'objets | Cloud Storage (×2, GCS Fuse) | Bucket `conf` (configuration) et bucket `work` (journal des requêtes/statistiques), tous deux montés comme volumes de système de fichiers |
| Secrets | Secret Manager | Aucun généré — l'identifiant administrateur est défini via l'assistant web du premier lancement d'AdGuard Home |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut (console d'administration web **uniquement** — voir la note CRITIQUE ci-dessus) ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Ce déploiement est une console de gestion de configuration, pas un résolveur
  DNS.** Cloud Run ne peut pas exposer de DNS brut (port 53 TCP/UDP). Ne pointez
  pas de vrais clients DNS vers l'URL ou l'IP de ce déploiement.
- **Aucune base de données externe.** `database_type = "NONE"` et ne doit pas être
  modifié.
- **Deux volumes GCS Fuse sont précâblés et provisionnés automatiquement** —
  `conf` sur `/opt/adguardhome/conf` et `work` sur `/opt/adguardhome/work` —
  afin que la configuration et le journal des requêtes/statistiques persistent
  lors des redémarrages et des démarrages à froid. Vous n'avez pas besoin de
  définir `gcs_volumes` vous-même.
- **`container_port = 3000`** — l'assistant de configuration d'AdGuard Home est
  codé en dur pour écouter sur le port 3000 tant que `AdGuardHome.yaml` n'existe
  pas. Si vous modifiez le port de l'interface web elle-même dans l'assistant de
  configuration, conservez 3000, sinon la sonde de santé de la plateforme et
  l'URL publique ne correspondront plus au port sur lequel écoute le conteneur.
- **Mise à l'échelle jusqu'à zéro par défaut** (`cpu_always_allocated = false`,
  `min_instance_count = 0`). Dans cette forme de déploiement, il s'agit d'une
  simple console d'administration requête/réponse ; le coût au repos est donc
  minimal.
- **Aucun identifiant administrateur pré-créé.** C'est dans l'assistant de
  configuration du premier lancement d'AdGuard Home, servi à l'URL du
  déploiement, que vous définissez le nom d'utilisateur et le mot de passe
  administrateur — la plateforme n'injecte rien.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
du service et des ressources figurent dans les [sorties](#5-outputs) du
déploiement.

### A. Cloud Run — la console d'administration web d'AdGuard Home {#a-cloud-run--the-adguard-home-web-admin-console}

AdGuard Home s'exécute comme un service Cloud Run v2 qui s'adapte
automatiquement à la charge des requêtes entre les nombres minimal et maximal
d'instances.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud Storage (GCS Fuse) — configuration et journal des requêtes/statistiques {#b-cloud-storage-gcs-fuse--config-and-query-logstats}

AdGuard Home stocke toute sa configuration dans un fichier YAML plat
(`AdGuardHome.yaml`) et sa base de journal des requêtes / statistiques dans un
répertoire distinct. Tous deux reposent sur des buckets Cloud Storage dédiés
montés comme volumes de système de fichiers GCS Fuse — `conf` et `work` —
provisionnés automatiquement.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~adguardhome"
  gcloud storage ls gs://<conf-bucket>/          # bucket names are in the Outputs
  gcloud storage cat gs://<conf-bucket>/AdGuardHome.yaml   # inspect the live config
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour GCS Fuse et les options CMEK.

### C. Réseau et entrée {#c-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. **Il s'agit uniquement
de l'URL de la console d'administration web — ce n'est pas une adresse de
serveur DNS.** Un équilibreur de charge HTTPS externe avec domaine personnalisé,
Cloud CDN et Cloud Armor peut être ajouté devant la console d'administration.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### D. Cloud Logging et Monitoring {#d-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud
Run sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

Le point d'entrée affiche à chaque démarrage une bannière rappelant le périmètre
DNS — visible dans les premières lignes du journal d'une nouvelle révision.

---

## 3. Comportement de l'application AdGuard Home {#3-adguard-home-application-behaviour}

- **Aucun amorçage de base de données.** AdGuard Home n'a pas de base de données
  externe ; il n'y a donc pas d'`initialization_jobs` par défaut — la liste est
  disponible uniquement pour des jobs personnalisés fournis par l'opérateur.
- **Assistant de configuration du premier lancement.** Lors de la première
  visite de l'URL du service (avant que `AdGuardHome.yaml` n'existe), AdGuard
  Home sert son propre assistant de configuration sur le port 3000 : choisissez
  le port de l'interface web d'administration (conservez 3000), définissez le
  nom d'utilisateur et le mot de passe administrateur, et sélectionnez les
  serveurs DNS en amont. Rien n'est pré-configuré par la plateforme.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — il
  n'existe pas de point de terminaison de santé dédié ; la racine renvoie `200`
  avant comme après la configuration initiale.
- **La résolution DNS n'est pas accessible.** L'écouteur DNS interne du
  conteneur peut démarrer, mais rien en dehors de la révision ne peut atteindre
  le port 53 sur Cloud Run. Seule la console d'administration web (le port HTTP
  exposé du conteneur) est accessible.
- **Inspecter l'exécution des jobs** (si des jobs d'initialisation
  personnalisés ont été ajoutés) :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres propres à AdGuard Home ou
notables pour lui sont listés ; toutes les autres entrées sont héritées
d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `adguardhome` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `AdGuard Home` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Tag de suivi du déploiement. Correspond à l'ARG de build spécifique à l'application `ADGUARDHOME_VERSION` dans le Dockerfile (et non à l'`APP_VERSION` générique). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `512Mi` | Mémoire par instance. |
| `min_instance_count` | `0` | Mise à l'échelle jusqu'à zéro par défaut. |
| `max_instance_count` | `1` | Instance unique — AdGuard Home n'a pas de problème de coordination multi-instance pour sa propre console d'administration, mais ne dépassez pas 1 sans comprendre votre schéma d'écriture GCS Fuse. |
| `container_port` | `3000` | Le port fixe de l'assistant de configuration. **Pas le port DNS 53.** |
| `cpu_always_allocated` | `false` | Facturation à la requête — une simple console d'administration n'a besoin d'aucun CPU en arrière-plan. |
| `enable_cloudsql_volume` | `false` | Non utilisé — pas de base de données. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Public par défaut ; la console d'administration dispose de sa propre connexion. |
| `enable_iap` | `false` | Activation recommandée — place l'authentification par identité Google devant la console de politique de filtrage DNS. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Rarement nécessaire — AdGuard Home lit sa configuration dans son propre fichier YAML. |
| `secret_environment_variables` | `{}` | Aucun secret de plateforme n'existe pour cette application. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée les buckets `conf`/`work` toujours provisionnés, ainsi que ceux de `storage_buckets`. |
| `gcs_volumes` | `[]` | Laissez vide pour utiliser les montages `conf`/`work` propres au module. |
| `enable_nfs` | `false` | Non utilisé — la persistance passe par GCS Fuse. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — ne doit pas être modifié. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Aucun job par défaut — AdGuard Home n'a besoin d'aucun amorçage de base de données. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` / `liveness_probe` | HTTP `/` | Pas de point de terminaison de santé dédié ; la racine renvoie 200 avant et après la configuration. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif. |

### Groupe 16 — Cache Redis {#group-16--redis-cache}

Sans objet — AdGuard Home n'utilise pas Redis. `enable_redis` vaut `false` par défaut.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |

---

## 5. Sorties {#5-outputs}

Renvoyées lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut de la console d'administration web (**pas** une adresse de résolveur DNS). |
| `service_location` | Région dans laquelle s'exécute le service. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (`conf`, `work`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service
> dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa
> configuration par le moteur du socle [App_CloudRun](App_CloudRun.md),
> qui valide les valeurs et leurs combinaisons au moment du plan. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant toute création de ressource.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| S'attendre à une vraie résolution DNS de la part de ce déploiement | Ne pas compter dessus | **Critique** | Cloud Run ne peut exposer le port 53 TCP/UDP brut dans aucune configuration — les clients qui utilisent l'IP/le nom d'hôte de ce déploiement pour le DNS n'obtiendront aucune réponse. Le périmètre de ce module se limite à une console de gestion de configuration. |
| `container_port` modifié sans modifier aussi le port de l'interface web de l'assistant de configuration | Conserver les deux à `3000` | Critique | Le port d'exécution de l'interface web d'AdGuard Home provient de `AdGuardHome.yaml` (défini pendant la configuration) — s'il diverge de `container_port`, la sonde de santé de la plateforme et l'URL publique ne correspondent plus au port sur lequel le conteneur écoute réellement, et la révision ne devient jamais Ready après le premier redémarrage. |
| `database_type` | `NONE` (ne pas modifier) | Critique | AdGuard Home n'a aucune intégration de base de données ; y définir un vrai moteur n'a aucun effet, mais traduit une mauvaise compréhension du module. |
| `gcs_volumes` | Laisser vide (valeur par défaut du module) | Critique | Le remplacer sans monter aussi `conf`/`work` fait perdre la configuration et l'historique des requêtes d'AdGuard Home à chaque démarrage à froid / redémarrage. |
| Console d'administration laissée sans IAP / équivalent d'une inscription ouverte | Activer `enable_iap` ou restreindre `ingress_settings` | Élevé | La console d'administration contrôle la politique de filtrage DNS ; une console ouverte et non authentifiée permet à n'importe qui de reconfigurer le filtrage ou de lire les journaux des requêtes. |
| `min_instance_count = 0` (mise à l'échelle jusqu'à zéro) | Valeur par défaut acceptable | Faible | Les démarrages à froid ajoutent quelques secondes de latence à la première requête après une période d'inactivité — acceptable pour une console d'administration, contrairement à un résolveur DNS temps réel. |
| `memory_limit` inférieur à `512Mi` | Conserver `512Mi` (plancher gen2) | Moyen | L'environnement d'exécution gen2 de Cloud Run rejette d'emblée `memory_limit < 512Mi` au moment du plan. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité
du service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC et mise en miroir des images —
consultez **[App_CloudRun](App_CloudRun.md)**. La configuration applicative
propre à AdGuard Home, partagée avec la variante GKE, est décrite dans
**[AdGuardHome_Common](AdGuardHome_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : AdGuardHome sur Cloud Run](../labs/AdGuardHome_CloudRun.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [AdGuard Home sur GKE Autopilot](AdGuardHome_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [AdGuardHome Common — Configuration applicative partagée](AdGuardHome_Common.md) — la configuration partagée par les deux cibles de déploiement.
