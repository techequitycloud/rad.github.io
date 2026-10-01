---
title: "Authentik sur GKE Autopilot"
description: "Référence de configuration pour déployer Authentik sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Authentik_GKE.md @ 3055034 sha256:63d79d9ca82e -->

# Authentik sur GKE Autopilot {#authentik-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Authentik_GKE.png" alt="Authentik sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

authentik ([goauthentik.io](https://goauthentik.io/)) est un fournisseur d'identité open source (MIT,
open-core) : authentification unique via OIDC et SAML, LDAP et SCIM,
authentification multifacteur et authentification par proxy — une alternative auto-hébergée
à Okta, Auth0 et Keycloak. Ce module déploie authentik sur **GKE Autopilot** en
s'appuyant sur le socle [App_GKE](App_GKE.md), qui provisionne et gère
l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise authentik et sur la manière de les explorer et de
les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

authentik s'exécute comme un Deployment Python/Django sur GKE Autopilot, avec son worker
d'arrière-plan (`ak worker`) co-localisé dans le même conteneur du pod. Le déploiement assemble
un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Deployment, 2 vCPU / 4 GiB par défaut, 1–5 réplicas |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — authentik exige PostgreSQL ≥ 14 ; MySQL est bloqué |
| Cache et file d'attente | **Aucun — pas de Redis** | authentik ≥ 2025.10 a déplacé le cache, les sessions, la file de tâches et la couche de canaux WebSocket dans PostgreSQL |
| Stockage des médias | Cloud Storage (GCS Fuse CSI) | Bucket monté sur `/media` pour les icônes téléversées et les arrière-plans de flux |
| Secrets | Secret Manager | `AUTHENTIK_SECRET_KEY` stable, mot de passe d'amorçage `akadmin`, mot de passe de la base de données |
| Image | Artifact Registry + Cloud Build | Build personnalisé léger `FROM ghcr.io/goauthentik/server` (point d'entrée cloud + lanceur du worker) |
| Ingress | Cloud Load Balancing | Service LoadBalancer externe ; domaine personnalisé et certificat géré en option |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire et constitue le *seul* magasin de données.** Pas de Redis, pas de moteur
  de recherche — les sessions, le cache et la file de tâches résident tous dans Cloud SQL.
- **Le worker est co-localisé.** Le point d'entrée du conteneur démarre `ak worker` en
  arrière-plan à côté du serveur (le même schéma que le worker Sidekiq de Chatwoot) —
  pas de Deployment de worker distinct. Conservez `min_instance_count ≥ 1` pour que le worker
  traite en permanence.
- **`max_instance_count = 5`.** authentik est sans état d'un pod à l'autre — tout l'état est
  dans PostgreSQL — si bien que plusieurs réplicas (chacun avec son propre worker) sont sûrs.
- **`AUTHENTIK_SECRET_KEY` est générée automatiquement** et stockée dans Secret
  Manager. Elle doit rester stable — la renouveler invalide toutes les sessions et rend
  illisibles les champs chiffrés. Les deux noms de secrets sont simples (sans `__`) et
  passent donc la validation `targetKey` de SecretSync sur GKE ; le mappage
  `AUTHENTIK_POSTGRESQL__*` s'effectue dans le point d'entrée à partir des variables `DB_*` injectées.
- **Le compte administrateur `akadmin` est amorcé au premier démarrage** avec
  `bootstrap_email` (par défaut `admin@techequity.cloud`) et un mot de passe adossé à Secret Manager.
  Les variables d'amorçage ne s'appliquent qu'au **premier** démarrage.
- **`application_version = "latest"` est épinglé.** authentik ne publie aucun tag `latest`
  sur GHCR ; le build épingle `latest` sur une version éprouvée (`2026.5.4`) via
  l'ARG de build propre à l'application `AUTHENTIK_VERSION`.
- **Les migrations s'exécutent automatiquement au démarrage**, protégées par un verrou consultatif
  PostgreSQL afin que des pods concurrents n'entrent pas en collision — pas de tâche de migration distincte.
- **Les points de terminaison de santé ne sont pas authentifiés** : démarrage `GET /-/health/ready/`,
  vivacité `GET /-/health/live/`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail authentik {#a-gke-autopilot--the-authentik-workload}

Les pods authentik sont planifiés sur Autopilot, qui facture le CPU et la mémoire demandés
par les pods. L'autoscaling horizontal des pods dimensionne le Deployment entre le nombre minimal et
maximal de réplicas. Chaque pod exécute le serveur, le worker d'arrière-plan et le
sidecar Cloud SQL Auth Proxy.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail authentik pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche
  l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> -c <app-container> --tail=100
  kubectl describe hpa -n "$NAMESPACE"
  ```

Consultez [App_GKE](App_GKE.md) pour Autopilot, la mise à l'échelle et la gestion du type de charge de travail.

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

authentik stocke *tout* ici — utilisateurs, groupes, flux, fournisseurs, sessions,
cache et file de tâches d'arrière-plan. Les pods atteignent l'instance de manière privée via
le sidecar **Cloud SQL Auth Proxy** ; le point d'entrée du conteneur mappe les variables
`DB_*` injectées sur la convention `AUTHENTIK_POSTGRESQL__*` d'authentik et définit
le mode SSL selon le type de connexion — `disable` pour le TCP loopback du sidecar proxy
(`127.0.0.1` / `localhost` ; le proxy termine le TLS mais ne parle pas SSL
lui-même, si bien qu'exiger SSL à cet endroit échoue avec « server does not support SSL, but SSL
was required »), `require` uniquement pour une connexion TCP directe vers tout autre hôte. Lors du premier déploiement,
une unique tâche (Job) `db-init` crée la base de données et le rôle propres au locataire.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe figurent dans les
[sorties](#5-outputs) (les noms de la base de données et de l'utilisateur sont préfixés par le locataire). Consultez
[App_GKE](App_GKE.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage — médias {#c-cloud-storage--media}

Un bucket dédié est monté sur `/media` via le pilote CSI GCS Fuse pour les médias
téléversés (icônes d'applications, arrière-plans de flux), afin que les téléversements survivent au remplacement des pods
et à la mise à l'échelle.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/        # bucket name is in the Outputs
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets authentik sont générés automatiquement :

- `AUTHENTIK_SECRET_KEY` — signe les sessions/cookies et sert à dériver le chiffrement
  interne. **Ne la renouvelez jamais.**
- `AUTHENTIK_BOOTSTRAP_PASSWORD` — le mot de passe initial de `akadmin`, appliqué
  uniquement au premier démarrage.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~authentik"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [Authentik_Common](Authentik_Common.md) pour le modèle complet des secrets et
[App_GKE](App_GKE.md) pour les détails de SecretSync.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP LoadBalancer externe ; un domaine
personnalisé avec un certificat géré par Google peut être activé, et une IP statique est
réservée par défaut afin que l'adresse survive aux redéploiements. Pour un IdP, un nom d'hôte stable
et protégé par TLS est important — les URI de redirection OIDC/SAML que vous enregistrez dans les applications
clientes doivent correspondre à l'URL par laquelle les utilisateurs atteignent authentik.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux du serveur **et du worker** arrivent tous deux dans Cloud Logging (ils partagent le
stdout/stderr du conteneur). Les métriques de GKE et de Cloud SQL arrivent dans Cloud Monitoring.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application authentik {#3-authentik-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un unique job d'initialisation exécute `db-init.sh`
  avec `postgres:15-alpine` : il attend PostgreSQL, crée le rôle et la base de données
  propres au locataire, accorde les privilèges, accorde `cloudsqlsuperuser` par précaution,
  et signale au sidecar proxy de s'arrêter pour que la tâche se termine. Idempotent et
  réexécutable sans risque.
- **Démarrage avec auto-migration.** Le serveur authentik exécute ses propres migrations Django à
  chaque démarrage, protégées par un verrou consultatif PostgreSQL afin que des pods concurrents n'entrent pas
  en collision. Il n'existe pas de tâche de migration distincte. Le premier démarrage exécute la suite complète —
  comptez plusieurs minutes avant que `/-/health/ready/` ne renvoie 200 ; la sonde de démarrage
  accorde environ 11 minutes.
- **Première connexion.** Connectez-vous en tant que **`akadmin`** avec la valeur de `bootstrap_email` et
  le mot de passe du secret `...-bootstrap-password`. Si les variables d'amorçage
  étaient absentes lors du premier démarrage, terminez plutôt la configuration sur
  `<service-url>/if/flow/initial-setup/`.
- **Les applications et les fournisseurs se configurent dans l'application après le déploiement.** Les fournisseurs
  OIDC/SAML, les applications, les outposts et les flux relèvent de la configuration d'authentik, et non
  des entrées Terraform — créez-les dans l'interface d'administration (`<service-url>/if/admin/`)
  une fois la charge de travail prête.
- **Co-localisation du worker.** `ak worker` s'exécute dans le même conteneur que le serveur ;
  ses lignes de journal sont entremêlées dans les journaux du pod
  (`kubectl logs ... | grep -i worker`). Conservez `min_instance_count ≥ 1` pour que
  les tâches planifiées et la synchronisation des outposts continuent d'être traitées.
- **Points de terminaison de santé.**
  ```bash
  curl -s "$SERVICE_URL/-/health/ready/" -o /dev/null -w '%{http_code}\n'   # 200 = migrated + DB reachable
  curl -s "$SERVICE_URL/-/health/live/"  -o /dev/null -w '%{http_code}\n'   # 200 = process alive
  ```
- **Inspecter l'exécution des tâches :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres propres à authentik ou notables pour lui sont listés ; toutes les autres entrées sont
héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région de la charge de travail et des ressources régionales. |
| `bootstrap_email` | `admin@techequity.cloud` | E-mail du compte intégré `akadmin`, défini au premier démarrage. |
| `bootstrap_password` | `""` (généré automatiquement) | Mot de passe initial de `akadmin`. **Premier démarrage uniquement** ; stocké dans Secret Manager. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `authentik` | Nom de base des ressources (espace de noms, secrets, buckets). Ne le modifiez pas après le premier déploiement. |
| `application_display_name` | `authentik Identity Provider` | Nom lisible. |
| `application_version` | `latest` | Tag de version d'authentik ; `latest` est épinglé sur `2026.5.4` au moment du build (aucun tag `latest` en amont). Épinglez explicitement en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Image enveloppe légère construite via Cloud Build (ajoute le point d'entrée cloud + le lanceur du worker). |
| `min_instance_count` | `1` | Conservez ≥ 1 pour que le worker co-localisé continue de traiter. |
| `max_instance_count` | `5` | Peut être augmenté sans risque — authentik est sans état d'un pod à l'autre. |
| `container_port` | `9000` | Port HTTP d'authentik (le Service expose 80). |
| `container_resources` | `2000m` / `4Gi` | Partagées par le serveur et le worker ; la valeur par défaut d'Autopilot laisse de la marge pour les migrations. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy — conservez `true` sur GKE. |
| `enable_image_mirroring` | `true` | L'image de base GHCR est mise en miroir dans Artifact Registry. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `AUTHENTIK_*` supplémentaires (p. ex. e-mail/SMTP : `AUTHENTIK_EMAIL__HOST`, …). Ne définissez pas `AUTHENTIK_SECRET_KEY` ni `AUTHENTIK_POSTGRESQL__*` ici. |
| `secret_environment_variables` | `{}` | Table de correspondance variable d'environnement → nom de secret Secret Manager. Les clés ne doivent pas contenir `__` (CRD SecretSync). |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour le SSO navigateur et les rappels OAuth. |
| `workload_type` | `Deployment` (auto) | authentik est sans état ; un StatefulSet est inutile. |
| `session_affinity` | `ClientIP` | Le routage persistant aide les connexions WebSocket de l'interface d'administration. |
| `termination_grace_period_seconds` | `60` | Délai de grâce pour les tâches du worker en cours lors de l'arrêt. |

### Groupe 8 — Quota de ressources {#group-8--resource-quota}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_resource_quota` | `false` | Si vous l'activez, dimensionnez les demandes à ≥ 2× un pod et utilisez des suffixes de mémoire binaires (`"8Gi"`). |

### Groupe 9 — Règles de fiabilité {#group-9--reliability-policies}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Protège la disponibilité des connexions pendant les mises à niveau des nœuds. |
| `pdb_min_available` | `1` | Nombre minimal de pods pendant les interruptions volontaires. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/-/health/ready/`, délai 60s, 40×15s | Non authentifiée. Seuil généreux pour les migrations du premier démarrage (budget d'environ 11 min). |
| `liveness_probe` | HTTP `/-/health/live/`, délai 60s, 3×30s | Vérification non authentifiée que le processus est vivant. |
| `uptime_check_config` | désactivé | Test de disponibilité Cloud Monitoring facultatif (pointez-le vers `/-/health/live/`). |

### Groupe 11 — Jobs et tâches planifiées {#group-11--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser l'unique tâche intégrée `db-init`. |
| `cron_jobs` | `[]` | Inutile — le worker co-localisé exécute les tâches planifiées d'authentik. |
| `additional_services` | `[]` | À utiliser pour des outposts supplémentaires (p. ex. LDAP/RADIUS) si nécessaire. |

### Groupe 12 — CI/CD et intégration GitHub {#group-12--cicd--github-integration}

Intégration Cloud Build / Cloud Deploy standard d'App_GKE — consultez
[App_GKE](App_GKE.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Facultatif ; authentik conserve les médias sur GCS, pas sur NFS. |
| `nfs_mount_path` | `/opt/authentik/storage` | Chemin de montage dans le conteneur. |

### Groupe 14 — Cloud Storage et Artifact Registry {#group-14--cloud-storage--artifact-registry}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Le bucket `/media` est déclaré par `Authentik_Common`. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires ; `/media` est ajouté automatiquement. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définis)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 15 — Redis {#group-15--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Sans effet.** authentik ≥ 2025.10 a entièrement supprimé Redis ; `main.tf` fixe `enable_redis = false`. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | authentik exige PostgreSQL — les valeurs MySQL sont rejetées par la validation. |
| `application_database_name` | `authentik` | Nom de base de la base de données (préfixé par le locataire au déploiement). Immuable après le premier déploiement. |
| `application_database_user` | `authentik` | Nom de base de l'utilisateur applicatif de la base de données (préfixé par le locataire). |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 17 — Sauvegarde et maintenance {#group-17--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatique (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez-la pour la production ou la conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_domain` | `true` | Ingress + certificat géré pour les noms d'hôte personnalisés. |
| `application_domains` | `[]` | Nom(s) d'hôte à servir. Enregistrez les URI de redirection OIDC sur le domaine que les utilisateurs atteignent réellement. |
| `reserve_static_ip` | `true` | IP externe stable d'un redéploiement à l'autre — important pour les noms d'hôte d'IdP fixés dans le DNS. |

### Groupe 20 — Identity-Aware Proxy (IAP) {#group-20--identity-aware-proxy-iap}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | IAP devant un IdP impose un double contrôle à chaque connexion et casse les rappels OAuth/SAML — laissez-le désactivé sauf si vous savez en avoir besoin. |

### Groupe 21 — Cloud Armor {#group-21--cloud-armor}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Politique WAF sur le backend de l'Ingress — recommandée pour un IdP public. |
| `admin_ip_ranges` | `[]` | Plages CIDR autorisées pour l'accès privilégié. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Table des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP LoadBalancer externe. |
| `service_url` | URL permettant d'atteindre authentik. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données applicative (préfixés par le locataire). |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/media`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` / `github_repository_*` | État et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `AUTHENTIK_SECRET_KEY` (générée automatiquement) | Ne jamais la renouveler | Critique | La renouveler invalide **toutes** les sessions actives et rend illisibles les champs chiffrés (identifiants stockés, jetons). |
| `database_type` | `POSTGRES_15` | Critique | MySQL est bloqué par la validation — authentik exige PostgreSQL ≥ 14. |
| `application_database_name` / `application_database_user` | À définir une seule fois | Critique | Immuables après le premier déploiement ; les renommer recrée la base de données/l'utilisateur et détruit toutes les données d'identité. |
| Ports d'écoute du worker (gérés par le point d'entrée) | Conservez les valeurs loopback par défaut `AUTHENTIK_LISTEN__*` du point d'entrée | Critique | Le `ak worker` co-localisé démarre lui aussi un écouteur HTTP et hérite du `0.0.0.0:9000` par défaut du serveur ; s'il remporte la course au bind, il répond à **toutes** les routes — y compris les points de terminaison de santé — par des 200 vides : une interface vide alors que les sondes du kubelet semblent vertes. Le point d'entrée épingle le worker sur des ports loopback (`127.0.0.1:9001`/`9444`/`9301`) afin que le serveur détienne `:9000` — un 200 avec un corps vide signifie que le mauvais processus a répondu. |
| `min_instance_count` | `≥ 1` | Élevé | `0` n'a pas de sens pour le worker co-localisé — les tâches d'arrière-plan et la synchronisation des outposts s'arrêtent ; les WebSockets des outposts se déconnectent. |
| Clés de `secret_environment_variables` | Noms simples, sans `__` | Élevé | La CRD SecretSync rejette à l'apply les clés contenant `__` (p. ex. `AUTHENTIK_POSTGRESQL__PASSWORD`) — ce mappage relève du point d'entrée, pas d'un secret synchronisé. |
| `startup_probe.path` | `/-/health/ready/` (non authentifié) | Moyen | Pointer la sonde vers une page authentifiée renvoie 401/403 au kubelet — le pod ne devient jamais prêt alors qu'authentik a bien démarré. |
| `bootstrap_password` / `bootstrap_email` | À définir avant le premier déploiement | Moyen | Appliqués au **premier** démarrage uniquement. Les modifier ensuite n'a aucun effet — gérez `akadmin` dans l'application, ou utilisez `/if/flow/initial-setup/` si les variables d'amorçage étaient absentes au premier démarrage. |
| `application_version` | Épingler une version | Moyen | `latest` est épinglé silencieusement sur `2026.5.4` ; un épinglage explicite rend les montées de version délibérées. Des tags inexistants font échouer le Cloud Build avec `MANIFEST_UNKNOWN`. |
| `quota_memory_requests` / `_limits` | Unités binaires (`8Gi`), ≥ 2× un pod | Critique | Des entiers nus sont des octets et bloquent toute planification de pods ; un quota dimensionné pour un seul pod bloque les mises à jour progressives. |
| `environment_variables` → `AUTHENTIK_POSTGRESQL__*` | Laisser non défini | Moyen | Le point d'entrée mappe les valeurs `DB_*` injectées ; coder en dur des noms de base de données courts entraîne une authentification avec un rôle inexistant (les noms sont préfixés par le locataire). |
| `enable_iap` | `false` | Moyen | IAP impose un double contrôle à chaque connexion et casse les rappels OAuth/SAML provenant de parties externes. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance — une panne totale des connexions. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez
**[App_GKE](App_GKE.md)**. La configuration applicative propre à authentik partagée
avec la variante Cloud Run est décrite dans
**[Authentik_Common](Authentik_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Authentik sur GKE Autopilot](../labs/Authentik_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Authentik sur Google Cloud Run](Authentik_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Authentik Common — Configuration applicative partagée](Authentik_Common.md) — la configuration partagée par les deux cibles de déploiement.
