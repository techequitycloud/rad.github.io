---
title: "PostHog sur GKE Autopilot"
description: "Référence de configuration pour déployer PostHog sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/PostHog_GKE.md @ 3055034 sha256:c000833ca73c -->

# PostHog sur GKE Autopilot {#posthog-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PostHog_GKE.png" alt="PostHog sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

PostHog est une plateforme open source d'analyse produit — analyse d'événements, relecture
de session, feature flags, tests A/B et entonnoirs — publiée sous une licence hybride
MIT/commerciale PostHog. Elle s'exécute comme une application web Python/Django accompagnée
d'un ordonnanceur Celery worker+beat colocalisé, et son pipeline d'événements repose sur
deux services avec état supplémentaires : **Kafka** comme épine dorsale de l'ingestion et
**ClickHouse** comme véritable magasin d'événements analytiques. Ce module déploie PostHog
sur **GKE Autopilot** en s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et
gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par PostHog et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, entrée, mise à
l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

> **Aucune variante Cloud Run, par conception.** Le pipeline d'événements de PostHog impose
> Kafka et ClickHouse — deux services avec état et de longue durée, incompatibles avec le
> modèle serverless de Cloud Run qui réduit à zéro. Seuls `PostHog_GKE` et `PostHog_Common`
> existent.

> **Prérequis de déploiement (recommandé, non imposé) :** déployer d'abord `ClickHouse_GKE`
> et diriger `clickhouse_host` vers celui-ci est la voie recommandée en production —
> conformément au précédent de dépendance inter-modules `RAGFlow_GKE` → `Elasticsearch_GKE`
> de ce catalogue. Contrairement au `elasticsearch_hosts` obligatoire de RAGFlow, PostHog
> propose aussi une solution de repli ClickHouse à nœud unique intégrée au module
> (`enable_inline_clickhouse = true`) pour le développement et les tests ; le plan n'est
> donc pas rejeté d'emblée sans instance externe — mais la garde de validation au moment du
> plan exige tout de même que L'UNE des deux voies soit résolue.

---

## 1. Vue d'ensemble {#1-overview}

PostHog s'exécute comme une unique charge de travail Python/Django conteneurisée avec un
ordonnanceur Celery worker+beat colocalisé (conformément au point d'entrée tout-en-un par
défaut de l'image amont — la même forme que le modèle de worker colocalisé
Saleor/Woodpecker de ce catalogue). Le déploiement assemble quatre magasins de données
indépendants, chacun avec un rôle distinct, et aucun n'est facultatif :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod PostHog construit sur mesure, 4 vCPU / 8 GiB par défaut |
| Métadonnées de l'application | Cloud SQL for PostgreSQL 15 | Uniquement les tables applicatives de Django — utilisateurs, équipes, feature flags, tableaux de bord. Aucune donnée analytique. |
| Magasin d'événements analytiques | ClickHouse | **Obligatoire.** `ClickHouse_GKE` externe recommandé (production) ; solution de repli à nœud unique intégrée au module pour le développement et les tests |
| Épine dorsale de l'ingestion | Kafka | **Obligatoire.** Broker Redpanda à nœud unique intégré par défaut (pas encore de module Kafka autonome dans ce catalogue) |
| Cache / broker | Redis | **Obligatoire.** Broker Celery, pub/sub du plugin-server, cache Django — la plateforme injecte par défaut l'IP du Redis hébergé sur le serveur NFS |
| Stockage d'objets | Cloud Storage (interopérabilité S3) | Enregistrements de relecture de session et exports de données, via le client natif compatible S3 de PostHog — pas un montage GCS FUSE |
| Secrets | Secret Manager | `SECRET_KEY` de Django, paire de clés HMAC d'interopérabilité S3, mot de passe de la base de données, `CLICKHOUSE_PASSWORD` externe facultatif |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est imposé, et ce n'est PAS là que résident vos données analytiques.**
  Postgres ne contient que les métadonnées applicatives de Django. Chaque événement,
  personne, index d'enregistrement de session et requête d'insight s'exécute plutôt sur
  ClickHouse — une forme structurellement différente de la plupart des applications
  adossées à une base de données de ce catalogue.
- **Redis est obligatoire et ne peut pas être désactivé.** Une garde de validation au moment
  du plan rejette purement et simplement `enable_redis = false`. Sans `redis_host`, la
  plateforme injecte l'IP du Redis hébergé sur le serveur NFS — c'est pourquoi `enable_nfs`
  vaut `true` par défaut, même si PostHog lui-même ne dépend d'aucun média sur système de
  fichiers.
- **ClickHouse est obligatoire, externe par défaut.** `clickhouse_host` est vide et
  `enable_inline_clickhouse = false` dès l'installation — définissez `clickhouse_host` sur
  une instance `ClickHouse_GKE` déployée séparément pour la production, ou passez
  `enable_inline_clickhouse = true` pour une solution de repli de développement/test à nœud
  unique et sans persistance.
- **Kafka est obligatoire, intégré par défaut.** `enable_inline_kafka = true` déploie un
  broker Redpanda à nœud unique (compatible avec l'API Kafka, sans Zookeeper) en tant
  qu'entrée `additional_services` — sans volume persistant, ce qui est acceptable pour un
  pipeline d'ingestion puisque les événements sont renvoyés/recapturés en cas de perte.
- **La mise à l'échelle horizontale est désactivée.** `max_instance_count` est plafonné en
  dur à `1` — validé au moment du plan. Le conteneur principal colocalise le worker Celery
  avec son ordonnanceur beat (`--with-scheduler`) ; N réplicas exécuteraient N ordonnanceurs
  beat en double, déclenchant chaque tâche périodique N fois.
- **Une image personnalisée est toujours construite.** Cloud Build étend `posthog/posthog`
  avec un point d'entrée cloud et une surcharge de `docker-boot.sh` (voir §3) —
  contrairement à la plupart des applications à tag `latest` de ce catalogue,
  `posthog/posthog` publie un tag `latest` réellement à jour qui suit master ; aucune
  substitution de tag glissant n'est donc nécessaire, seulement le contournement standard
  de nommage de l'ARG de build.
- **Le stockage d'objets passe par l'interopérabilité S3, pas par GCS FUSE.** Le stockage
  des relectures de session et des exports passe par le client natif compatible S3 de
  PostHog sur l'API d'interopérabilité S3 de GCS, via un compte de service dédié + une paire
  de clés HMAC.
- **`enable_custom_domain` vaut `true` par défaut.** Combiné à la valeur par défaut
  `reserve_static_ip = true`, cela provisionne un certificat géré et HTTPS dès
  l'installation, via un nom d'hôte `<ip>.nip.io`, même lorsque `application_domains` est
  laissé vide.
- **Le CPU et la mémoire sont prédimensionnés au-delà des valeurs génériques.**
  `cpu_limit = "4000m"` / `memory_limit = "8Gi"` — toutes deux relevées après vérification
  en conditions réelles du premier démarrage réellement lourd de PostHog (Django enregistre
  ~80 sous-applications `products`, plus le Celery worker+beat colocalisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail PostHog {#a-gke-autopilot--the-posthog-workload}

Le pod PostHog exécute le serveur web Django/gunicorn et l'ordonnanceur Celery worker+beat
colocalisé dans un seul conteneur, conformément à la séquence de démarrage `bin/docker` par
défaut de PostHog.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail PostHog
  pour voir les pods, les révisions et les événements.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  # First lines of a healthy boot show the resolved config the cloud entrypoint composed:
  kubectl logs -n "$NAMESPACE" deploy/<service-name> | grep -A6 'cloud-entrypoint'
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet). Notez que `max_instance_count` est
plafonné en dur à `1` pour ce module — voir §4.

### B. Cloud SQL for PostgreSQL 15 — uniquement les métadonnées de l'application Django {#b-cloud-sql-for-postgresql-15--django-app-metadata-only}

PostHog stocke les métadonnées de sa propre application Django (comptes utilisateurs,
équipes/projets, définitions des feature flags, tableaux de bord) dans une instance
Cloud SQL for PostgreSQL 15 gérée, atteinte de manière privée via le sidecar
**Cloud SQL Auth Proxy** sur `127.0.0.1`. **Ce n'est PAS là que résident les données
analytiques** — voir §C. Lors du premier déploiement, un job d'initialisation
(`db-init`) crée la base de données et l'utilisateur de l'application ; les migrations
Django de PostHog s'exécutent automatiquement à chaque démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret
Manager contenant le mot de passe sont tous indiqués dans les [sorties](#5-outputs). Pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe,
consultez [App_GKE](App_GKE.md).

### C. ClickHouse — le véritable magasin d'événements analytiques {#c-clickhouse--the-actual-analytics-event-store}

Chaque événement, fiche de personne, index de relecture de session et requête
d'insight/d'entonnoir s'exécute sur ClickHouse, et non sur Postgres — c'est la conception
fondamentale de PostHog, pas un détail d'implémentation. Ce module ne gère **pas**
directement d'instance ClickHouse durable :

- **Recommandé (production) :** déployez `ClickHouse_GKE` séparément et définissez
  `clickhouse_host` sur son nom DNS/IP de Service interne. `clickhouse_password_secret`
  accepte un ID de secret Secret Manager (par exemple la sortie de ce déploiement) et est
  injecté en tant que `CLICKHOUSE_PASSWORD`.
- **Solution de repli pour le développement/test :** `enable_inline_clickhouse = true`
  déploie une instance ClickHouse à nœud unique en tant qu'`additional_service` GKE aux côtés
  de PostHog — **sans volume persistant ; les données sont perdues à chaque redémarrage du
  pod.**

```bash
# Confirm PostHog can reach ClickHouse (native protocol, port 9000):
kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
  sh -c 'echo "SELECT 1" | curl -s "http://$CLICKHOUSE_HOST:8123/" --data-binary @-'

# If using the in-module fallback, inspect it directly:
kubectl get pods -n "$NAMESPACE" -l app=<service-name>-clickhouse
kubectl logs -n "$NAMESPACE" deploy/<service-name>-clickhouse
```

La solution de repli intégrée au module a nécessité un amorçage réellement conséquent pour
que les migrations de schéma de PostHog réussissent sur un nœud unique — un ClickHouse
Keeper embarqué (les tables de suivi des migrations de PostHog utilisent
`ReplicatedMergeTree`, qui exige un coordinateur compatible ZooKeeper même pour un seul
nœud), des macros de cluster/shard/réplica, dix clusters nommés (tous pointant vers le même
nœud), des collections nommées pour les tables Kafka Engine et un mot de passe partagé fixe
(**un mot de passe vide désactive entièrement l'accès réseau pour l'utilisateur `default` —
il ne signifie pas « ouvert, non authentifié »**, confirmé dans le point d'entrée officiel
`clickhouse/clickhouse-server`). La migration ClickHouse propre à PostHog a également besoin
de l'interface HTTP (port 8123) en plus du protocole natif (port 9000) — l'utilisation par
ce module d'un second port sur une même entrée `additional_services` est ce qui a motivé
l'ajout d'un nouveau champ `extra_ports` à `App_GKE` lui-même (voir §3).

### D. Kafka — l'épine dorsale de l'ingestion {#d-kafka--the-ingestion-backbone}

Kafka se situe entre la capture des événements et ClickHouse. Sans lui, le pipeline
d'ingestion de PostHog (confirmé dans le `docker-compose.hobby.yml` actuel :
web/worker/plugin-server en dépendent tous) n'a nulle part où mettre en file d'attente les
événements entrants.

- **Par défaut :** `enable_inline_kafka = true` déploie un broker Redpanda à nœud unique
  (compatible avec l'API Kafka, sans Zookeeper — prend officiellement en charge un mode
  « dev-container » à processus unique) en tant qu'`additional_service` GKE. Pas de volume
  persistant — une replanification du pod perd les événements non consommés, ce qui est
  acceptable pour un pipeline d'ingestion où les événements sont renvoyés/recapturés.
- **Alternative pour la production :** définissez `kafka_hosts` pour pointer vers un broker
  exploité en externe.

```bash
kubectl get pods -n "$NAMESPACE" -l app=<service-name>-kafka
kubectl logs -n "$NAMESPACE" deploy/<service-name>-kafka --tail=50
```

### E. Redis — broker Celery, pub/sub du plugin-server, cache Django {#e-redis--celery-broker-plugin-server-pubsub-django-cache}

Redis est obligatoire et ne peut pas être désactivé — `enable_redis = false` est rejeté au
moment du plan. Sans `redis_host` défini, la plateforme injecte l'IP du Redis hébergé sur le
serveur NFS (c'est pourquoi `enable_nfs` vaut `true` par défaut, même si PostHog ne dépend
lui-même d'aucun média sur système de fichiers).

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info clients
  ```

### F. Cloud Storage — stockage d'objets par interopérabilité S3 {#f-cloud-storage--s3-interop-object-storage}

PostHog n'a aucune médiathèque sur système de fichiers. Les enregistrements de relecture de
session et les exports de données passent par le **client natif compatible S3** de PostHog,
dirigé vers l'API XML d'interopérabilité S3 de GCS via un compte de service dédié et une
paire de clés HMAC — et non par un montage GCS FUSE.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/     # bucket name is in the Outputs
  ```

### G. Secret Manager {#g-secret-manager}

La `SECRET_KEY` de Django (signature des sessions — générée une seule fois, jamais
régénérée lors d'un redéploiement ; sa rotation invalide toutes les sessions actives), la
paire de clés d'accès/secrète HMAC d'interopérabilité S3 et le mot de passe de la base de
données sont tous stockés comme secrets Secret Manager et injectés dans les pods à
l'exécution.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~posthog"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

### H. Réseau et entrée {#h-networking--ingress}

`enable_custom_domain` vaut `true` par défaut, ce qui achemine la charge de travail via
l'équilibreur de charge Gateway API avec un certificat géré par Google — en servant
automatiquement HTTPS sur un nom d'hôte `<ip>.nip.io` lorsque `application_domains` est
vide. `site_url` (injecté en tant que `SITE_URL`, utilisé par PostHog pour construire des
liens absolus — tableaux de bord, insights partagés, charges utiles de webhooks) doit être
défini dès qu'un véritable nom d'hôte ou une IP statique est configuré ; sinon, il prend par
défaut l'URL interne au cluster prévue.

```bash
kubectl get ingress,svc -n "$NAMESPACE"
gcloud compute addresses list --project "$PROJECT"
```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur les IP statiques.

### I. Cloud Logging et Monitoring {#i-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

```bash
gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
  --project "$PROJECT" --limit 50
```

---

## 3. Comportement de l'application PostHog {#3-posthog-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`, `postgres:15-alpine`) crée la base de données PostgreSQL et
  l'utilisateur avant le démarrage de l'application. Aucune extension n'est installée —
  contrairement à de nombreuses applications de ce catalogue, PostHog n'en a besoin
  d'aucune ; tout le stockage propre à l'analytique est dans ClickHouse.
- **Un second job d'initialisation dédié, `clickhouse-migrate`, s'exécute jusqu'à son
  terme avant le démarrage de l'application.** Le `bin/migrate` de PostHog (exécuté à chaque
  démarrage du conteneur) lance la migration du schéma ClickHouse dans un sous-shell *en
  arrière-plan* qui s'exécute en parallèle de la migration Postgres au premier plan — et
  atteint sa vérification des migrations asynchrones (`run_async_migrations`, qui interroge
  ClickHouse sur des tables que le job en arrière-plan est peut-être encore en train de
  créer) *avant* même d'attendre ce job en arrière-plan. Sur une base de données neuve,
  cela plante avec `IndexError: list index out of range` à chaque démarrage, indéfiniment —
  redémarrer ne permet pas à ClickHouse de « rattraper son retard », car `bin/migrate`
  reproduit toujours la même course à partir d'un démarrage à froid. Le job
  `clickhouse-migrate` de ce module exécute au préalable
  `bin/migrate --scope=clickhouse` jusqu'à son terme, sans rien d'autre en concurrence pour
  le même budget de temps, ce qui évite entièrement la course.
- **Les migrations Django s'exécutent automatiquement à chaque démarrage du conteneur**, via
  `./bin/migrate` (inclus dans la séquence de démarrage par défaut intégrée à l'image
  personnalisée).
- **Le composant plugin-server Node.js est absent de l'image amont actuelle.** Vérifié en
  conditions réelles : `/code/nodejs` est absent de `posthog/posthog` (à la fois `:latest`
  et un build vieux de 6 jours), mais le script de démarrage amont tente toujours de s'y
  connecter toutes les 2 secondes, indéfiniment, ce qui maintient le CPU à 100 % et prive de
  ressources le processus qui doit répondre à la sonde de démarrage. Le `docker-boot.sh` de
  ce module ignore ce composant — l'ingestion des événements et l'analytique de base
  fonctionnent correctement ; les fonctionnalités dépendant de plugins peuvent ne pas
  fonctionner tant que l'amont ne l'a pas rétabli. Consultez
  [PostHog_Common](PostHog_Common.md) pour le diagnostic complet.
- **Secrets immuables générés au premier démarrage.** `SECRET_KEY` et la paire de clés HMAC
  d'interopérabilité S3 sont générées une seule fois et jamais régénérées lors d'un
  redéploiement — la rotation de `SECRET_KEY` après le premier démarrage invalide toutes les
  sessions actives.
- **Points de terminaison de santé.** `GET /_readyz` (démarrage) effectue des contrôles
  approfondis des dépendances (état des migrations Postgres, ClickHouse, Kafka, broker
  Celery, cache — vérifiés dans le code source `posthog/health.py`) avec un
  `failure_threshold = 145` délibérément élevé (~25 minutes) pour couvrir les migrations
  Django du premier démarrage. `GET /_livez` (vivacité) est le contrôle léger qui ne vérifie
  pas les dépendances en aval.
- **Le premier lancement est interactif.** Accédez à l'interface web après le déploiement et
  créez le compte administrateur sur l'écran d'inscription — aucun identifiant
  administrateur préconfiguré n'existe dans Secret Manager.
- **Réplica unique par conception.** `max_instance_count` est plafonné à `1` — le conteneur
  principal colocalise le worker Celery avec son ordonnanceur beat ; exécuter N réplicas
  déclencherait chaque tâche périodique N fois.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à PostHog ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et
leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `clickhouse_host` | `""` | Point de terminaison ClickHouse (nom d'hôte/IP nu, sans schéma). Recommandé : le nom DNS/IP de Service interne d'un `ClickHouse_GKE` déployé séparément. |
| `clickhouse_port` | `9000` | Port TCP du protocole natif ClickHouse (utilisé uniquement lorsque `clickhouse_host` est défini). |
| `kafka_hosts` | `""` | Adresse(s) du ou des brokers Kafka, `host:port`. Laissez vide pour utiliser le broker Redpanda intégré. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail qui reçoivent un accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources pour le suivi des coûts et de la propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `posthog` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `PostHog Product Analytics` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de l'image `posthog/posthog`. PostHog publie un tag `latest` réellement à jour qui suit master — utilisé tel quel, sans substitution de tag glissant. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `cpu_limit` | `4000m` | Relevé par rapport à une valeur générique de 2000m après des expirations de la sonde de démarrage constatées en conditions réelles (~95 % de saturation du CPU pendant le premier démarrage). |
| `memory_limit` | `"16Gi"` | Relevé après des arrêts OOM constatés en conditions réelles à 4Gi, 6Gi et 8Gi pendant le premier démarrage — l'image enregistre plus de 90 sous-applications Django au démarrage. |
| `container_port` | `8000` | Port natif du serveur Django/gunicorn. |
| `min_instance_count` | `1` | Nombre minimal de réplicas. |
| `max_instance_count` | `1` | **Plafonné en dur à 1, validé au moment du plan** — ordonnanceur Celery beat colocalisé. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne surchargez pas `CLICKHOUSE_*`, `KAFKA_HOSTS`, `OBJECT_STORAGE_*` — ils sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Table variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service. |
| `session_affinity` | `ClientIP` | Routage persistant. |
| `network_tags` | `["nfsserver"]` | Tags des nœuds/pods ; `nfsserver` est requis pour la connectivité NFS (voir la remarque sur `enable_nfs` dans le groupe 13). |

### Groupe 7 — Configuration du StatefulSet {#group-7--statefulset-configuration}

S'applique uniquement lorsque `workload_type = "StatefulSet"` ou
`stateful_pvc_enabled = true` ; PostHog lui-même n'exige aucun stockage persistant par pod
(les données analytiques résident dans ClickHouse, pas en local).

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` / `startup_probe` | HTTP `/_readyz`, contrôles approfondis des dépendances | `failure_threshold` délibérément élevé (~25 min) pour couvrir les migrations Django du premier démarrage. |
| `health_check_config` / `liveness_probe` | HTTP `/_livez` | Contrôle de vivacité léger — ne vérifie pas les dépendances en aval. |
| `uptime_check_config` | `{ enabled=false, path="/_livez" }` | Test de disponibilité Cloud Monitoring facultatif ; désactivé par défaut. |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs intégrés `db-init` + `clickhouse-migrate`. |
| `additional_services` | `[]` | Uniquement les services supplémentaires fournis par l'opérateur — le broker Redpanda intégré et la solution de repli ClickHouse facultative intégrée au module sont injectés automatiquement et NE font PAS partie de cette liste. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Maintenu à `true` uniquement parce que c'est le mécanisme qui rend disponible l'IP du Redis hébergé sur le serveur NFS — PostHog ne dépend lui-même d'aucun média sur système de fichiers. |
| `nfs_mount_path` | `/mnt/nfs` | Sans effet pour PostHog. |

### Groupe 14 — Cloud Storage {#group-14--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionne le bucket GCS utilisé par le client natif compatible S3 de PostHog (relecture de session, exports). |
| `storage_buckets` | `[{ name_suffix="storage" }]` | L'unique bucket dans lequel écrit le client d'interopérabilité S3 de PostHog. |
| `gcs_volumes` | `[]` | Non utilisé — PostHog n'a aucune médiathèque sur système de fichiers. |

### Groupe 15 — ClickHouse et Kafka {#group-15--clickhouse--kafka}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `clickhouse_database` | `posthog` | Nom de la base de données ClickHouse dans laquelle les événements sont lus/écrits. |
| `clickhouse_user` | `default` | Nom d'utilisateur ClickHouse. |
| `clickhouse_password_secret` | `""` | ID du secret Secret Manager contenant le mot de passe ClickHouse (par exemple issu d'un `ClickHouse_GKE` déployé séparément). Laissez vide pour l'utilisateur par défaut de la solution de repli intégrée au module. |
| `enable_inline_clickhouse` | `false` | ClickHouse à nœud unique en tant qu'`additional_service` GKE. **Développement/test uniquement** — sans volume persistant. |
| `clickhouse_image_tag` | `26.6.1.1193` | Épinglé sur la version exacte qu'utilise le `docker-compose.base.yml` de PostHog — un tag récent générique (par exemple `24.12-alpine`) échoue à une vérification d'expression TTL dans l'une des migrations de PostHog. |
| `enable_inline_kafka` | `true` | Broker Redpanda à nœud unique en tant qu'`additional_service` GKE — la valeur par défaut. |
| `kafka_image_tag` | `v25.1.9` | Tag de l'image Redpanda. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` (fixé à `POSTGRES_15` par `PostHog_Common`) | Métadonnées de l'application uniquement — les données analytiques résident dans ClickHouse. |
| `db_name` | `posthog_db` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `posthog_user` | Utilisateur applicatif. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne un Ingress pour les noms d'hôte personnalisés + un certificat géré. |
| `application_domains` | `[]` | Noms d'hôte à servir. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre. |
| `site_url` | `""` | Injecté en tant que `SITE_URL` — utilisé pour construire des liens absolus (tableaux de bord, insights partagés, charges utiles de webhooks). Prend par défaut l'URL interne au cluster prévue ; définissez-le dès qu'un domaine personnalisé ou une IP statique est configuré. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire, validé — ne peut pas être désactivé.** Broker Celery, pub/sub du plugin-server, cache Django. |
| `redis_host` | `""` | Hôte Redis. Lorsqu'il est vide et que NFS est activé, l'IP du serveur NFS est utilisée. |
| `redis_port` | `6379` | Port Redis. |

Pour tous les autres groupes (CI/CD, sauvegarde et maintenance, SQL personnalisé, IAP,
Cloud Armor, VPC Service Controls), PostHog hérite du comportement standard
d'[App_GKE](App_GKE.md), sans surcharge propre à l'application.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `web_url` | URL de l'interface web de PostHog — servie par le service principal lui-même (le conteneur Django/gunicorn colocalisé), et non par un frontend distinct. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application (métadonnées de l'application uniquement). |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (stockage d'objets par interopérabilité S3). |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `initialization_jobs` | Noms des jobs `db-init` et `clickhouse-migrate`. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. `false` lors du premier apply d'un nouveau cluster inline — relancez l'apply pour terminer le déploiement. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_redis` | `true` (ne peut pas être désactivé) | Critique | Le broker Celery, le pub/sub du plugin-server et le cache Django de PostHog nécessitent tous Redis ; le serveur refuse de démarrer sans lui. |
| `clickhouse_host` / `enable_inline_clickhouse` | l'un des deux doit être résolu | Critique | Sans point de terminaison ClickHouse joignable, l'ensemble du pipeline d'événements analytiques de PostHog ne peut pas fonctionner — ni événements, ni insights, ni relecture de session. |
| `kafka_hosts` / `enable_inline_kafka` | l'un des deux doit être résolu (par défaut : intégré) | Critique | Sans Kafka, les événements ingérés n'ont nulle part où être mis en file d'attente — le pipeline se bloque. |
| `max_instance_count` | `1` (validé, ne peut pas être dépassé) | Critique | L'ordonnanceur Celery beat colocalisé déclenche chaque tâche périodique une fois par réplica ; N réplicas signifient N exécutions en double des jobs planifiés. |
| `enable_inline_clickhouse` | `false` en production | Critique | La solution de repli intégrée au module n'a pas de volume persistant — chaque redémarrage du pod perd toutes les données analytiques (événements, relectures de session, insights). |
| `enable_inline_kafka` | `true` acceptable dans la plupart des cas, `false` + broker externe pour une file d'attente durable | Élevé | Le Redpanda intégré n'a pas de volume persistant — une replanification du pod perd les événements non consommés (acceptable pour une ingestion renvoyée, pas pour une file d'attente durable). |
| `redis_host` | hôte explicite, ou laisser `""` avec `enable_nfs=true` | Critique | Si aucun des deux n'est défini, `REDIS_HOST` est vide et PostHog échoue immédiatement au démarrage avec une erreur claire. |
| `db_name` / `db_user` | à définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur. Notez que cela n'affecte que les métadonnées de l'application, pas les données analytiques (qui résident dans ClickHouse). |
| `cpu_limit` / `memory_limit` | `4000m` / `8Gi` minimum | Élevé | En dessous, le premier démarrage réellement lourd de PostHog (Django enregistrant ~80 sous-applications, plus le Celery worker+beat colocalisé) provoque, comme vérifié en conditions réelles, des expirations de la sonde de démarrage (CPU) ou des arrêts OOM (mémoire, confirmés à 4Gi comme à 6Gi). |
| `clickhouse_image_tag` (solution de repli intégrée) | `26.6.1.1193` — n'utilisez pas de tag récent générique | Élevé | Une version récente générique (par exemple `24.12-alpine`) échoue à une vérification de validation d'expression TTL utilisée par l'une des migrations ClickHouse de PostHog, sans contournement possible par la configuration. |
| Rotation de `SECRET_KEY` | ne jamais effectuer de rotation après le premier démarrage | Critique | La rotation de la clé de signature de Django invalide toutes les sessions actives. |
| `enable_iap` / `enable_cloud_armor` | à activer en production | Moyen | Sinon, l'interface web de PostHog (et l'écran initial d'inscription de l'administrateur) est accessible publiquement. |
| `site_url` | à définir dès qu'un domaine personnalisé/une IP statique existe | Moyen | S'il reste sur la valeur par défaut interne au cluster prévue, les liens des tableaux de bord, les insights partagés et les charges utiles de webhooks pointent vers une URL interne inaccessible une fois l'accès externe configuré. |
| `application_version` | `latest` (réellement à jour, contrairement à plusieurs applications de ce catalogue) | Moyen | Une incrémentation déclenche une reconstruction de l'image et un redémarrage progressif ; vérifiez la compatibilité des schémas Postgres + ClickHouse lors des changements de version majeure. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
mise à l'échelle automatique, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à PostHog est décrite dans
**[PostHog_Common](PostHog_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PostHog sur GKE Autopilot](../labs/PostHog_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [PostHog Common — Configuration applicative partagée](PostHog_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [ClickHouse sur GKE Autopilot](ClickHouse_GKE.md), [Plausible Analytics sur GKE Autopilot](Plausible_GKE.md), [Metabase sur GKE Autopilot](Metabase_GKE.md) dans la solution **Product Analytics**.
