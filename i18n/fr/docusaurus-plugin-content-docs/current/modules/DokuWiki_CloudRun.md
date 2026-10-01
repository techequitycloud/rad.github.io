---
title: "DokuWiki sur Google Cloud Run"
description: "Référence de configuration pour déployer DokuWiki sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/DokuWiki_CloudRun.md @ 3055034 sha256:5c7abb5d0b13 -->

# DokuWiki sur Google Cloud Run {#dokuwiki-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/DokuWiki_CloudRun.png" alt="DokuWiki sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

DokuWiki est un **wiki à fichiers plats** (sans base de données) léger et conforme
aux standards, qui stocke l'ensemble de son contenu — pages, médias, plugins,
utilisateurs et configuration — sous forme de fichiers sur disque. Ce module déploie
DokuWiki sur **Cloud Run v2** au-dessus du socle [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise DokuWiki et sur la manière de
les explorer et de les exploiter depuis la console Google Cloud et la ligne de
commande. Pour les mécanismes communs à toute application Cloud Run — identité du
service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de
vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

DokuWiki s'exécute comme un conteneur PHP/Apache sur Cloud Run v2. Le déploiement
assemble un ensemble volontairement restreint de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 8080, 1 vCPU / 512 MiB par défaut ; mise à zéro prise en charge |
| Base de données | **Aucune** | DokuWiki est un wiki à fichiers plats — `database_type = "NONE"`, aucun Cloud SQL provisionné |
| Stockage persistant | Cloud Storage (gcsfuse) | Un bucket `gcs-dokuwiki<tenant-prefix>-data` monté sur `/storage` contient *tout* l'état du wiki |
| Cache et file d'attente | **Aucun** | Pas de Redis ; DokuWiki n'a pas de modèle file d'attente / worker |
| Secrets | **Aucun** | Aucun secret d'exécution — le compte administrateur est créé via `/install.php` |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Pas de base de données.** DokuWiki stocke tout dans le répertoire à fichiers
  plats `/storage`. `database_type` est fixé à `"NONE"` ; une validation au moment du
  plan rejette toute autre valeur (elle provisionnerait une instance Cloud SQL
  inutilisée et engendrerait des coûts).
- **Tout l'état réside dans un seul bucket Cloud Storage.** `/storage` est un montage
  **gcsfuse** du bucket `gcs-dokuwiki<tenant-prefix>-data` provisionné automatiquement. Supprimer ce
  bucket ou le faire pointer ailleurs fait perdre l'intégralité du wiki.
  `force_destroy` est activé ; la destruction du module le supprime donc.
- **Mise en garde sur la persistance avec gcsfuse.** DokuWiki s'appuie sur le
  verrouillage de fichiers pour les éditions simultanées ; gcsfuse est un stockage
  objet à cohérence éventuelle, et non un système de fichiers POSIX. Cela convient à
  un wiki à faible concurrence, mais une édition simultanée intensive est mieux
  servie par la [variante GKE](DokuWiki_GKE.md), qui utilise un PVC bloc.
- **La mise à zéro est toujours en vigueur** (`min_instance_count` est codé en dur à
  `0` dans `dokuwiki.tf`, quelle que soit la valeur de la variable). Les démarrages à
  froid ajoutent quelques secondes à la première requête après une période
  d'inactivité. Comme il n'existe pas de coordinateur de verrous partagé, gardez
  `max_instance_count` prudent — des écrivains simultanés sur plusieurs instances
  peuvent entrer en concurrence sur les mêmes fichiers adossés à gcsfuse.
- **Facturation à la requête par défaut** (`cpu_always_allocated = false`). DokuWiki
  est un wiki purement requête/réponse sans travail en arrière-plan dans le processus ;
  le CPU n'est donc facturé que pendant le traitement d'une requête.
- **Aucun secret d'exécution.** `secret_environment_variables` est vide par
  conception ; le compte administrateur est créé de manière interactive lors de la
  première visite via `/install.php`.
- **Entrée publique par défaut** (`ingress_settings = "all"`) afin que le wiki soit
  accessible via son URL `run.app`. Activez IAP pour exiger une connexion Google
  devant lui.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms du
service et des ressources figurent dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service DokuWiki {#a-cloud-run--the-dokuwiki-service}

DokuWiki s'exécute comme un service Cloud Run v2 qui se met à l'échelle
automatiquement selon la charge de requêtes, entre les nombres minimal et maximal
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être
réparti entre révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour voir les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~dokuwiki"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Base de données — non utilisée {#b-database--not-used}

DokuWiki n'utilise **pas** de base de données. `database_type = "NONE"`, aucune
instance Cloud SQL n'est créée et aucun job `db-init` ne s'exécute. La garde du
module au moment du plan rejette tout `database_type` différent de `NONE`. Si vous
cherchez où réside le contenu du wiki, c'est dans le bucket Cloud Storage du §C, et
non dans une base de données.

### C. Cloud Storage — le volume de données `/storage` {#c-cloud-storage--the-storage-data-volume}

Un unique bucket **Cloud Storage** (`gcs-dokuwiki<tenant-prefix>-data`) est provisionné
automatiquement et monté sur `/storage` dans le conteneur via **gcsfuse**. Ce bucket
contient *tout* l'état de DokuWiki : pages, médias, plugins, utilisateurs, ACL et
configuration.

- **Console :** Cloud Storage → Buckets → le bucket `gcs-dokuwiki<tenant-prefix>-data`.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dokuwiki"
  gcloud storage ls gs://<data-bucket>/                 # bucket name is in the Outputs
  gcloud storage ls -r gs://<data-bucket>/data/pages/   # browse wiki page files
  ```

Les options de montage gcsfuse (`implicit-dirs`, TTL de cache stat/type de 60 s) sont
définies par `DokuWiki_Common`. Consultez [App_CloudRun](App_CloudRun.md) pour les
options GCS Fuse et CMEK.

### D. Redis — non utilisé {#d-redis--not-used}

DokuWiki n'a pas de modèle file d'attente / worker et n'utilise pas Redis.
`enable_redis` est désactivé par défaut et il n'y a aucune raison de l'activer.

### E. Secret Manager — aucun secret applicatif {#e-secret-manager--no-application-secrets}

DokuWiki n'injecte **aucun** secret d'exécution. Le compte administrateur est créé
via l'installateur du premier lancement (`/install.php`) et conservé dans `/storage` ;
il n'y a donc pas de clé générée de type `AP_*` à récupérer.
`secret_environment_variables` reste vide par conception. (Le socle peut néanmoins
créer des secrets au niveau de l'infrastructure ; voir
[App_CloudRun](App_CloudRun.md).)

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dokuwiki"
  ```

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut via son URL `run.app`. Un équilibreur de charge
HTTPS externe avec domaine personnalisé, Cloud CDN et Cloud Armor peut être ajouté
par-dessus ; les paramètres d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur (journaux d'accès et d'erreurs Apache) sont envoyés vers
Cloud Logging ; les métriques Cloud Run sont envoyées vers Cloud Monitoring, avec des
tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application DokuWiki {#3-dokuwiki-application-behaviour}

- **Pas de base de données, pas de job d'initialisation.** Il n'y a aucun schéma à
  créer ni job `db-init`. `initialization_jobs` est vide. Le premier démarrage se
  contente d'amorcer le volume `/storage` avec le wiki par défaut (géré par le point
  d'entrée de l'image amont) s'il est vide.
- **Configuration au premier lancement via `/install.php`.** Lors de la première
  visite, ouvrez `https://<service-url>/install.php` pour créer le compte
  administrateur, définir le titre du wiki et choisir la politique d'ACL. Ces
  éléments sont écrits dans `/storage`. **Supprimez ou bloquez ensuite
  `install.php`** — toute personne qui y accède avant que vous ayez terminé la
  configuration peut s'approprier le compte administrateur.
- **Tout l'état réside sur `/storage`.** Perdre le bucket `gcs-dokuwiki<tenant-prefix>-data` ou le
  faire pointer ailleurs fait perdre le wiki. Comme le bucket est en
  `force_destroy = true`, la destruction du module le supprime — sauvegardez le
  bucket avant le démantèlement si vous devez conserver le contenu.
- **Pas de migrations automatiques.** La mise à niveau de `application_version`
  livre un moteur DokuWiki plus récent qui lit le même répertoire de données
  `/storage` ; il n'y a pas d'étape de migration.
- **Chemin de santé.** Les sondes de démarrage, de vivacité et de disponibilité
  ciblent toutes `/` — DokuWiki y sert sa page d'accueil sans authentification, si
  bien que la sonde réussit dès qu'Apache est prêt. Le premier démarrage se termine
  en quelques secondes (pas de migrations de base de données).
- **Concurrence.** DokuWiki utilise des verrous de fichiers pour les éditions
  simultanées. Sur gcsfuse, ces verrous sont à cohérence éventuelle ; gardez donc des
  nombres d'instances modestes et évitez les éditions simultanées intensives ;
  utilisez la [variante GKE](DokuWiki_GKE.md) (PVC bloc) pour une concurrence en
  écriture plus élevée.
- **Inspecter les montages et l'environnement de la révision en cours
  d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='yaml(spec.template.spec.containers[0].volumeMounts, spec.template.spec.volumes)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à DokuWiki ou notables pour lui sont
listés ; toutes les autres entrées sont héritées d'[App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dokuwiki` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image DokuWiki ; `latest` est résolu au moment du build en une version datée épinglée (`2024-02-06b`). Épinglez une version précise pour la production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Gen2 avec CPU toujours alloué exige ≥ 1 vCPU ; DokuWiki est léger. |
| `memory_limit` | `512Mi` | Mémoire par instance ; DokuWiki nécessite ≥ 256 MiB, 512 MiB recommandés. |
| `min_instance_count` | `0` | Codé en dur à `0` dans `dokuwiki.tf` quelle que soit la valeur de cette variable — DokuWiki est toujours mis à zéro. |
| `max_instance_count` | `3` | Plafond de coût. Restez modeste — des écrivains simultanés sur plusieurs instances entrent en concurrence sur les fichiers gcsfuse partagés. |
| `cpu_always_allocated` | `false` | Facturation à la requête — DokuWiki n'effectue aucun travail en arrière-plan dans le processus. |
| `execution_environment` | `gen2` | Gen2 est requis pour les montages de volumes gcsfuse. |
| `container_port` | `8080` | Apache écoute sur 8080. |
| `enable_cloudsql_volume` | `false` | Pas de base de données — laissez false. |
| `enable_image_mirroring` | `true` | Met en miroir l'image DokuWiki dans Artifact Registry. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` expose publiquement le wiki via son URL `run.app`. |
| `enable_iap` | `false` | Exige une connexion Google devant DokuWiki. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Crée le bucket `gcs-dokuwiki<tenant-prefix>-data` qui adosse `/storage`. |
| `gcs_volumes` | _(valeur par défaut définie par Common)_ | Le montage gcsfuse `/storage`. Laissez tel quel, sauf si vous fournissez un volume personnalisé. |
| `enable_nfs` | `false` | DokuWiki est sans état au niveau du conteneur ; NFS n'est pas requis. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | **Doit rester `NONE`.** Une garde au moment du plan rejette toute autre valeur. |

_Toutes les autres entrées suivent le comportement standard d'[App_CloudRun](App_CloudRun.md)._

---

## 5. Sorties {#5-outputs}

Renvoyées à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris `gcs-dokuwiki<tenant-prefix>-data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide — DokuWiki n'en a aucun). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails de la CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module fait passer sa configuration par le moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages GCS Fuse, un `backup_retention_days` hors limites et (propre au module) un `database_type` différent de `NONE`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant toute création de ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Bucket `gcs-dokuwiki<tenant-prefix>-data` | Ne jamais le supprimer ni le faire pointer ailleurs après le premier déploiement | Critique | Le bucket *est* le wiki — le supprimer ou le faire pointer ailleurs fait perdre toutes les pages, tous les médias et tous les utilisateurs. `force_destroy = true` signifie que la destruction du module le supprime ; sauvegardez-le d'abord. |
| `database_type` | `NONE` | Critique | Toute autre valeur échoue à la garde du plan ; si elle est contournée, elle provisionne une instance Cloud SQL inutilisée et engendre des coûts. |
| `install.php` après la configuration | À supprimer / bloquer dès que l'administrateur existe | Élevé | Toute personne qui atteint `/install.php` avant la fin de votre configuration peut s'approprier le compte administrateur. |
| `execution_environment` | `gen2` | Élevé | `gen1` ne peut pas monter le volume gcsfuse `/storage` — le conteneur n'a nulle part où conserver les données du wiki. |
| `max_instance_count` | Rester modeste (p. ex. `3`) | Élevé | Une forte concurrence entre instances crée des conflits sur les mêmes fichiers adossés à gcsfuse ; les verrous de fichiers de DokuWiki ne sont qu'à cohérence éventuelle sur un stockage objet. |
| `ingress_settings` | `all` (ou IAP) | Élevé | Laissé public avec une inscription / des ACL mal configurées, n'importe qui peut modifier le wiki ; verrouillez l'accès via les ACL du wiki et/ou IAP. |
| `memory_limit` | `512Mi` | Moyen | En dessous de 256 MiB, le processus PHP/Apache peut subir des arrêts OOM en charge. |
| `min_instance_count` | Sans objet — codé en dur à `0` | Faible | `dokuwiki.tf` impose toujours `min_instance_count = 0` ; définir cette variable à `1` n'a aucun effet. La mise à zéro ajoute quelques secondes de latence de démarrage à froid à la première requête après une période d'inactivité. |
| `application_version` | Épingler une version datée | Faible | `latest` est résolu en un tag épinglé au moment du build, mais l'épingler explicitement rend les mises à niveau délibérées. |

---

Pour le comportement du socle évoqué tout au long de cette page — identité du
service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
des images — consultez **[App_CloudRun](App_CloudRun.md)**. La configuration
applicative propre à DokuWiki, partagée avec la variante GKE, est décrite dans
**[DokuWiki_Common](DokuWiki_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : DokuWiki sur Cloud Run](../labs/DokuWiki_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [DokuWiki sur GKE Autopilot](DokuWiki_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [DokuWiki Common — Configuration applicative partagée](DokuWiki_Common.md) — la configuration partagée par les deux cibles de déploiement.
