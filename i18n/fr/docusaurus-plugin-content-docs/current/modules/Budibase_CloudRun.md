---
title: "Budibase sur Google Cloud Run"
description: "Référence de configuration pour déployer Budibase sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Budibase_CloudRun.md @ 3055034 sha256:5fd5774bbb0b -->

# Budibase sur Google Cloud Run {#budibase-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Budibase_CloudRun.png" alt="Budibase sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Budibase est une plateforme low-code open source permettant de créer des outils internes,
des applications métier et des workflows à partir de vos données. Ce module déploie Budibase sur **Cloud
Run v2** en s'appuyant sur le socle [App_CloudRun](App_CloudRun.md), qui provisionne
et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Budibase et sur la manière de les explorer et
de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications Cloud Run — identité du service, entrée et équilibrage
de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Budibase s'exécute sous la forme d'un unique conteneur **tout-en-un** sur Cloud Run v2. L'image officielle
`budibase/budibase` regroupe **CouchDB + MinIO + Redis** ainsi que les applications/le worker/le proxy de
Budibase, et sert le HTTP sur le **port 80** — il n'y a aucune base de données
gérée externe. Le déploiement assemble un ensemble ciblé de services
Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Un seul conteneur tout-en-un, 4 vCPU / 8 GiB par défaut ; s'exécute en **une seule** instance (min = max = 1) |
| Base de données | Aucune (CouchDB intégré) | `database_type = "NONE"` — CouchDB, MinIO et Redis s'exécutent tous dans le conteneur |
| Stockage d'objets | Cloud Storage | Un bucket de données provisionné automatiquement ; le stockage d'éléments propre à Budibase est le MinIO intégré |
| Cache et file d'attente | Redis intégré | S'exécute dans le conteneur sur l'interface loopback ; `enable_redis` est désactivé par défaut |
| Secrets | Secret Manager | Sept identifiants internes générés automatiquement, injectés comme variables d'environnement secrètes du service |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe + domaine personnalisé en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Cloud Run est éphémère / réservé à la démonstration pour Budibase.** Tout l'état (documents CouchDB
  + objets MinIO) réside dans le chemin `/data` du conteneur, et **Cloud Run ne dispose d'aucun
  disque local durable** — un redémarrage ou une nouvelle révision fait perdre le magasin de données. Pour un
  déploiement persistant, utilisez la [variante GKE](Budibase_GKE.md), qui monte un PVC
  en mode bloc sur `/data`.
- **S'exécute en une seule instance.** `min_instance_count = 1` et `max_instance_count = 1`.
  Le conteneur tout-en-un conserve tout son état localement ; plusieurs réplicas ne
  partageraient donc pas les données (split-brain). La mise à l'échelle à zéro ferait perdre le magasin de données en cours, d'où
  un minimum de 1.
- **`cpu_always_allocated = true`.** Le CPU est alloué en permanence afin que les processus d'arrière-plan
  CouchDB/MinIO/Redis intégrés continuent de tourner entre les requêtes ; laissez-le à
  `true` avec `min_instance_count >= 1`.
- **Sept identifiants internes sont générés automatiquement** et stockés dans Secret
  Manager (`INTERNAL_API_KEY`, `JWT_SECRET`, `MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`,
  `API_ENCRYPTION_KEY`, `REDIS_PASSWORD`, `COUCH_DB_PASSWORD`). Ils ne doivent jamais faire l'objet d'une
  rotation après le premier démarrage — les données de `/data` sont chiffrées avec eux et deviennent
  illisibles s'ils changent.
- **Le port 80 est fixe.** Le proxy nginx de l'image tout-en-un sert l'ensemble de l'application sur
  le port 80 ; `container_port` et les sondes sont donc fixés à 80.
- **Aucune base de données externe ni job `db-init`.** Budibase provisionne lui-même CouchDB et
  MinIO au premier démarrage ; `enable_cloudsql_volume` et `database_type` valent par défaut
  désactivé/`NONE`.
- **Entrée publique par défaut.** `ingress_settings = "all"`, de sorte que l'application est accessible
  à son URL `run.app` ; l'activation d'IAP place la connexion Google devant elle.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Budibase {#a-cloud-run--the-budibase-service}

Budibase s'exécute en tant que service Cloud Run v2. Comme il conserve tout son état localement, il s'exécute
en une seule instance (min = max = 1) ; chaque déploiement crée une révision immuable.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Magasin de données (CouchDB + MinIO intégrés) {#b-data-store-bundled-couchdb--minio}

Il n'y a **aucune instance Cloud SQL** — `database_type = "NONE"`. Le magasin de documents
CouchDB et le magasin d'objets MinIO de Budibase s'exécutent tous deux **dans le conteneur** et persistent
dans `/data`. Sur Cloud Run, ce répertoire se trouve sur le système de fichiers éphémère du conteneur ;
il ne survit donc pas à un redémarrage. Inspectez les services intégrés via les variables d'environnement
et les journaux du conteneur plutôt que via une console de base de données gérée :

- **CLI :**
  ```bash
  # Confirm database_type=NONE and the bundled-service env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Pour un magasin de données durable, utilisez la [variante GKE](Budibase_GKE.md) (PVC en mode bloc sur `/data`).

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Le stockage d'éléments et de pièces jointes propre à Budibase est le MinIO intégré ; ce bucket GCS
est disponible pour l'intégration du stockage au niveau du socle.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (intégré) {#d-redis-bundled}

Redis s'exécute **dans le conteneur tout-en-un** sur l'interface loopback et s'authentifie avec
le `REDIS_PASSWORD` généré automatiquement. `enable_redis` est **désactivé par défaut** — n'activez pas
de Redis externe sauf si vous externalisez délibérément le cache.

- **CLI :**
  ```bash
  # Verify the bundled Redis password secret is wired into the revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -i redis
  ```

### E. Secret Manager {#e-secret-manager}

Sept identifiants internes sont générés automatiquement et stockés dans Secret Manager,
puis injectés comme variables d'environnement secrètes du service : `INTERNAL_API_KEY`, `JWT_SECRET`,
`MINIO_ACCESS_KEY`, `MINIO_SECRET_KEY`, `API_ENCRYPTION_KEY`, `REDIS_PASSWORD` et
`COUCH_DB_PASSWORD`. Ils ne doivent jamais faire l'objet d'une rotation après le premier démarrage.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~budibase"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et
[Budibase_Common](Budibase_Common.md) pour ce que protège chaque secret.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par défaut à son URL `run.app`. Un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peut y être ajouté ; les paramètres
d'entrée et la sortie VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux du conteneur sont envoyés vers Cloud Logging ; les métriques Cloud Run vers Cloud Monitoring,
avec des tests de disponibilité et des règles d'alerte en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Budibase {#3-budibase-application-behaviour}

- **Aucune initialisation de base de données externe.** Avec `database_type = "NONE"`, il n'y a pas de
  job `db-init`. Budibase provisionne lui-même ses CouchDB et MinIO intégrés au premier démarrage
  dans le conteneur. Seuls les `initialization_jobs` fournis par l'utilisateur sont pris en compte.
- **L'état réside dans `/data` — et Cloud Run ne le conserve pas.** Les documents CouchDB
  et les objets MinIO sont écrits dans `/data` sur le système de fichiers éphémère du conteneur.
  Tout redémarrage ou nouvelle révision repart d'un magasin vide ; considérez donc un déploiement
  Budibase sur Cloud Run comme éphémère/réservé à la démonstration et utilisez la variante GKE pour tout ce que vous
  devez conserver.
- **Les identifiants internes sont immuables après le premier démarrage.** Les sept secrets
  générés chiffrent les données de `/data`. Modifier `API_ENCRYPTION_KEY` corrompt toutes les
  données chiffrées stockées ; modifier `JWT_SECRET` invalide toutes les sessions ; modifier les
  identifiants MinIO ou CouchDB rompt l'accès aux magasins d'objets/de documents. N'effectuez
  de rotation que lors d'une réinitialisation planifiée.
- **Configuration au premier lancement.** Budibase auto-hébergé est livré **sans compte administrateur par défaut**.
  Ouvrez l'URL du service après le déploiement et créez l'administrateur initial (e-mail +
  mot de passe) via l'écran de configuration avant toute utilisation.
- **Chemin de santé.** La sonde de démarrage est en **TCP** sur le port 80 (et non en HTTP) : nginx se lie
  au port en quelques secondes mais renvoie 502 tant que les services amont CouchDB/MinIO/application
  intégrés n'ont pas fini de démarrer ; un contrôle HTTP sur `/` échouerait donc pendant toute la
  fenêtre de démarrage des services amont — le TCP réussit dès que nginx se lie au port, ce qui permet à la
  révision de passer à l'état Ready pendant que les services amont terminent en arrière-plan (délai initial de 30 secondes,
  fenêtre de 40 tentatives à une période de 15 secondes, ~10 minutes au total). Les sondes de vivacité et
  de disponibilité sont en HTTP sur la racine non authentifiée `/` ; la sonde de vivacité utilise un
  délai initial de 240 secondes pour franchir la fenêtre post-démarrage pendant laquelle `/` renvoie encore 502.
- **Instance unique uniquement.** Conservez `min_instance_count = max_instance_count = 1` ; le
  magasin de données est local au conteneur et ne peut pas être partagé entre réplicas.
- **Vérifier la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  gcloud run jobs list --project "$PROJECT" --region "$REGION"   # only user-supplied init jobs
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Budibase ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `budibase` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Budibase` | Nom lisible affiché dans la console. |
| `application_version` | `3.39.29` | Tag de l'image Budibase ; utilisé comme `FROM budibase/budibase:<tag>` pour le build de l'image enveloppe légère. Incrémentez-le pour déclencher un nouveau build/une nouvelle révision. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_port` | `80` | Le proxy nginx de l'image tout-en-un sert l'ensemble de l'application sur le port 80 — doit rester à 80. |
| `container_resources` | `4000m` / `8Gi` | CPU et mémoire par instance ; les CouchDB/MinIO/Redis intégrés et la couche applicative ont besoin d'une mémoire généreuse — avec 4Gi, l'instance boucle en OOM sur Cloud Run gen2 (le répertoire inscriptible `/data` est décompté de la limite de mémoire) ; 8Gi est donc le minimum fiable. |
| `min_instance_count` | `1` | Laissez à 1 — la mise à l'échelle à zéro ferait perdre le magasin de données local. |
| `max_instance_count` | `1` | Laissez à 1 — le conteneur conserve tout son état localement ; les réplicas ne partageraient pas les données. |
| `cpu_always_allocated` | `true` | Alloue le CPU en permanence afin que les services d'arrière-plan intégrés continuent de tourner entre les requêtes. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `enable_cloudsql_volume` | `false` | Budibase n'utilise aucune base de données SQL externe. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Budibase dans Artifact Registry. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accessible par défaut à l'URL `run.app`. |
| `enable_iap` | `false` | Exige une connexion Google devant Budibase. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires fusionnés dans le conteneur. Les valeurs essentielles (`BUDIBASE_ENVIRONMENT`, `SELF_HOSTED`, `COUCH_DB_USER`, `LOG_LEVEL`) sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom du secret Secret Manager. Les sept identifiants internes sont injectés automatiquement — ne les définissez pas ici. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Budibase intègre son propre CouchDB ; aucune base de données gérée externe n'est provisionnée. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Redis s'exécute dans le conteneur ; laissez désactivé sauf pour externaliser le cache. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Utilisés uniquement si un Redis externe est activé. |

Toutes les autres entrées suivent le comportement standard d'App_CloudRun.

---

## 5. Sorties {#5-outputs}

Renvoyés à l'issue d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` / `database_name` / `database_user` | Renseignés uniquement si une base de données gérée est utilisée ; vides pour Budibase (`database_type = NONE`). |
| `database_password_secret` / `database_host` / `database_port` | Secret / point de terminaison / port de la base de données (inutilisés pour Budibase). |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des éventuels jobs d'initialisation fournis par l'utilisateur. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — un `container_port` hors limites, une quantité de CPU/mémoire invalide, un `database_type` qui ne correspond pas à une extension activée, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Cloud Run comme plateforme | GKE pour la persistance | Critique | Cloud Run n'a pas de disque durable — `/data` (tout l'état CouchDB + MinIO) est perdu à chaque redémarrage/révision. N'utilisez Budibase_CloudRun que pour la démonstration/l'évaluation. |
| `API_ENCRYPTION_KEY` (généré automatiquement) | Aucune rotation après le premier démarrage | Critique | Sa rotation corrompt toutes les données chiffrées stockées — elles ne peuvent plus être déchiffrées. |
| `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` / `COUCH_DB_PASSWORD` (générés automatiquement) | Aucune rotation après le premier démarrage | Critique | Leur rotation rompt l'accès aux magasins d'objets/de documents intégrés chiffrés sur `/data`. |
| `JWT_SECRET` (généré automatiquement) | Rotation uniquement lors d'une fenêtre de maintenance | Élevé | Sa rotation invalide toutes les sessions utilisateur actives et impose une reconnexion immédiate. |
| `max_instance_count` | `1` | Critique | Plus d'une instance scinde le magasin de données local — les réplicas ne partagent pas `/data` (split-brain, perte de données). |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro fait perdre le magasin de données en cours dans le conteneur. |
| `cpu_always_allocated` | `true` | Élevé | La facturation à la requête réduit à ~0 CPU, entre les requêtes, le travail d'arrière-plan des CouchDB/MinIO/Redis intégrés. |
| `container_port` | `80` | Élevé | Le proxy nginx sert l'application sur le port 80 ; tout autre port fait échouer les sondes et le service ne passe jamais à l'état Ready. |
| `database_type` | `NONE` | Élevé | Choisir un moteur externe provisionne une instance Cloud SQL inutilisée ; Budibase ne s'y connecte jamais. |
| `memory_limit` | `8Gi` | Élevé | Avec 4Gi, l'instance boucle en OOM (redémarrages ~toutes les 60 s) — le répertoire inscriptible `/data` (état CouchDB/MinIO/Redis) est en mémoire sur Cloud Run gen2 et décompté de la limite ; 8Gi est le minimum fiable. |
| Premier compte administrateur | À créer immédiatement après le déploiement | Élevé | Budibase auto-hébergé est livré sans administrateur par défaut — une instance non revendiquée peut être revendiquée par quiconque atteint l'URL. |
| `enable_iap` | à activer pour les déploiements privés | Moyen | Sans IAP ni WAF, l'interface est publiquement accessible à l'URL `run.app`. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service, mise à l'échelle et
concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à Budibase,
partagée avec la variante GKE, est décrite dans **[Budibase_Common](Budibase_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Budibase sur Cloud Run](../labs/Budibase_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Budibase sur GKE Autopilot](Budibase_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Budibase Common — Configuration applicative partagée](Budibase_Common.md) — la configuration partagée par les deux cibles de déploiement.
