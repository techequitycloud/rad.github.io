---
title: "DokuWiki sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de DokuWiki sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/DokuWiki_CloudRun.md @ 15fd4c7 sha256:93f0f324bfc4 -->

# DokuWiki sur Google Cloud Run {#dokuwiki-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_CloudRun.png" alt="DokuWiki sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki est un **wiki léger, conforme aux standards et basé sur des fichiers plats** (sans base de données) qui stocke tout son contenu — pages, médias, plugins, utilisateurs et configuration — sous forme de fichiers sur disque. Ce module déploie DokuWiki sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par DokuWiki et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

DokuWiki s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement relie un ensemble délibérément restreint de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 8080, 1 vCPU / 512 Mio par défaut ; mise à l'échelle à zéro prise en charge |
| Base de données | **Aucune** | DokuWiki est un wiki à fichiers plats — `database_type = "NONE"`, aucune instance Cloud SQL n'est provisionnée |
| Stockage persistant | Cloud Storage (gcsfuse) | Un bucket `gcs-dokuwiki<tenant-prefix>-data` monté à `/storage` contient *tout* l'état du wiki |
| Cache et file d'attente | **Aucun** | Pas de Redis ; DokuWiki n'a pas de modèle de file d'attente/travailleur |
| Secrets | **Aucun** | Pas de secrets d'exécution — le compte administrateur est créé via `/install.php` |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** DokuWiki stocke tout dans le répertoire de fichiers plats `/storage`. `database_type` est fixé à `"NONE"` ; une validation au moment de la planification rejette toute autre valeur (cela provisionnerait une instance Cloud SQL inutilisée et entraînerait des coûts).
- **Tout l'état réside dans un seul bucket Cloud Storage.** `/storage` est un montage **gcsfuse** du bucket `gcs-dokuwiki<tenant-prefix>-data` auto-provisionné. La suppression ou le changement de destination de ce bucket entraîne la perte de l'intégralité du wiki. `force_destroy` est activé, donc une destruction de module le supprime.
- **Mise en garde sur la persistance avec gcsfuse.** DokuWiki s'appuie sur le verrouillage de fichiers pour les éditions concurrentes ; gcsfuse est un stockage d'objets à cohérence éventuelle, pas un système de fichiers POSIX. Cela convient pour un wiki à faible concurrence, mais les éditions simultanées intensives sont mieux servies par la [variante GKE](DokuWiki_GKE.md), qui utilise un PVC de bloc.
- **La mise à l'échelle à zéro est toujours effective** (`min_instance_count` est codé en dur à `0` dans `dokuwiki.tf`, quelle que soit la valeur de la variable). Les démarrages à froid ajoutent quelques secondes à la première requête après l'inactivité. `max_instance_count` est par défaut à `1` et doit y rester : la sécurité d'édition de DokuWiki dépend des fichiers `.lock`, que le bucket GCS FUSE partagé ne peut pas honorer, donc une deuxième instance concurrencerait les écritures de pages. Mettez plutôt à l'échelle verticalement.
- **Facturation basée sur les requêtes par défaut** (`cpu_always_allocated = false`). DokuWiki est un wiki purement requête/réponse sans travail de fond en cours, donc le CPU n'est facturé que pendant le traitement d'une requête.
- **Pas de secrets d'exécution.** `secret_environment_variables` est vide par conception ; le compte administrateur est créé interactivement lors de la première visite via `/install.php`.
- **Ingress public par défaut** (`ingress_settings = "all"`) afin que le wiki soit accessible à son URL `run.app`. Activez IAP pour exiger une connexion Google devant celui-ci.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service DokuWiki {#a-cloud-run--the-dokuwiki-service}

DokuWiki s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre les nombres minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dokuwiki"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Base de données — non utilisée {#b-database--not-used}

DokuWiki **n'utilise pas** de base de données. `database_type = "NONE"`, aucune instance Cloud SQL n'est créée, et aucun job `db-init` ne s'exécute. La garde au moment de la planification dans le module rejette toute valeur `database_type` non-`NONE`. Si vous cherchez où réside le contenu du wiki, il s'agit du bucket Cloud Storage dans la section C, et non d'une base de données.

### C. Cloud Storage — le volume de données `/storage` {#c-cloud-storage--the-storage-data-volume}

Un seul bucket **Cloud Storage** (`gcs-dokuwiki<tenant-prefix>-data`) est provisionné automatiquement et monté à `/storage` à l'intérieur du conteneur via **gcsfuse**. Ce bucket contient *tout* l'état de DokuWiki : pages, médias, plugins, utilisateurs, ACL et configuration.

- **Console :** Cloud Storage → Buckets → le bucket `gcs-dokuwiki<tenant-prefix>-data`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dokuwiki"
  gcloud storage ls gs://<data-bucket>/                 # bucket name is in the Outputs
  gcloud storage ls -r gs://<data-bucket>/data/pages/   # browse wiki page files
  ```

Les options de montage gcsfuse (`implicit-dirs`, TTL de cache stat/type de 60s) sont définies par `DokuWiki_Common`. Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis — non utilisée {#d-redis--not-used}

DokuWiki n'a pas de modèle de file d'attente ou de travailleur et n'utilise pas Redis. `enable_redis` est désactivé par défaut et il n'y a aucune raison de l'activer.

### E. Secret Manager — pas de secrets d'application {#e-secret-manager--no-application-secrets}

DokuWiki n'injecte **aucun** secret d'exécution. Le compte administrateur est créé via l'installateur de première exécution (`/install.php`) et persisté dans `/storage`, il n'y a donc pas de clé générée de type `AP_*` à récupérer. `secret_environment_variables` reste vide par conception. (La fondation peut toujours créer des secrets au niveau de l'infrastructure ; voir [App_CloudRun](App_CloudRun.md).)

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut être superposé ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs (journaux d'accès/erreurs Apache) sont envoyés à Cloud Logging ; les métriques Cloud Run sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application DokuWiki {#3-dokuwiki-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Il n'y a pas de schéma à créer et pas de job `db-init`. `initialization_jobs` est vide. Le premier démarrage initialise simplement le volume `/storage` avec le wiki par défaut (géré par le point d'entrée de l'image amont) s'il est vide.
- **Configuration initiale via `/install.php`.** Lors de la première visite, ouvrez `https://<service-url>/install.php` pour créer le compte administrateur, définir le titre du wiki et choisir la politique ACL. Ceci est écrit dans `/storage`. **Supprimez ou bloquez `install.php` après** — toute personne y accédant avant que vous n'ayez terminé la configuration peut revendiquer le compte administrateur.
- **Tout l'état est sur `/storage`.** La perte ou le changement de destination du bucket `gcs-dokuwiki<tenant-prefix>-data` entraîne la perte du wiki. Comme le bucket est `force_destroy = true`, une destruction de module le supprime — sauvegardez le bucket avant de le supprimer si vous devez conserver le contenu.
- **Pas de migrations automatiques.** La mise à niveau de `application_version` fournit un moteur DokuWiki plus récent qui lit le même répertoire de données `/storage` ; il n'y a pas d'étape de migration.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité ciblent toutes `/` — DokuWiki y sert sa page de démarrage sans authentification, donc la sonde passe dès qu'Apache est opérationnel. Le premier démarrage se termine en quelques secondes (pas de migrations de base de données).
- **Concurrence.** DokuWiki utilise des verrous de fichiers pour les éditions concurrentes. Sur gcsfuse, la cohérence est éventuelle, donc maintenez un nombre d'instances modeste et évitez les éditions simultanées intensives ; utilisez la [variante GKE](DokuWiki_GKE.md) (PVC de bloc) pour une concurrence d'écriture plus élevée.
- **Inspectez les montages et l'environnement de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='yaml(spec.template.spec.containers[0].volumeMounts, spec.template.spec.volumes)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour DokuWiki sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DokuWiki ; `latest` se résout en une version datée épinglée (`2024-02-06b`) au moment de la construction. Épinglez une version spécifique pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Gen2 avec CPU toujours actif nécessite ≥ 1 vCPU ; DokuWiki est léger. |
| `memory_limit` | `512Mi` | Mémoire par instance ; DokuWiki nécessite ≥ 256 Mio, 512 Mio recommandés. |
| `min_instance_count` | `0` | Codé en dur à `0` dans `dokuwiki.tf` quelle que soit la valeur de cette variable — DokuWiki s'adapte toujours à zéro. |
| `max_instance_count` | `1` | Plafond de coût. Restez modeste — les rédacteurs concurrents sur plusieurs instances se disputent les fichiers gcsfuse partagés. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes — DokuWiki n'effectue aucun travail de fond en cours. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages de volumes gcsfuse. |
| `container_port` | `8080` | Apache écoute sur le port 8080. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — laisser à false. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image DokuWiki dans Artifact Registry. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` expose le wiki publiquement à son URL `run.app`. |
| `enable_iap` | `false` | Exiger une connexion Google devant DokuWiki. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `gcs-dokuwiki<tenant-prefix>-data` supportant `/storage`. |
| `gcs_volumes` | _(valeur par défaut définie par Common)_ | Le montage gcsfuse `/storage`. Laissez tel quel sauf si vous fournissez un volume personnalisé. |
| `enable_nfs` | `false` | DokuWiki est sans état au niveau du conteneur ; NFS n'est pas requis. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde au moment de la planification rejette toute autre valeur. |

_Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md)._

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `storage_buckets` | Buckets Cloud Storage créés (inclut `gcs-dokuwiki<tenant-prefix>-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide — DokuWiki n'en a pas). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages GCS Fuse, un `backup_retention_days` hors limites, et (spécifique au module) un `database_type` non-`NONE`. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket `gcs-dokuwiki<tenant-prefix>-data` | Ne jamais supprimer/redéfinir après le premier déploiement | Critique | Le bucket *est* le wiki — le supprimer ou le redéfinir entraîne la perte de toutes les pages, médias et utilisateurs. `force_destroy = true` signifie qu'une destruction de module le supprime ; sauvegardez-le d'abord. |
| `database_type` | `NONE` | Critique | Toute autre valeur échoue la garde au moment de la planification ; si elle est contournée, elle provisionne une instance Cloud SQL inutilisée et entraîne des coûts. |
| `install.php` après la configuration | Supprimer / bloquer une fois l'administrateur créé | Élevé | Toute personne qui atteint `/install.php` avant que vous n'ayez terminé la configuration peut revendiquer le compte administrateur. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter le volume gcsfuse `/storage` — le conteneur n'a nulle part où persister les données du wiki. |
| `max_instance_count` | Maintenir à `1` (la valeur par défaut) | Élevé | Chaque instance monte le même bucket GCS FUSE, qui ne peut pas fournir le verrouillage que les fichiers `.lock` de DokuWiki supposent — les instances concurrentes se disputent les écritures de pages. Mettez plutôt à l'échelle avec `cpu_limit` / `memory_limit`. |
| `ingress_settings` | `all` (ou IAP) | Élevé | Laissé public avec des inscriptions/ACL mal configurées, n'importe qui peut modifier ; verrouillez via les ACL dans le wiki et/ou IAP. |
| `memory_limit` | `512Mi` | Moyen | En dessous de 256 Mio, le processus PHP/Apache peut manquer de mémoire sous charge. |
| `min_instance_count` | N/A — codé en dur à `0` | Faible | `dokuwiki.tf` force toujours `min_instance_count = 0` ; la définition de cette variable à `1` n'a aucun effet. La mise à l'échelle à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après l'inactivité. |
| `application_version` | Épinglez une version datée | Faible | `latest` se résout en un tag épinglé au moment de la construction, mais l'épinglage explicite rend les mises à niveau délibérées. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à DokuWiki partagée avec la variante GKE est décrite dans **[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DokuWiki sur Cloud Run](../labs/DokuWiki_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [DokuWiki sur GKE Autopilot](DokuWiki_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [DokuWiki Common — Configuration d'application partagée](DokuWiki_Common.md) — la configuration partagée par les deux cibles de déploiement.
