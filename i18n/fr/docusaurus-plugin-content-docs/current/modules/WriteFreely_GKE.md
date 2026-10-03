---
title: "WriteFreely sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de WriteFreely sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/WriteFreely_GKE.md @ 15fd4c7 sha256:2528d422f970 -->

# WriteFreely sur GKE Autopilot {#writefreely-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_GKE.png" alt="WriteFreely sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely est une plateforme de blog open source, minimaliste et fédérée, écrite en Go
— une alternative légère à Medium pour une écriture claire et sans distraction.
Ce module déploie WriteFreely sur **GKE Autopilot** en s'appuyant sur la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure partagée de Google Cloud
et Kubernetes.

Ce guide se concentre sur les services cloud utilisés par WriteFreely et sur la manière de les explorer et de les
exploiter depuis la Google Cloud Console et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD,
Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et le
cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_GKE](App_GKE.md) plutôt que de les
répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WriteFreely s'exécute comme une seule charge de travail web Go sur GKE Autopilot. Le déploiement
assemble un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 1 vCPU / 2 GiB par défaut, autoscaling horizontal |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — accessible via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` |
| Stockage d'objets | Cloud Storage | Un bucket de données `writefreely-uploads` dédié provisionné automatiquement |
| Secrets | Secret Manager | Trois secrets de clé AES-256 auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé facultatif + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** La couche d'application partagée se standardise sur
  Cloud SQL pour MySQL ; la variante GKE laisse `database_type` non défini et l'hérite.
- **Cloud SQL est accessible via le sidecar Auth Proxy.** Sur GKE `enable_cloudsql_volume
  = true` et la variante remplace `DB_HOST = 127.0.0.1` — WriteFreely compose l'
  adresse de bouclage où le sidecar `cloud-sql-proxy` écoute sur le port 3306.
- **Les trois clés AES-256 sont générées automatiquement** et stockées dans Secret Manager
  (`cookies-auth`, `cookies-enc`, `email-key`). Elles ne doivent **jamais** être renouvelées après
  le premier démarrage — les renouveler déconnecte tous les utilisateurs et rend les données e-mail
  précédemment chiffrées indéchiffrables.
- **Une image personnalisée est construite, non tirée pré-construite.** `container_image_source = custom` :
  le wrapper fin de génération de configuration (rend `config.ini`, initialise les clés, exécute
  `writefreely db init`) est construit par Cloud Build et poussé vers Artifact Registry.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`, `max_instance_count =
  1` ; GKE ne prend pas en charge la mise à l'échelle à zéro) pour que le blog reste toujours accessible.
- **`service_type = LoadBalancer` avec `session_affinity = ClientIP`.** WriteFreely est
  exposé sur une adresse IP de LoadBalancer externe et les requêtes du même client restent
  sur le même pod.
- **`reserve_static_ip = true` est porteur de charge — ne le basculez pas sur `false`.** L'
  point d'entrée intègre son hôte public résolu dans `config.ini` à chaque démarrage, en
  reculant vers le `GKE_SERVICE_URL` injecté par la fondation lorsque `WF_PUBLIC_URL` est non défini.
  `GKE_SERVICE_URL` n'est calculé qu'à partir de l'IP statique *réservée* ; avec
  `reserve_static_ip = false`, il peut revenir à un `*.svc.cluster.local` interne inaccessible
  nom d'hôte si l'IP éphémère du LoadBalancer n'est pas encore connue au moment de l'
  application — confirmé sur WriteFreely (voir §6).
- **NFS et Redis sont désactivés par défaut** (`enable_nfs = false`, `enable_redis = false`).
  WriteFreely n'a pas besoin de système de fichiers partagé : le contenu réside dans MySQL et ses clés de chiffrement
  sont initialisées à partir de Secret Manager à chaque démarrage.
- **Aucun compte administrateur n'est créé automatiquement.** L'inscription est fermée ; créez le
  premier compte comme étape post-déploiement (voir §3).
- **WriteFreely est en Go — les paramètres Redis et PHP sont inertes.** Activer `enable_redis` ne fait qu'
  injecter un `REDIS_HOST` que WriteFreely ignore, et les variables `php_*` proviennent de l'
  échafaudage du module et ne sont pas consommées par WriteFreely.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail WriteFreely {#a-gke-autopilot--the-writefreely-workload}

Les pods WriteFreely sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. L'autoscaling horizontal des pods dimensionne le déploiement entre le nombre
minimum et maximum de réplicas.

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail WriteFreely pour voir
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'
  adresse IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Voir [App_GKE](App_GKE.md) pour savoir comment Autopilot, la mise à l'échelle et le type de charge de travail
(Deployment vs StatefulSet) sont gérés.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WriteFreely stocke toutes les données de l'application (blogs, articles, utilisateurs, sessions) dans une instance
gérée de Cloud SQL pour MySQL 8.0. Les pods y accèdent en privé via le sidecar **Cloud SQL Auth
Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du premier déploiement, un
job d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application ; le point d'entrée du conteneur
exécute ensuite `writefreely db init` pour construire les tables.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe
sont tous affichés dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatisées
et la rotation des mots de passe, voir [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié (`writefreely-uploads`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès. Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager —
les clés AES-256 que WriteFreely utilise pour signer les cookies de session (`cookies-auth`), chiffrer
les charges utiles des cookies (`cookies-enc`) et chiffrer les adresses e-mail stockées (`email-key`).
Ils sont livrés au pod via le pilote CSI du Secret Store et injectés comme
`WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC` et `WF_KEY_EMAIL`. Le mot de passe de la base de données
est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation du Secret Store CSI, et
[WriteFreely_Common](WriteFreely_Common.md) pour savoir pourquoi ces clés doivent rester stables.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une adresse IP externe de Cloud Load Balancing
(`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut
être activé, et une adresse IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **`reserve_static_ip` est par défaut `true` — ne le changez pas en `false`.** WriteFreely
  intègre un hôte public auto-référentiel dans `config.ini` à chaque démarrage de conteneur (la
  chaîne de secours `PUBLIC_URL` du point d'entrée : `WF_PUBLIC_URL` → `CLOUDRUN_SERVICE_URL` →
  `GKE_SERVICE_URL`). `App_GKE` calcule `GKE_SERVICE_URL` à partir de l'IP statique *réservée*
  lorsque `reserve_static_ip = true` ; avec `false`, l'IP éphémère du LoadBalancer n'est souvent
  pas encore connue au moment où Terraform rend les variables d'environnement du déploiement, donc
  `GKE_SERVICE_URL` revient à l'hôte `*.svc.cluster.local` interne au cluster —
  une véritable course, reproductible, pas seulement un cas limite théorique (confirmé sur WriteFreely
  et corrigé en définissant `reserve_static_ip = true`, selon la valeur par défaut `deploy.tfvars` du module). Un hôte interne inaccessible intégré aux liens de fédération/générés donne l'impression que "l'application fonctionne mais chaque lien absolu est cassé".
- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des vérifications de disponibilité et des politiques d'alerte facultatives sont disponibles. Le point d'entrée
enregistre sa progression (`WriteFreely: rendered config.ini …`, `… seeded stable encryption
keys …`, `… starting server …`), ce qui est utile pour diagnostiquer le premier démarrage.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application WriteFreely {#3-writefreely-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il crée la base de données et l'utilisateur de l'application, accorde `ALL
  PRIVILEGES` sur la base de données, vérifie que l'utilisateur de l'application peut se connecter et arrête le
  sidecar Cloud SQL Proxy. Le job est idempotent (`CREATE ... IF NOT EXISTS`,
  `max_retries = 3`) et peut être réexécuté en toute sécurité.
- **Schéma créé au démarrage.** Le point d'entrée du conteneur rend `config.ini` (avec
  `DB_HOST = 127.0.0.1`) puis exécute `writefreely db init` à chaque démarrage pour créer
  les tables (tolérant si elles existent déjà), de sorte que le schéma est amorcé sans
  étape de migration séparée.
- **Les trois clés AES-256 sont immuables après le premier démarrage.** Elles sont générées une fois
  et écrites dans Secret Manager. La modification de l'une d'entre elles déconnecte tous les utilisateurs (les signatures de cookies
  ne sont plus valides) et rend les adresses e-mail précédemment chiffrées indéchiffrables.
  Ne les renouvelez que pendant une fenêtre de maintenance planifiée.
- **Créez le premier compte après le déploiement.** L'inscription est fermée par défaut
  (`open_registration = false`) et aucun administrateur n'est initialisé. Pour créer le premier compte,
  soit définissez temporairement `WF_OPEN_REGISTRATION = "true"` via `environment_variables`,
  inscrivez-vous via l'interface utilisateur, puis remettez-le à `"false"` ; soit exécutez
  `--create-admin` de WriteFreely à l'intérieur d'un pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /usr/local/bin/writefreely --create-admin <user>:<password>
  ```
- **Correction de l'URL publique.** Le point d'entrée revient à l'hôte public
  `GKE_SERVICE_URL` injecté par la fondation. Une fois l'IP du LoadBalancer attribuée, définissez
  `WF_PUBLIC_URL` (via `environment_variables`) sur l'URL externe ou le domaine personnalisé afin que
  les liens générés et la fédération utilisent l'hôte accessible.
- **Chemin de santé.** La sonde de démarrage est **TCP** (prête dès que le port 8080 est lié)
  et la sonde de vivacité est **HTTP `GET /`** — WriteFreely sert sa page d'accueil avec un
  `200` lorsqu'elle est saine ; il n'y a pas de point de terminaison `/health` dédié.
- **Confirmez l'hôte de la base de données injecté dans le pod en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|WF_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres
spécifiques ou notables pour WriteFreely sont listés ; toutes les autres entrées sont héritées de
[App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `writefreely` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `writeas/writefreely` ; `latest` résout l'image de base vers l'ARG de build `0.12.0` épinglé. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Laissez comme `custom` — le wrapper de génération de configuration doit être construit. |
| `min_instance_count` | `1` | Réplicas minimum ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Réplicas maximum. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Ressources par pod. |
| `container_port` | `8080` | Le serveur web de WriteFreely se lie au port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy ; `DB_HOST` est remplacé par `127.0.0.1`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposition IP externe pour le blog. |
| `session_affinity` | `ClientIP` | Routage persistant vers le même pod. |
| `workload_type` | `null` | Par défaut, un déploiement sans état. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires. Utilisez pour `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_PUBLIC_URL`, `WF_OPEN_REGISTRATION`. Ne définissez pas `WF_KEY_*` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de var d'environnement → nom de secret Secret Manager. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `false` | Désactivé par défaut : WriteFreely n'a pas besoin de système de fichiers partagé. Le contenu réside dans MySQL et les clés de chiffrement sont initialisées à partir de Secret Manager à chaque démarrage. |
| `nfs_mount_path` | `/var/lib/writefreely` | Chemin de montage à l'intérieur du conteneur. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `writefreely` | Nom de la base de données → injecté comme `DB_NAME`. Immuable après le premier déploiement. |
| `application_database_user` | `writefreely` | Utilisateur de l'application → injecté comme `DB_USER`. Immuable après le premier déploiement. |
| `database_type` | `"MYSQL_8_0"` | Défini explicitement, correspondant au moteur attendu par la couche d'application partagée. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30s | Prêt dès que le port 8080 est lié. |
| `liveness_probe` | HTTP `/`, délai de 30s | Pilote également la disponibilité et la vérification de santé de l'équilibreur de charge, de sorte qu'un long délai maintient le pod hors service ; la sonde de démarrage TCP couvre déjà les démarrages lents. |

### Groupe 15 — Redis (inerte pour WriteFreely) {#group-15--redis-inert-for-writefreely}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Laissez désactivé** — WriteFreely ne peut pas utiliser Redis ; l'activer n'injecte qu'un `REDIS_HOST` ignoré. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Mappage des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre WriteFreely. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | Statut et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et (facultatifs) d'importation. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | Statut et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au
> moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au
> moment de la planification — IAP sans identités autorisées, un runtime `gen1` avec montages NFS/GCS,
> un `database_type` qui ne correspond pas à une extension activée, des valeurs de quota de mémoire
> sans suffixes d'unité binaire, un `backup_retention_days` hors plage. Une configuration invalide
> fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource,
> de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| Clés AES-256 (`WF_KEY_*`, auto-générées) | Ne jamais renouveler après le premier démarrage | Critique | Le renouvellement déconnecte tous les utilisateurs et rend les données e-mail chiffrées indéchiffrables. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Critique | Sur GKE, le sidecar Auth Proxy est requis ; le désactiver supprime l'écouteur `127.0.0.1:3306` et interrompt la connectivité MySQL. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans fichier de sauvegarde valide fait échouer le job d'importation. |
| `container_image_source` | `custom` | Élevé | Définir `prebuilt` sans une image qui intègre le point d'entrée de génération de configuration produit un pod qui ne peut pas rendre `config.ini` et ne démarre pas. |
| `WF_PUBLIC_URL` | URL / domaine externe du LoadBalancer | Élevé | Un hôte public incorrect rompt les liens générés, la fédération et les redirections. |
| `reserve_static_ip` | `true` | Élevé | Avec `false`, `GKE_SERVICE_URL` peut revenir à un hôte `*.svc.cluster.local` interne inaccessible au moment de l'application (une course à l'IP éphémère du LB), que le point d'entrée intègre dans `config.ini` comme hôte public — confirmé sur WriteFreely. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pod dans l'espace de noms. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; le garde de validation rejette les valeurs invalides. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions peuvent rebondir entre les pods ; des clés de cookie stables rendent cela tolérable mais l'affinité est préférable. |
| `application_version` | Épinglez une version | Moyen | `latest` peut modifier l'image de base lors des redéploiements ; l'épinglage maintient les builds reproductibles. |
| `WF_OPEN_REGISTRATION` | `false` après le premier administrateur | Moyen | Laisser l'inscription ouverte permet à quiconque ayant l'URL de créer un compte. |
| `enable_pod_disruption_budget` | `true` | Moyen | La désactivation permet à GKE d'expulser tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**. La configuration d'application spécifique à WriteFreely
partagée avec la variante Cloud Run est décrite dans
**[WriteFreely_Common](WriteFreely_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WriteFreely sur GKE Autopilot](../labs/WriteFreely_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [WriteFreely Common — Configuration d'application partagée](WriteFreely_Common.md) — la configuration partagée par les deux cibles de déploiement.
