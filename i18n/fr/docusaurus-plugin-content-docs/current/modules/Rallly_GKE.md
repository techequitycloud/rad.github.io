---
title: "Rallly sur GKE Autopilot"
description: "Référence de configuration pour déployer Rallly sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/Rallly_GKE.md @ 3055034 sha256:28c9deba7f4c -->

# Rallly sur GKE Autopilot {#rallly-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Rallly_GKE.png" alt="Rallly sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Rallly est une application open source et auto-hébergée de planification de réunions et
de sondages de groupe — une alternative à Doodle respectueuse de la vie privée — construite
avec Next.js et Prisma. Ce module déploie Rallly sur **GKE Autopilot** au-dessus du socle
[App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes
partagée.

Ce guide se concentre sur les services cloud qu'utilise Rallly et sur la manière de les
explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications GKE — Workload Identity, entrée,
autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Rallly s'exécute comme une seule charge de travail web Next.js. Le déploiement assemble un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Next.js, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL for PostgreSQL 15 | Obligatoire — Rallly ne prend pas en charge MySQL ni d'autres moteurs |
| E-mail | Relais SMTP (externe) | Connexion par e-mail sans mot de passe ; fournissez votre propre hôte/identifiants SMTP |
| Secrets | Secret Manager | `SECRET_PASSWORD` et `NEXTAUTH_SECRET` générés automatiquement ; `SMTP_PWD` facultatif ; mot de passe de la base de données |
| Entrée | Cloud Load Balancing | Service LoadBalancer externe, domaine personnalisé + certificat géré facultatifs |

**Valeurs par défaut raisonnables à connaître dès le départ :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche
  applicative partagée ; choisir tout autre moteur empêche le démarrage. Tout l'état de
  Rallly (sondages, votes, commentaires, utilisateurs) réside dans cette base de données.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont générés automatiquement** et stockés
  dans Secret Manager. Ces clés ne doivent pas faire l'objet d'une rotation après le
  premier démarrage sans fenêtre de maintenance — la rotation de `SECRET_PASSWORD`
  invalide les données chiffrées précédemment, et celle de `NEXTAUTH_SECRET` invalide
  toutes les sessions actives et les liens de connexion en cours.
- **La connexion à Rallly se fait sans mot de passe, par e-mail.** Les utilisateurs
  s'inscrivent et se connectent en recevant un lien/code de vérification ; une
  configuration SMTP fonctionnelle est donc en pratique nécessaire avant que quiconque
  puisse se connecter. Sur cette variante, `smtp_host` est vide par défaut ; définissez
  `smtp_host`, `smtp_user` et `smtp_password` pour activer l'e-mail.
- **L'URL de base publique doit être définie pour l'accès externe.**
  `NEXT_PUBLIC_BASE_URL` / `NEXTAUTH_URL` proviennent de `base_url`. Définissez-la sur
  l'URL du LoadBalancer externe ou du domaine personnalisé dès qu'elle est connue, afin
  que les liens d'invitation et de connexion pointent vers l'adresse que visitent les
  utilisateurs.
- **Charge de travail `Deployment`, sans état sur disque.** `workload_type = Deployment`
  sans PVC — Rallly conserve tout son état dans PostgreSQL, les pods sont donc librement
  remplaçables.
- **NFS et Redis sont désactivés.** Rallly n'a besoin ni de système de fichiers partagé
  ni de cache ; tous deux sont désactivés par défaut (Redis est désactivé de façon fixe).
- **Les migrations s'exécutent au démarrage.** Le script `./docker-start.sh` du conteneur
  exécute `prisma migrate deploy` à chaque démarrage ; les mises à niveau de version
  appliquent donc les modifications de schéma sans étape de migration distincte. La tâche
  `db-init` se contente de provisionner la base de données et le rôle vides.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants figurent dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Rallly {#a-gke-autopilot--the-rallly-workload}

Les pods Rallly sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre
le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail Rallly
  pour voir les pods, les révisions et les événements. Kubernetes Engine → Services &
  Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du
type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Rallly stocke toutes les données applicatives (sondages, options, participants, votes,
commentaires et comptes utilisateurs) dans une instance gérée Cloud SQL for PostgreSQL 15.
Les pods y accèdent en privé via le sidecar **Cloud SQL Auth Proxy** sur l'interface de
bouclage (`enable_cloudsql_volume = true`) ; aucune IP publique n'est exposée. Au premier
déploiement, la tâche `db-init` crée la base de données et le rôle de l'application ;
Rallly applique ensuite son propre schéma Prisma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, sauvegardes, flags et
  métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données (`rallly`), l'utilisateur (`rallly`) et le secret
Secret Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs).
Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de
passe, consultez [App_GKE](App_GKE.md).

### C. E-mail (SMTP) {#c-email-smtp}

Rallly envoie les e-mails de connexion/vérification et d'invitation via un relais SMTP
externe. Lorsque `smtp_host` est défini, le pod reçoit `SMTP_HOST`, `SMTP_PORT`,
`SMTP_USER`, `SMTP_SECURE` et le secret `SMTP_PWD`. Il n'existe pas de service d'e-mail
géré par Google — fournissez le vôtre (SendGrid, Mailgun, Gmail SMTP, etc.).

- **CLI (vérifier les paramètres injectés dans le pod en cours d'exécution) :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'SMTP_|NEXT_PUBLIC_BASE_URL'
  ```

### D. Secret Manager {#d-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans Secret
Manager : `SECRET_PASSWORD` (le secret de chiffrement des données / de session de Rallly)
et `NEXTAUTH_SECRET` (signe les jetons de session NextAuth et les liens de connexion par
e-mail). Un troisième, `SMTP_PWD`, n'est créé que lorsque SMTP est configuré. Le mot de
passe de la base de données est géré séparément par le socle. Les secrets sont projetés
dans le pod par le pilote Secret Store CSI.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~rallly"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données figure dans les
[Sorties](#5-outputs). Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store
CSI et la rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP Cloud Load Balancing externe
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par
Google peut être activé, et une IP statique réservée afin que l'adresse survive aux
redéploiements. Définissez `base_url` sur l'URL externe pour que les liens d'invitation
et de connexion de Rallly correspondent à l'adresse que visitent les utilisateurs.

- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails
sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées à Cloud Logging ; les métriques GKE et
Cloud SQL sont envoyées à Cloud Monitoring. Des tests de disponibilité et des règles
d'alerte facultatifs sont disponibles.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Rallly {#3-rallly-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Une tâche
  d'initialisation exécute `db-init.sh` avec `postgres:15-alpine`. Elle se connecte via
  le Cloud SQL Auth Proxy et crée de manière idempotente la base de données et le rôle de
  l'application, accorde les privilèges, puis signale au proxy de s'arrêter. Elle est
  configurée avec `max_retries = 3` et peut être relancée sans risque.
- **Migrations de schéma au démarrage.** Le script `./docker-start.sh` de Rallly exécute
  `prisma migrate deploy` à chaque démarrage ; le schéma est donc créé au premier
  démarrage après `db-init`, et la mise à niveau de la version de l'application applique
  les modifications de schéma sans étape de migration distincte.
- **`SECRET_PASSWORD` et `NEXTAUTH_SECRET` sont immuables après le premier démarrage.**
  Ils sont générés une seule fois et écrits dans Secret Manager. Modifier
  `SECRET_PASSWORD` invalide les données chiffrées précédemment ; modifier
  `NEXTAUTH_SECRET` invalide toutes les sessions actives et les liens de connexion en
  cours. N'effectuez leur rotation que pendant une fenêtre de maintenance planifiée.
- **Connexion par e-mail sans mot de passe.** Rallly authentifie les utilisateurs via des
  liens/codes de vérification envoyés par e-mail. Sans relais SMTP fonctionnel, les
  utilisateurs ne peuvent pas recevoir les e-mails de connexion et ne peuvent en pratique
  pas se connecter. Vérifiez les paramètres SMTP dans le pod en cours d'exécution après
  le déploiement.
- **L'URL de base publique nécessite l'IP externe.** Définissez `base_url` (ou
  `NEXT_PUBLIC_BASE_URL` dans `environment_variables`) sur l'URL du LoadBalancer externe
  ou du domaine personnalisé une fois l'IP attribuée, afin que les liens d'invitation et
  de connexion se résolvent correctement :
  ```bash
  kubectl get svc <service-name> -n "$NAMESPACE" \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}'
  ```
- **Chemin de santé.** Les sondes de démarrage et d'activité ciblent `/api/status` — le
  point de terminaison d'état public et non authentifié de Rallly. Prévoyez du temps au
  premier démarrage pour l'étape de migration Prisma (la sonde de démarrage par défaut
  offre un délai initial de 30 secondes plus une fenêtre de 20 tentatives à 15 secondes
  d'intervalle).
- **Inspecter l'exécution des tâches :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<job-name>
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme sur la plateforme de déploiement. Seuls
les paramètres propres à Rallly ou notables pour lui sont listés ; toutes les autres
entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par
défaut standard.

### Groupe 2 — Identité de l'application {#group-2--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `rallly` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image Rallly (`lukevella/rallly`) ; épinglez une version précise en production. |

### Groupe 3 — Exécution et mise à l'échelle {#group-3--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par pod ; les opérations d'API et la transformation des ressources de Rallly bénéficient d'au moins 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par pod. |
| `min_instance_count` | `0` | Nombre minimal de réplicas. |
| `max_instance_count` | `3` | Nombre maximal de réplicas ; Rallly conserve son état dans Postgres et peut évoluer horizontalement. |
| `container_port` | `3000` | Rallly écoute sur le port 3000. |
| `enable_cloudsql_volume` | `true` | Sidecar Cloud SQL Auth Proxy (bouclage) pour PostgreSQL. |
| `base_url` | `""` | URL publique pour `NEXT_PUBLIC_BASE_URL` / les liens NextAuth. Définissez-la sur l'URL du LoadBalancer externe ou du domaine personnalisé. |

### Groupe 5 — Accès, entrée et e-mail {#group-5--access-ingress--email}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `smtp_host` | `""` | Nom d'hôte du relais SMTP. Une valeur non vide provisionne `SMTP_PWD` et injecte les variables d'environnement `SMTP_*`. Nécessaire pour la connexion par e-mail. |
| `smtp_port` | `587` | Port SMTP (587 STARTTLS, 465 SSL). |
| `smtp_user` | `""` | Nom d'utilisateur SMTP — définissez-le (avec `smtp_password`) pour activer la connexion par e-mail. |
| `smtp_password` | `""` (sensible) | Mot de passe SMTP. Vide → un secret généré automatiquement est stocké. |
| `smtp_secure_enabled` | `false` | Active le TLS/SSL implicite (true pour le port 465). |
| `mail_from` | `""` | Adresse d'expéditeur pour `NOREPLY_EMAIL` / `SUPPORT_EMAIL`. Vide → `noreply@rallly.local`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Mode d'exposition du Service Kubernetes. |
| `workload_type` | `Deployment` | Deployment (sans état) — Rallly stocke tout son état dans PostgreSQL. |

### Groupe 11 — Backend de base de données {#group-11--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `rallly` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `rallly` | Utilisateur de base de données de l'application. Mot de passe généré automatiquement dans Secret Manager. |
| `database_type` | `POSTGRES_15` | Fixe — Rallly nécessite PostgreSQL 15. |

### Groupe 13 — Système de fichiers et observabilité {#group-13--filesystem--observability}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | NFS est désactivé — Rallly n'a pas besoin de système de fichiers partagé. |
| `startup_probe` | HTTP `/api/status`, délai initial 0s, 10 échecs | Sonde de démarrage ; prévoyez la migration Prisma du premier démarrage. |
| `liveness_probe` | HTTP `/api/status` délai 60s | Sonde d'activité. |

### Groupe 20 — Cache Redis {#group-20--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Rallly n'utilise pas Redis ; laissez-le désactivé. |

Toutes les autres entrées suivent le comportement standard d'[App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées après un déploiement réussi et constituent le moyen le plus
rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Map des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à Rallly. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (aucun par défaut pour Rallly). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux. |
| `initialization_jobs` / `db_import_job` | Noms des tâches de configuration (`db-init`) et d'import (facultative). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État des journaux d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut raisonnables {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — `min_instance_count > max_instance_count`, IAP sans identifiant/secret de client OAuth, `enable_redis` sans `redis_host` ni NFS, `enable_cloudsql_volume = true` avec `database_type = NONE`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur raisonnable | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_PASSWORD` (généré automatiquement) | Ne jamais effectuer de rotation après le premier démarrage | Critical | Sa rotation invalide les données chiffrées précédemment et les sessions actives. |
| `NEXTAUTH_SECRET` (généré automatiquement) | Rotation uniquement pendant une fenêtre de maintenance | Critical | Sa rotation invalide toutes les sessions actives et les liens de connexion par e-mail en cours. |
| `db_name` / `db_user` | Définis une seule fois | Critical | Immuables après le premier déploiement ; les renommer recrée la base de données/le rôle et détruit toutes les données. |
| `database_type` | `POSTGRES_15` | Critical | Rallly ne prend en charge que PostgreSQL 15 ; tout autre moteur empêche le démarrage. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critical | L'activer sans `backup_uri` valide fait échouer la tâche d'import. |
| `smtp_host` / `smtp_user` / `smtp_password` | À définir pour activer l'e-mail | High | Sans relais SMTP fonctionnel, les e-mails de connexion ne partent jamais et les utilisateurs ne peuvent pas se connecter. |
| `base_url` | URL du LoadBalancer externe / du domaine personnalisé | High | Si elle reste vide, les liens d'invitation et de connexion ne pointent pas vers l'adresse que visitent les utilisateurs. |
| `enable_cloudsql_volume` | `true` | High | Le sidecar Auth Proxy est nécessaire à la connectivité PostgreSQL ; une garde au moment du plan le bloque avec `database_type = NONE`. |
| `min_instance_count` / `max_instance_count` | `min ≤ max` | High | Une plage inversée crée une configuration HPA contradictoire ; la garde de validation la rejette. |
| `enable_redis` | `false` | Medium | Rallly n'utilise pas Redis ; l'activer sans `redis_host` ni NFS est rejeté par la garde de validation. |
| Délais de `startup_probe` | Conserver la valeur par défaut généreuse | Medium | Une fenêtre trop courte peut faire échouer la sonde pendant la migration Prisma du premier démarrage. |
| `backup_retention_days` | `7` (à augmenter en production) | Medium | Trop court pour une conservation conforme aux exigences. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity,
autoscaling, entrée et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**.
La configuration applicative propre à Rallly partagée avec la variante Cloud Run est
décrite dans **[Rallly_Common](Rallly_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Rallly sur GKE Autopilot](../labs/Rallly_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [Rallly sur Google Cloud Run](Rallly_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [Rallly Common — Configuration applicative partagée](Rallly_Common.md) — la configuration partagée par les deux cibles de déploiement.
