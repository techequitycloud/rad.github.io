---
title: "Memos sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Memos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Memos_GKE.md @ 15fd4c7 sha256:2ad033baed3c -->

# Memos sur GKE Autopilot {#memos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_GKE.png" alt="Memos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos est un service de prise de notes auto-hébergé, open-source, sous licence
MIT, conçu pour la capture rapide de markdown — un binaire Go unique d'environ
20 Mo avec un frontend React. Ce module déploie Memos sur **GKE Autopilot**
au-dessus de la fondation [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure partagée de Google Cloud et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par Memos et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application GKE —
Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et le cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Memos s'exécute comme une seule charge de travail web Go. Le déploiement
connecte un ensemble délibérément restreint de services Google Cloud — Memos
n'a pas de file d'attente, pas de cache et pas de workers en arrière-plan :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go, 1 vCPU / 512 MiB par défaut, autoscalé horizontalement |
| Base de données | Cloud SQL for PostgreSQL 15 | Requis — ce module standardise sur Postgres via une seule URL de connexion `MEMOS_DSN` |
| Stockage d'objets | aucun | Non provisionné par ce module — voir la note sur les pièces jointes ci-dessous |
| Cache et file d'attente | aucun | Memos n'a pas de dépendance de file d'attente ou de cache |
| Secrets | Secret Manager | Seulement le mot de passe de la base de données (géré par la Fondation) ; Memos lui-même n'a pas de secret au niveau de l'application |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Memos_Common` corrige
  `database_type = "POSTGRES_15"`.
- **Aucun secret d'amorçage administrateur n'existe.** Le **premier compte créé
  via l'interface web devient l'hôte/administrateur** — il n'y a pas de variable
  d'environnement de type `DEFAULTUSER` et rien à récupérer de Secret Manager pour la
  première connexion.
- **`workload_type = "Deployment"`, pas `StatefulSet`.** Memos ne conserve aucun état
  local qui doit survivre à un redémarrage de pod au-delà de ce qui est déjà dans
  Cloud SQL — pas de PVC, pas de montage NFS requis.
- **L'affinité de session n'est pas requise.** Memos n'a pas d'état WebSocket
  en cours de traitement lié à un pod spécifique (contrairement aux modèles de
  push en direct d'Activepieces ou de Gotify), donc la valeur par défaut
  `session_affinity = "None"` est correcte.
- **`min_instance_count = 0` / `max_instance_count = 1`.** GKE Autopilot facture par
  pod en cours d'exécution ; le HPA peut réduire à zéro réplica lorsqu'il est
  inactif.
- **Le DSN de la base de données est calculé au démarrage du conteneur**, non
  intégré à l'image. `memos-entrypoint.sh` lit les variables `DB_*` injectées
  par la plateforme — sur GKE, `DB_HOST` arrive comme `127.0.0.1` (le
  sidecar cloud-sql-proxy) — et construit l'URL de connexion unique `MEMOS_DSN`
  que Memos attend.
- **Aucun stockage d'objets n'est provisionné.** Ce module ne déclare pas de
  bucket GCS, de volume ou de PVC pour les pièces jointes de fichiers
  téléchargées. Les notes textuelles persistent entièrement dans PostgreSQL, mais
  les pièces jointes binaires vivraient sur le système de fichiers éphémère du
  pod et ne survivraient **pas** à un redémarrage de pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les
autres identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Memos {#a-gke-autopilot--the-memos-workload}

Les pods Memos sont planifiés sur Autopilot, qui facture le CPU/la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne
le déploiement entre les nombres minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de
  travail Memos pour voir les pods, les révisions et les événements. Kubernetes
  Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de l'autoscaling et du
type de charge de travail (Deployment vs StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Memos stocke toutes les données de l'application (notes, tags, utilisateurs,
métadonnées des ressources) dans une instance Cloud SQL for PostgreSQL 15 gérée.
Les pods l'atteignent en privé via le sidecar **Cloud SQL Auth Proxy** sur
`127.0.0.1` ; aucune IP publique n'est exposée. Lors du premier déploiement,
un job d'initialisation crée la base de données et l'utilisateur de
l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md)
pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le secret du mot de passe de la base de données existe pour ce module —
entièrement géré par la Fondation, et non par `Memos_Common`. Memos génère sa
propre clé de signature de session interne et la stocke dans sa propre base de
données au premier démarrage.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Réseau et ingress {#d-networking--ingress}

Le service est exposé via un service Kubernetes (`LoadBalancer` par défaut) avec
une IP externe. Une Gateway/Ingress avec un domaine personnalisé et un
certificat TLS géré peut être ajoutée.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services → Load
  balancing.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et
des politiques d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Memos {#3-memos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` en utilisant `postgres:15-alpine`. Il
  se connecte via le sidecar cloud-sql-proxy et crée de manière idempotente le
  rôle et la base de données de l'application. Le job peut être réexécuté en
  toute sécurité.
- **Migrations de schéma au démarrage.** Memos applique sa propre configuration
  de schéma GORM auto-migrée interne à chaque démarrage de pod — aucun job de
  migration séparé n'est nécessaire.
- **Aucune information d'identification d'amorçage administrateur à récupérer.**
  Le premier compte créé via le formulaire d'inscription de l'interface web
  devient l'hôte/administrateur.
- **Le DSN de la base de données est calculé, non statique.** `memos-entrypoint.sh`
  construit `MEMOS_DSN` à partir de `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD` au
  démarrage du conteneur — la branche de bouclage (`DB_HOST=127.0.0.1`, `sslmode=disable`)
  est prise sur GKE, car le sidecar cloud-sql-proxy termine déjà le TLS. Voir
  [Memos_Common](Memos_Common.md) pour la logique de branchement complète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/` — la page de connexion/d'accueil publique de Memos, accessible
  sans authentification.
- **Inspecter l'exécution du job :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Memos sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le cluster et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `memos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Memos` | Nom lisible par l'homme affiché dans la Console. |
| `application_description` | `Memos note-taking service on GKE` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Memos_Common` mappe `"latest"` à l'argument de build Dockerfile épinglé `MEMOS_VERSION = "0.28.0"`. |

### Groupe 4 — Exécution et scaling {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper avec le point d'entrée DSN calculé. |
| `cpu_limit` | `1000m` | CPU par pod. |
| `memory_limit` | `512Mi` | Mémoire par pod — suffisante pour la petite empreinte de Memos. |
| `min_instance_count` | `0` | HPA minReplicas. |
| `max_instance_count` | `1` | HPA maxReplicas ; augmentez pour une charge concurrente plus élevée. |
| `container_port` | `5230` | Port natif par défaut de Memos — aucune remappage effectué. |
| `enable_cloudsql_volume` | `true` | Sidecar cloud-sql-proxy pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Memos dans Artifact Registry. |
| `session_affinity` | `None` | Aucune session au niveau du pod requise. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

Exposition de service App_GKE standard et paramètres IAP — voir
[App_GKE](App_GKE.md). Entrées clés : `service_type` (`LoadBalancer` par
défaut), `enable_iap`, `iap_authorized_users`.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Toute valeur `MEMOS_*` documentée par Memos peut être définie ici. La connexion à la base de données (`MEMOS_DSN`, `MEMOS_DRIVER`) est calculée automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production. |
| `enable_backup_import` | `false` | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build App_GKE standard — voir [App_GKE](App_GKE.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Aucun bucket provisionné par défaut. |
| `enable_nfs` | `true` | Non utilisé — Memos ne conserve aucun état en dehors de PostgreSQL dans le câblage de ce module. |
| `stateful_pvc_enabled` | `null` | Non défini, donc la propre logique de résolution de `App_GKE` s'applique (pas de PVC). Memos est sans état au niveau du pod ; aucun PVC de bloc n'est nécessaire. |
| `gcs_volumes` | `[]` | Ajoutez une entrée ici (montée dans le répertoire de données de Memos) si la persistance des pièces jointes est requise. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES` | Fixé par `Memos_Common`. |
| `application_database_name` | `memos` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `memos` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` 30s de délai | Sonde de démarrage — cible la page de connexion publique. |
| `liveness_probe` | HTTP `/` 30s de délai | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; nécessite un point de terminaison publiquement accessible. |

### Groupe 22 — VPC Service Controls et Audit Logging {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP du service. |
| `service_external_ip` | IP externe du LoadBalancer (lorsque `service_type = "LoadBalancer"`). |
| `service_url` | URL du service déployé. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés — vides par défaut. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` | Noms des jobs de configuration (inclut `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `kubernetes_ready` | Indique si la charge de travail Kubernetes a atteint l'état Prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de l'audit logging et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| Premier compte créé via l'inscription | Créez-le immédiatement après le déploiement | Critique | Le **premier** compte à s'inscrire devient l'hôte/administrateur — s'il est laissé ouvert, tout visiteur qui atteint l'IP externe en premier revendique ce rôle. |
| Auto-inscription publique | Désactiver après le premier administrateur | Élevé | Memos est livré avec l'inscription ouverte par défaut. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, qui n'a pas de logique pour calculer `MEMOS_DSN` — elle doit être câblée manuellement ou le pod CrashLoopBackOffs en cas d'échec de connexion à la base de données. |
| `stateful_pvc_enabled` | `false` (par défaut) | Faible | Memos n'a pas besoin de stockage de blocs ; l'activer ajoute une consommation inutile de quota SSD. |
| `gcs_volumes` pour les pièces jointes | Ajouter explicitement si nécessaire | Moyen | Sans cela, les pièces jointes binaires téléchargées vivent sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage de pod. |
| `min_instance_count` | `0` (par défaut) | Faible | La mise à l'échelle à zéro retarde brièvement la première requête après l'inactivité pendant la planification d'un nouveau pod — démarrage à froid d'Autopilot, pas un bug de l'application. |

---

Pour le comportement de la fondation référencé tout au long — Workload Identity,
ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC,
sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La
configuration d'application spécifique à Memos partagée avec la variante Cloud
Run est décrite dans **[Memos_Common](Memos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Memos sur GKE Autopilot](../labs/Memos_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Memos sur Google Cloud Run](Memos_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Memos Common — Configuration d'application partagée](Memos_Common.md) — la configuration partagée par les deux cibles de déploiement.
