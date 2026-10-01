---
title: "Payload CMS sur GKE Autopilot"
description: "Référence de configuration pour déployer Payload CMS sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Payload_GKE.md @ 3055034 sha256:b5be842209ac -->

# Payload CMS sur GKE Autopilot {#payload-cms-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Payload_GKE.png" alt="Payload CMS sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Payload CMS est un CMS headless et un framework applicatif natif TypeScript, orienté code, construit
directement sur Next.js — non pas un produit SaaS hébergé, mais une bibliothèque installée dans votre propre application
Next.js. Le contenu est modélisé au moyen de « Collections » typées définies dans `payload.config.ts`, et
Payload génère une interface d'administration ainsi que des API REST, GraphQL et Local à partir de cette même configuration. Ce
module déploie une véritable application Payload sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par ce déploiement et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les
applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Payload s'exécute sous la forme d'un pod Node.js (Next.js) sur GKE Autopilot. Il n'existe **aucune image Docker
officielle de Payload** — ce module construit, via Cloud Build, une véritable application de démarrage vérifiée localement à partir des sources (un modèle
`create-payload-app` vierge utilisant l'adaptateur PostgreSQL). Le déploiement relie
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Node.js (Next.js standalone), avec autoscaling horizontal |
| Build | Cloud Build | Construit l'application de démarrage Payload fournie à partir de `Payload_Common/scripts/Dockerfile` — aucune image préconstruite n'existe à télécharger |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — l'adaptateur Postgres de Payload est utilisé ; MySQL/MongoDB ne sont pas raccordés |
| Stockage d'objets | Aucun | Aucun bucket n'est provisionné ; les médias téléversés vont sur le disque local et éphémère du conteneur |
| Secrets | Secret Manager | `PAYLOAD_SECRET` généré automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe par défaut, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et le schéma n'est pas créé au démarrage.** Démarrer le serveur compilé
  sur une base de données neuve ne crée aucune table — le job d'initialisation `payload-migrate` applique le schéma via
  la CLI `payload migrate`, à l'aide d'un fichier de migration pré-généré intégré à l'image.
- **`container_image_source` est fixé à `"custom"`.** Rien ne peut être déployé sans une exécution
  Cloud Build — le module construit toujours `Payload_Common/scripts/` à partir des sources.
- **Les sondes de santé ciblent `/admin`, et non `/` ou une route d'API.** `/admin` sert le
  formulaire de connexion/de création du premier utilisateur de Payload et renvoie un `200` sans authentification ; les routes REST/GraphQL
  de Payload exigent une authentification et ne conviennent pas comme cibles de sonde.
- **Aucun bucket de stockage n'est provisionné.** Les médias téléversés sont écrits sur le disque local du conteneur et
  ne survivent pas à un redémarrage de pod ni à un redéploiement.
- **`enable_redis` et les variables associées du groupe 21 sont déclarées mais inertes.** Elles ne sont pas transmises
  à `Payload_Common`, qui ne dispose d'aucun raccordement Redis.
- **`service_type` vaut `LoadBalancer` par défaut.** La vérification en conditions réelles de ce déploiement a utilisé
  `ClusterIP` uniquement parce que le quota d'adresses IP statiques `IN_USE_ADDRESSES` du projet cible était épuisé
  au moment du déploiement — un choix opérationnel propre à ce déploiement, et non une valeur par défaut du module.
  Revenez à `LoadBalancer` (ou réservez une IP statique) dès que le quota est disponible.
- **Le premier utilisateur administrateur est créé manuellement.** Payload ne dispose d'aucune CLI non interactive pour cela —
  visiter `/admin` avec une collection `users` vide affiche un formulaire d'inscription.
- **Au moins 1 réplica est maintenu par défaut** (`min_instance_count = 1`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres identifiants sont
indiqués dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Payload {#a-gke-autopilot--the-payload-workload}

Les pods Payload sont planifiés sur Autopilot, qui facture le CPU et la mémoire réellement
demandés par les pods.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Payload pour voir les pods,
  les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  ```

Consultez [App_GKE](App_GKE.md) pour savoir comment Autopilot, le scaling et le type de charge de travail (Deployment ou
StatefulSet) sont gérés.

### B. Cloud Build — construction de l'image Payload {#b-cloud-build--building-the-payload-image}

Comme aucune image Payload officielle n'existe, chaque déploiement (et chaque redéploiement après une modification du Dockerfile ou
des sources) déclenche une exécution Cloud Build sur `Payload_Common/scripts/`.

- **Console :** Cloud Build → History.
- **CLI :**
  ```bash
  gcloud builds list --project "$PROJECT" --limit=10
  gcloud builds log <build-id> --project "$PROJECT"
  ```

### C. Cloud SQL for PostgreSQL 15 {#c-cloud-sql-for-postgresql-15}

Payload stocke toutes les données de l'application (Collections, utilisateurs, métadonnées des documents téléversés) dans une instance
gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de façon privée via le sidecar **Cloud SQL Auth Proxy**
sur un socket Unix ; aucune IP publique n'est exposée. Au premier déploiement, `db-init` crée la
base de données et le rôle, puis `payload-migrate` applique le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
figurent tous dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le modèle de connexion,
les sauvegardes automatiques et la rotation des mots de passe.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `PAYLOAD_SECRET`
(utilisé pour signer les propres jetons de session/d'authentification de Payload). Le mot de passe de la base de données est géré séparément par
le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être
activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Si le déploiement a été configuré avec `service_type = "ClusterIP"` (par exemple parce que le quota d'IP statiques
était épuisé au moment du déploiement), accédez plutôt à l'application depuis l'intérieur du cluster :

```bash
kubectl port-forward -n "$NAMESPACE" svc/<service-name> 18080:3000
curl -s http://localhost:18080/admin -o /dev/null -w '%{http_code}\n'
```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur les IP statiques.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods sont envoyés à Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées à Cloud Monitoring.
Des tests de disponibilité et des règles d'alerte sont disponibles en option.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Payload {#3-payload-application-behaviour}

- **Configuration de la base de données au premier déploiement.** `db-init` (avec `postgres:15-alpine`) se connecte via le
  Cloud SQL Auth Proxy et crée de manière idempotente le rôle et la base de données de l'application.
- **La migration du schéma est un job distinct et dépendant.** `payload-migrate` (`depends_on_jobs =
  ["db-init"]`) exécute `./node_modules/.bin/payload migrate` depuis une copie complète `/app/cli` de
  `node_modules` + des sources TypeScript intégrée à l'image — le runtime Next.js standalone allégé
  qui sert le trafic n'inclut ni la CLI Payload ni ses dépendances. Sur GKE, le Cloud SQL
  Auth Proxy s'exécute comme sidecar natif ; le script de migration lui signale de s'arrêter via
  `http://localhost:9091/quitquitquit` une fois les migrations terminées.
- **`PAYLOAD_SECRET` doit être considéré comme immuable après le premier démarrage.** Il signe les
  jetons de session/d'authentification de Payload ; sa rotation invalide toutes les sessions actives.
- **Chemin de vérification d'état.** Les sondes de démarrage et de vivacité ciblent `/admin` — la route de l'interface d'administration de Payload, qui
  renvoie un `200` sans authentification dès que le serveur Node.js et la connexion à la base de données sont prêts.
  Prévoyez plusieurs minutes au premier démarrage pour que le job `payload-migrate` se termine avant que le service
  ne soit censé servir du contenu réel.
- **Premier compte administrateur.** Payload ne dispose d'aucune commande CLI pour créer le premier utilisateur administrateur
  de manière non interactive. Visitez `$SERVICE_URL/admin` (ou utilisez `kubectl port-forward` en cas de `ClusterIP`) — avec
  une collection `users` vide, Payload affiche un formulaire d'inscription pour créer le premier administrateur. Il s'agit
  d'une étape manuelle et unique de l'opérateur.
- **Les médias téléversés ne sont pas conservés.** Aucun bucket de stockage n'est provisionné ; les fichiers téléversés sont écrits
  sur le disque local du conteneur et sont perdus au prochain redémarrage de pod ou redéploiement.
- **`service_type` peut nécessiter une bascule manuelle.** S'il est exposé en `ClusterIP` en raison de contraintes de quota d'IP,
  l'application n'est accessible que via `kubectl port-forward`/`kubectl exec` jusqu'à ce qu'il soit
  rebasculé en `LoadBalancer` (ou qu'une IP statique soit réservée) et réappliqué.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres
à Payload ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

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
| `application_name` | `payload` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Payload CMS` | Nom lisible affiché dans la Console. Texte résiduel provenant de la source clonée du module — remplacez-le par `Payload CMS` au moment du déploiement ; il est purement cosmétique. |
| `application_version` | `latest` | Étiquette de suivi du déploiement intégrée à l'image via l'argument de build Cloud Build `application_version`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Fixe — il n'existe aucune image Payload préconstruite à déployer. |
| `min_instance_count` / `max_instance_count` | `1` / `3` | Nombre minimal de réplicas maintenus actifs ; GKE ne réduit pas à zéro. |
| `container_port` | `3000` | Valeur par défaut de Next.js. |
| `container_resources` | `{ cpu_limit="1000m", memory_limit="1Gi" }` | Payload (Next.js) a besoin de marge pour le serveur standalone ainsi que pour l'empreinte TypeScript/CLI du job de migration ; envisagez d'augmenter la mémoire en production. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image construite dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne définissez pas `PAYLOAD_SECRET` ni `DATABASE_URL` ici — les deux sont calculés automatiquement. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. Définissez `ClusterIP` si le quota d'IP statiques du projet est épuisé ; accédez alors via `kubectl port-forward`. |
| `workload_type` | `null` (se résout en `Deployment`) | Payload n'a pas besoin de PVC par pod par défaut. |
| `session_affinity` | `None` | Aucune exigence de session persistante pour cette application de démarrage minimale. |

### Groupe 11 — Cloud Storage et Artifact Registry {#group-11--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_gcs_storage` | `false` | Déclarée dans `variables.tf` avec une description évoquant un adaptateur de stockage GCS compatible S3, mais **non transmise** à `Payload_Common` — sans effet. La sortie `storage_buckets` de `Payload_Common` vaut toujours `[]`. |
| `gcs_volumes` | `[]` | Réellement transmise — montages de volumes GCS Fuse, si vous souhaitez raccorder vous-même un stockage persistant. |

### Groupe 13 — Système de fichiers (NFS) et jobs {#group-13--filesystem-nfs--jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser la chaîne intégrée `db-init` → `payload-migrate`. |
| `enable_nfs` | `false` | Non requis — les données propres à Payload résident dans Postgres, pas sur NFS. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe_config` | HTTP `/admin`, délai de 120 s, période de 15 s, 40 tentatives | Fenêtre totale d'environ 12 minutes pour que les migrations du premier démarrage se terminent. |
| `health_check_config` | HTTP `/admin`, délai de 30 s | Sonde de vivacité. |

### Groupe 15 — Backend de base de données {#group-15--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; Payload requiert PostgreSQL. |
| `application_database_name` / `application_database_user` | `payload` / `payload` | Nom de la base PostgreSQL et utilisateur de l'application. Immuables après le premier déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre — utile une fois `service_type = LoadBalancer` rétabli après un éventuel repli temporaire sur `ClusterIP`. |

### Groupe 21 — Cloud Armor et cache Redis {#group-21--cloud-armor--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | `true` / `""` / `6379` / `""` | **Inertes.** Déclarées dans `variables.tf` (avec une description affirmant que Payload v0.4+ requiert Redis) mais jamais transmises à `Payload_Common`, qui ne dispose d'aucun raccordement Redis. Les définir n'a aucun effet. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées à l'issue d'un déploiement réussi et constituent le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée ou que `service_type = LoadBalancer`). |
| `service_url` | URL d'accès à Payload. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Toujours vide — aucun bucket n'est provisionné. |
| `container_image` / `container_registry` | Image construite et dépôt Artifact Registry. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `monitoring_enabled` / `monitoring_notification_channels` | État du monitoring et canaux. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) — **Moyen**
> (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `PAYLOAD_SECRET` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critique | Sa rotation invalide toutes les sessions actives et oblige tous les utilisateurs à se reconnecter. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base/l'utilisateur et détruit toutes les données. |
| `startup_probe_config` / délai de `payload-migrate` | Conserver la fenêtre complète d'environ 12 minutes | Élevé | Si la fenêtre de la sonde est raccourcie en deçà du temps nécessaire à `payload-migrate`, le pod peut être marqué comme défaillant avant la fin de la migration du schéma, car les deux s'exécutent en parallèle au lieu que la sonde attende le job. |
| Persistance des médias/téléversements | Ajouter un véritable adaptateur de stockage avant toute utilisation en production | Élevé | Sans bucket de stockage raccordé, tous les médias téléversés résident sur le disque local du conteneur et sont perdus à chaque redémarrage de pod ou redéploiement. |
| `service_type` | `LoadBalancer` (par défaut) | Élevé | S'il reste en `ClusterIP` (par exemple après un repli dû au quota), l'application n'est pas accessible de l'extérieur tant qu'il n'est pas rebasculé. |
| `enable_gcs_storage` | Ne pas compter sur ce paramètre | Moyen | Déclaré mais non transmis à `Payload_Common` — l'activer ne provisionne ni ne raccorde aucun stockage. |
| `enable_redis` / `redis_*` | Ne pas compter sur ces paramètres | Moyen | Déclarés mais non transmis à `Payload_Common`, qui ne dispose d'aucun raccordement Redis — les définir n'a aucun effet. |
| Création du premier administrateur | À effectuer rapidement après le déploiement | Moyen | Tant que le premier administrateur n'a pas été créé via le formulaire d'inscription `/admin`, l'instance ne possède aucun utilisateur authentifié. |
| `container_image_source` | Laisser à `custom` | Faible | Il n'existe aucune image Payload préconstruite ; définir `prebuilt` sans `container_image` valide fait échouer le déploiement. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling,
ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et
mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à Payload
partagée avec la variante Cloud Run est décrite dans **[Payload_Common](Payload_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Payload CMS sur GKE Autopilot](../labs/Payload_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Payload CMS sur Google Cloud Run](Payload_CloudRun.md) — la même application sur Cloud Run, si vous avez besoin de l'autre cible de déploiement.
- [Payload Common — Configuration applicative partagée](Payload_Common.md) — la configuration partagée par les deux cibles de déploiement.
