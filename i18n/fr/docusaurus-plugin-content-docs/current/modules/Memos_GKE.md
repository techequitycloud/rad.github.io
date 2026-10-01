---
title: "Memos sur GKE Autopilot"
description: "Référence de configuration pour déployer Memos sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Memos_GKE.md @ 3055034 sha256:999b390d64df -->

# Memos sur GKE Autopilot {#memos-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Memos_GKE.png" alt="Memos sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Memos est un service de prise de notes open source, sous licence MIT et auto-hébergé,
conçu pour la saisie rapide en markdown — un unique binaire Go d'environ 20MB doté d'un
frontend React. Ce module déploie Memos sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et
Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise Memos et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande.
Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress,
mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Memos s'exécute comme une unique charge de travail web Go. Le déploiement assemble un
ensemble volontairement restreint de services Google Cloud — Memos n'a ni file
d'attente, ni cache, ni workers d'arrière-plan :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pod Go, 1 vCPU / 512 MiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — ce module standardise sur Postgres via une unique URL de connexion `MEMOS_DSN` |
| Stockage d'objets | aucun | Non provisionné par ce module — voir la remarque sur les pièces jointes ci-dessous |
| Cache et file d'attente | aucun | Memos ne dépend d'aucune file d'attente ni d'aucun cache |
| Secrets | Secret Manager | Uniquement le mot de passe de la base de données (géré par le socle) ; Memos lui-même n'a aucun secret applicatif |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé + certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL est le moteur standardisé.** `Memos_Common` fixe
  `database_type = "POSTGRES_15"`.
- **Il n'existe aucun secret d'amorçage administrateur.** Le **premier compte créé via
  l'interface web devient l'hôte/administrateur** — il n'y a aucune variable
  d'environnement de type `DEFAULTUSER` et rien à récupérer dans Secret Manager pour la
  première connexion.
- **`workload_type = "Deployment"`, et non `StatefulSet`.** Memos ne conserve aucun état
  local devant survivre au redémarrage d'un pod au-delà de ce qui se trouve déjà dans
  Cloud SQL — aucun PVC ni montage NFS n'est requis.
- **L'affinité de session n'est pas requise.** Memos n'a aucun état WebSocket en
  processus lié à un pod précis (contrairement aux schémas de push en direct
  d'Activepieces ou de Gotify), donc la valeur par défaut `session_affinity = "None"`
  est correcte.
- **`min_instance_count = 0` / `max_instance_count = 1`.** GKE Autopilot facture par
  pod en cours d'exécution ; le HPA peut réduire à zéro réplica en période d'inactivité.
- **Le DSN de la base de données est calculé au démarrage du conteneur**, et non intégré
  à l'image. `memos-entrypoint.sh` lit les variables `DB_*` injectées par la plateforme —
  sur GKE, `DB_HOST` arrive sous la forme `127.0.0.1` (le sidecar cloud-sql-proxy) — et
  construit l'unique URL de connexion `MEMOS_DSN` qu'attend Memos.
- **Aucun stockage d'objets n'est provisionné.** Ce module ne déclare ni bucket GCS, ni
  volume, ni PVC pour les pièces jointes téléversées. Les notes texte sont entièrement
  conservées dans PostgreSQL, mais les pièces jointes binaires résideraient sur le
  système de fichiers éphémère du pod et ne survivraient **pas** à un redémarrage du pod.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Memos {#a-gke-autopilot--the-memos-workload}

Les pods Memos sont planifiés sur Autopilot, qui facture le processeur et la mémoire
réellement demandés par les pods. L'autoscaling horizontal des pods dimensionne le
déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Memos
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et
du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Memos stocke toutes les données applicatives (notes, tags, utilisateurs, métadonnées des
ressources) dans une instance gérée Cloud SQL for PostgreSQL 15. Les pods y accèdent de
manière privée via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` ; aucune adresse
IP publique n'est exposée. Lors du premier déploiement, un job d'initialisation crée
la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe
figurent dans les [sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour le modèle
de connexion, les sauvegardes et la rotation des mots de passe.

### C. Secret Manager {#c-secret-manager}

Seul le secret du mot de passe de la base de données existe pour ce module — il est
entièrement géré par le socle, et non par `Memos_Common`. Memos génère sa propre clé
interne de signature de session et la stocke dans sa propre base de données au premier
démarrage.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~memos"
  gcloud secrets versions access latest --secret=<db-password-secret-name> --project "$PROJECT"
  ```

### D. Réseau et entrée {#d-networking--ingress}

Le service est exposé via un Service Kubernetes (`LoadBalancer` par défaut) doté d'une
adresse IP externe. Une Gateway/un Ingress avec un domaine personnalisé et un certificat
TLS géré peut y être ajouté.

- **Console :** Kubernetes Engine → Services & Ingress ; Network services → Load
  balancing.
- **CLI :**
  ```bash
  kubectl get svc -n "$NAMESPACE" -o wide
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md).

### E. Cloud Logging et Monitoring {#e-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques de GKE et de
Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100 -f
  ```

---

## 3. Comportement de l'application Memos {#3-memos-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `create-db-and-user.sh` avec `postgres:15-alpine`. Il se
  connecte via le sidecar cloud-sql-proxy et crée de manière idempotente le rôle et la
  base de données de l'application. Le job peut être relancé sans risque.
- **Migrations de schéma au démarrage.** Memos applique sa propre mise en place du
  schéma par auto-migration GORM à chaque démarrage de pod — aucun job de migration
  distinct n'est nécessaire.
- **Aucun identifiant d'amorçage administrateur à récupérer.** Le premier compte créé
  via le formulaire d'inscription de l'interface web devient l'hôte/administrateur.
- **Le DSN de la base de données est calculé, et non statique.** `memos-entrypoint.sh`
  construit `MEMOS_DSN` à partir de `DB_HOST`/`DB_PORT`/`DB_USER`/`DB_NAME`/`DB_PASSWORD`
  au démarrage du conteneur — la branche de boucle locale (`DB_HOST=127.0.0.1`,
  `sslmode=disable`) est retenue sur GKE, puisque le sidecar cloud-sql-proxy termine déjà
  le TLS. Consultez [Memos_Common](Memos_Common.md) pour la logique d'embranchement
  complète.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/` — la page
  publique de connexion/d'accueil de Memos, accessible sans authentification.
- **Inspecter l'exécution des jobs :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres propres à Memos ou notables pour lui sont listés ;
toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement
standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du cluster et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `memos` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `Memos` | Nom lisible affiché dans la console. |
| `application_description` | `Memos note-taking service on GKE` | Description de la charge de travail. |
| `application_version` | `latest` | Tag de suivi du déploiement. `Memos_Common` associe `"latest"` à l'argument de build Dockerfile épinglé `MEMOS_VERSION = "0.28.0"`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper avec le point d'entrée qui calcule le DSN. |
| `cpu_limit` | `1000m` | Processeur par pod. |
| `memory_limit` | `512Mi` | Mémoire par pod — suffisante pour l'empreinte réduite de Memos. |
| `min_instance_count` | `0` | minReplicas du HPA. |
| `max_instance_count` | `1` | maxReplicas du HPA ; augmentez-le pour une charge simultanée plus élevée. |
| `container_port` | `5230` | Port natif par défaut de Memos — aucun remappage n'est effectué. |
| `enable_cloudsql_volume` | `true` | Sidecar cloud-sql-proxy pour les connexions par socket. |
| `enable_image_mirroring` | `true` | Met en miroir l'image Memos dans Artifact Registry. |
| `session_affinity` | `None` | Aucune session au niveau du pod n'est requise. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

Paramètres standard d'exposition du service et d'IAP d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `service_type` (`LoadBalancer` par défaut),
`enable_iap`, `iap_authorized_users`.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Toute valeur `MEMOS_*` documentée par Memos peut être définie ici. La connexion à la base de données (`MEMOS_DSN`, `MEMOS_DRIVER`) est calculée automatiquement — ne les définissez pas ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production. |
| `enable_backup_import` | `false` | Restaure à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build standard d'App_GKE — consultez [App_GKE](App_GKE.md).

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `storage_buckets` | `[]` | Aucun bucket provisionné par défaut. |
| `enable_nfs` | `false` | Non utilisé — Memos ne conserve aucun état hors de PostgreSQL dans le câblage de ce module. |
| `stateful_pvc_enabled` | `null` | Non défini, donc la logique de résolution propre à `App_GKE` s'applique (aucun PVC). Memos est sans état au niveau du pod ; aucun PVC bloc n'est nécessaire. |
| `gcs_volumes` | `[]` | Ajoutez ici une entrée (montée sur le répertoire de données de Memos) si la persistance des pièces jointes est requise. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé par `Memos_Common`. |
| `application_database_name` | `memos` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `application_database_user` | `memos` | Utilisateur de la base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job intégré `db-init`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/` délai de 30s | Sonde de démarrage — cible la page de connexion publique. |
| `liveness_probe` | HTTP `/` délai de 30s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false }` | Test de disponibilité Cloud Monitoring ; nécessite un point de terminaison joignable publiquement. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms Kubernetes. |
| `service_cluster_ip` | ClusterIP du Service. |
| `service_external_ip` | Adresse IP externe du LoadBalancer (lorsque `service_type = "LoadBalancer"`). |
| `service_url` | URL du service déployé. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés — vide par défaut. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` | Noms des jobs de configuration (inclut `db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `kubernetes_ready` | Indique si la charge de travail Kubernetes a atteint l'état Ready. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données. |
| Premier compte créé via l'inscription | Créez-le immédiatement après le déploiement | Critique | Le **premier** compte à s'inscrire devient hôte/administrateur — si l'inscription reste ouverte, le premier visiteur qui atteint l'adresse IP externe s'arroge ce rôle. |
| Inscription publique en libre-service | Désactivez-la après la création du premier administrateur | Élevé | Memos est livré avec l'inscription ouverte par défaut. |
| `container_image_source` | `custom` (par défaut) | Élevé | `"prebuilt"` déploie directement l'image officielle, qui ne contient aucune logique de calcul de `MEMOS_DSN` — celui-ci doit être câblé manuellement, sinon le pod passe en CrashLoopBackOff sur un échec de connexion à la base de données. |
| `stateful_pvc_enabled` | `false` (par défaut) | Faible | Memos n'a besoin d'aucun stockage bloc ; l'activer consomme inutilement du quota SSD. |
| `gcs_volumes` pour les pièces jointes | Ajoutez-le explicitement si nécessaire | Moyen | Sans lui, les pièces jointes binaires téléversées résident sur le système de fichiers éphémère du pod et ne survivent pas à un redémarrage du pod. |
| `min_instance_count` | `0` (par défaut) | Faible | La réduction à zéro retarde brièvement la première requête après une période d'inactivité, le temps qu'un nouveau pod soit planifié — démarrage à froid d'Autopilot, et non bogue de l'application. |

---

Pour le comportement du socle évoqué tout au long de ce guide — Workload Identity,
ingress, mise à l'échelle automatique, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La
configuration applicative propre à Memos partagée avec la variante Cloud Run est décrite
dans **[Memos_Common](Memos_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Memos sur GKE Autopilot](../labs/Memos_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Memos sur Google Cloud Run](Memos_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Memos Common — Configuration applicative partagée](Memos_Common.md) — la configuration partagée par les deux cibles de déploiement.
