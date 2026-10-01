---
title: "WriteFreely sur GKE Autopilot"
description: "Référence de configuration pour déployer WriteFreely sur GKE Autopilot avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/WriteFreely_GKE.md @ 944fee5 sha256:db79fa16eb05 -->

# WriteFreely sur GKE Autopilot {#writefreely-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/WriteFreely_GKE.png" alt="WriteFreely sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

WriteFreely est une plateforme de blog open source, minimaliste et fédérée, écrite en Go — une alternative légère à Medium pour publier des textes épurés, sans distraction. Ce module déploie WriteFreely sur **GKE Autopilot** au-dessus du socle [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud qu'utilise WriteFreely et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications GKE — Workload Identity, ingress, autoscaling, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide du socle App_GKE](App_GKE.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

WriteFreely s'exécute sous la forme d'une unique charge de travail web Go sur GKE Autopilot. Le déploiement assemble un ensemble ciblé de services Google Cloud :

| Fonctionnalité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | GKE Autopilot | Pods Go, 1 vCPU / 2 GiB par défaut, mise à l'échelle horizontale automatique |
| Base de données | Cloud SQL for MySQL 8.0 | Obligatoire — accessible via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1` |
| Stockage objet | Cloud Storage | Un bucket de données `writefreely-uploads` dédié, provisionné automatiquement |
| Secrets | Secret Manager | Trois secrets de clés AES-256 générés automatiquement ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe, domaine personnalisé et certificat géré facultatifs |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur imposé.** La couche applicative partagée standardise sur Cloud SQL for MySQL ; la variante GKE laisse `database_type` non défini et en hérite.
- **Cloud SQL est accessible via le sidecar Auth Proxy.** Sur GKE, `enable_cloudsql_volume
  = true` et la variante remplace `DB_HOST = 127.0.0.1` — WriteFreely se connecte à l'adresse de bouclage sur laquelle le sidecar `cloud-sql-proxy` écoute, sur le port 3306.
- **Les trois clés AES-256 sont générées automatiquement** et stockées dans Secret Manager (`cookies-auth`, `cookies-enc`, `email-key`). Elles ne doivent **jamais** faire l'objet d'une rotation après le premier démarrage — leur rotation déconnecte tous les utilisateurs et rend indéchiffrables les adresses e-mail chiffrées auparavant.
- **Une image personnalisée est construite, et non récupérée préconstruite.** `container_image_source = custom` : le wrapper léger de génération de configuration (qui génère `config.ini`, installe les clés et exécute `writefreely db init`) est construit par Cloud Build et envoyé dans Artifact Registry.
- **Un minimum de 1 réplica est maintenu** (`min_instance_count = 1`, `max_instance_count =
  1` ; GKE ne prend pas en charge la mise à l'échelle à zéro) afin que le blog reste toujours accessible.
- **`service_type = LoadBalancer` avec `session_affinity = ClientIP`.** WriteFreely est exposé sur une IP de LoadBalancer externe, et les requêtes d'un même client restent épinglées au même pod.
- **`reserve_static_ip = true` est indispensable — ne le passez pas à `false`.** Le point d'entrée inscrit dans `config.ini`, à chaque démarrage, l'hôte public qu'il a résolu, en se rabattant sur `GKE_SERVICE_URL` injecté par le socle lorsque `WF_PUBLIC_URL` n'est pas défini. `GKE_SERVICE_URL` n'est calculé qu'à partir de l'IP statique *réservée* ; avec `reserve_static_ip = false`, il peut se rabattre sur un nom d'hôte interne `*.svc.cluster.local` injoignable si l'IP éphémère du LoadBalancer n'est pas encore connue au moment de l'apply — constaté sur WriteFreely (voir §6).
- **NFS est activé par défaut** (`enable_nfs = true`), ce qui héberge également le point de terminaison Redis (inutilisé) sur la VM du serveur NFS.
- **Aucun compte administrateur n'est créé automatiquement.** Les inscriptions sont fermées ; créez le premier compte comme étape post-déploiement (voir §3).
- **WriteFreely est écrit en Go — les paramètres Redis et PHP sont inertes.** Les variables `enable_redis` et `php_*` proviennent du gabarit du module et ne sont pas utilisées par WriteFreely.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail WriteFreely {#a-gke-autopilot--the-writefreely-workload}

Les pods WriteFreely sont planifiés sur Autopilot, qui facture le CPU et la mémoire effectivement demandés par les pods. Le Horizontal Pod Autoscaling dimensionne le déploiement entre le nombre minimal et le nombre maximal de réplicas.

- **Console :** Kubernetes Engine → Workloads → sélectionnez la charge de travail WriteFreely pour voir les pods, les révisions et les événements. Kubernetes Engine → Services & Ingress affiche l'IP externe.
- **CLI :**
  ```bash
  kubectl get pods,svc,hpa -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe hpa -n "$NAMESPACE"          # current vs target utilisation
  ```

Consultez [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail (Deployment ou StatefulSet).

### B. Cloud SQL for MySQL 8.0 {#b-cloud-sql-for-mysql-80}

WriteFreely stocke toutes les données de l'application (blogs, articles, utilisateurs, sessions) dans une instance gérée Cloud SQL for MySQL 8.0. Les pods y accèdent de manière privée via le sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Au premier déploiement, un Job d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application ; le point d'entrée du conteneur exécute ensuite `writefreely db init` pour créer les tables.

- **Console :** SQL → sélectionnez l'instance pour consulter les connexions, les sauvegardes, les flags et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le mot de passe figurent tous dans les [Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes automatiques et la rotation des mots de passe, consultez [App_GKE](App_GKE.md).

### C. Cloud Storage {#c-cloud-storage}

Un bucket de données **Cloud Storage** dédié (`writefreely-uploads`) est provisionné automatiquement, et l'accès est accordé au compte de service de la charge de travail. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Consultez [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Trois secrets cryptographiques sont générés automatiquement et stockés dans Secret Manager — les clés AES-256 qu'utilise WriteFreely pour signer les cookies de session (`cookies-auth`), chiffrer le contenu des cookies (`cookies-enc`) et chiffrer les adresses e-mail stockées (`email-key`). Ils sont transmis au pod via le pilote Secret Store CSI et injectés sous forme de `WF_KEY_COOKIES_AUTH`, `WF_KEY_COOKIES_ENC` et `WF_KEY_EMAIL`. Le mot de passe de la base de données est géré séparément par le socle.

- **Console :** Security → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" \
    --filter="name~cookies-auth OR name~cookies-enc OR name~email-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour l'intégration Secret Store CSI et la rotation, et [WriteFreely_Common](WriteFreely_Common.md) pour comprendre pourquoi ces clés doivent rester stables.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing (`service_type = LoadBalancer`). Un domaine personnalisé avec un certificat géré par Google peut être activé, et une IP statique peut être réservée afin que l'adresse survive aux redéploiements.

- **`reserve_static_ip` vaut `true` par défaut — ne le passez pas à `false`.** WriteFreely inscrit dans `config.ini`, à chaque démarrage du conteneur, un hôte public auto-référent (la chaîne de repli `PUBLIC_URL` du point d'entrée : `WF_PUBLIC_URL` → `CLOUDRUN_SERVICE_URL` → `GKE_SERVICE_URL`). `App_GKE` calcule `GKE_SERVICE_URL` à partir de l'IP statique *réservée* lorsque `reserve_static_ip = true` ; avec `false`, l'IP éphémère du LoadBalancer n'est souvent pas encore connue au moment où Terraform génère les variables d'environnement du Deployment, si bien que `GKE_SERVICE_URL` se rabat sur le nom d'hôte interne au cluster `*.svc.cluster.local` — une véritable condition de concurrence, reproductible, et pas seulement un cas limite théorique (constatée sur WriteFreely et corrigée en définissant `reserve_static_ip = true`, conformément à la valeur par défaut du `deploy.tfvars` du module). Un hôte interne injoignable inscrit dans les liens de fédération/générés se traduit par « l'application fonctionne mais tous les liens absolus sont cassés ».
- **Console :** Network services → Load balancing ; VPC network → IP addresses.
- **CLI :**
  ```bash
  kubectl get ingress,svc -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails sur l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les sorties stdout/stderr des pods sont envoyées vers Cloud Logging ; les métriques GKE et Cloud SQL sont envoyées vers Cloud Monitoring. Des tests de disponibilité et des règles d'alerte facultatifs sont disponibles. Le point d'entrée journalise sa progression (`WriteFreely: rendered config.ini …`, `… seeded stable encryption
keys …`, `… starting server …`), ce qui est utile pour diagnostiquer le premier démarrage.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application WriteFreely {#3-writefreely-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` avec `mysql:8.0-debian`. Il crée la base de données et l'utilisateur de l'application, accorde `ALL
  PRIVILEGES` sur la base de données, vérifie que l'utilisateur de l'application peut se connecter, puis arrête le sidecar Cloud SQL Proxy. Le job est idempotent (`CREATE ... IF NOT EXISTS`, `max_retries = 3`) et peut être réexécuté sans risque.
- **Schéma créé au démarrage.** Le point d'entrée du conteneur génère `config.ini` (avec `DB_HOST = 127.0.0.1`) puis exécute `writefreely db init` à chaque démarrage pour créer les tables (en tolérant qu'elles existent déjà), de sorte que le schéma est amorcé sans étape de migration distincte.
- **Les trois clés AES-256 sont immuables après le premier démarrage.** Elles sont générées une seule fois et écrites dans Secret Manager. Modifier l'une d'elles déconnecte tous les utilisateurs (les signatures des cookies ne sont plus valides) et rend indéchiffrables les adresses e-mail chiffrées auparavant. N'effectuez une rotation que pendant une fenêtre de maintenance planifiée.
- **Créez le premier compte après le déploiement.** Les inscriptions sont fermées par défaut (`open_registration = false`) et aucun administrateur n'est pré-créé. Pour créer le premier compte, définissez temporairement `WF_OPEN_REGISTRATION = "true"` via `environment_variables`, inscrivez-vous via l'interface, puis rétablissez la valeur `"false"` ; ou exécutez `--create-admin` de WriteFreely dans un pod en cours d'exécution :
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- \
    /usr/local/bin/writefreely --create-admin <user>:<password>
  ```
- **Exactitude de l'URL publique.** Le point d'entrée se rabat sur `GKE_SERVICE_URL` injecté par le socle pour déterminer l'hôte public. Une fois l'IP du LoadBalancer attribuée, définissez `WF_PUBLIC_URL` (via `environment_variables`) sur l'URL externe ou le domaine personnalisé afin que les liens générés et la fédération utilisent l'hôte joignable.
- **Chemin de santé.** La sonde de démarrage est de type **TCP** (Ready dès que le port 8080 est en écoute) et la sonde de vivacité est **HTTP `GET /`** — WriteFreely sert sa page d'accueil avec un `200` lorsqu'il est en bonne santé ; il n'existe pas de point de terminaison `/health` dédié.
- **Vérifiez l'hôte de base de données injecté dans le pod en cours d'exécution :**
  ```bash
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep -E 'DB_HOST|WF_'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres propres à WriteFreely ou notables pour celui-ci sont listés ; toutes les autres entrées sont héritées d'[App_GKE](App_GKE.md) avec leur comportement et leurs valeurs par défaut standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `writefreely` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `application_version` | `latest` | Tag de l'image `writeas/writefreely` ; `latest` résout l'image de base vers l'ARG de build épinglé `0.12.0`. Épinglez une version en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Conservez `custom` — le wrapper de génération de configuration doit être construit. |
| `min_instance_count` | `1` | Nombre minimal de réplicas ; GKE ne prend pas en charge la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Nombre maximal de réplicas. |
| `cpu_limit` / `memory_limit` | `1000m` / `2Gi` | Ressources par pod. |
| `container_port` | `8080` | Le serveur web de WriteFreely écoute sur le port 8080. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy ; `DB_HOST` est remplacé par `127.0.0.1`. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | Exposition du blog sur une IP externe. |
| `session_affinity` | `ClientIP` | Routage persistant vers le même pod. |
| `workload_type` | `null` | Correspond par défaut à un Deployment sans état. |

### Groupe 5 — Variables d'environnement et secrets {#group-5--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires. À utiliser pour `WF_SITE_NAME`, `WF_SITE_DESCRIPTION`, `WF_PUBLIC_URL`, `WF_OPEN_REGISTRATION`. Ne définissez pas `WF_KEY_*` ni `DB_*` ici. |
| `secret_environment_variables` | `{}` | Correspondance variable d'environnement → nom du secret Secret Manager. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est provisionné par défaut (il héberge également le point de terminaison Redis inutilisé). |
| `nfs_mount_path` | `/var/lib/writefreely` | Chemin de montage dans le conteneur. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_database_name` | `writefreely` | Nom de la base de données → injecté sous forme de `DB_NAME`. Immuable après le premier déploiement. |
| `application_database_user` | `writefreely` | Utilisateur de l'application → injecté sous forme de `DB_USER`. Immuable après le premier déploiement. |
| `database_type` | `"MYSQL_8_0"` | Défini explicitement, conformément au moteur attendu par la couche applicative partagée. |

### Groupe 10 — Observabilité et santé {#group-10--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30 s | Ready dès que le port 8080 est en écoute. |
| `liveness_probe` | HTTP `/`, délai de 300 s | Redémarre le pod si la page d'accueil cesse de répondre. |

### Groupe 15 — Redis (inerte pour WriteFreely) {#group-15--redis-inert-for-writefreely}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Non utilisé** — WriteFreely stocke tout son état dans MySQL. Reliquat du gabarit. |

Toutes les autres entrées suivent le comportement standard d'App_GKE.

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lorsqu'un déploiement réussit et constituent le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du Service Kubernetes. |
| `namespace` | Espace de noms dans lequel s'exécute la charge de travail. |
| `service_cluster_ip` | ClusterIP interne au cluster. |
| `stage_service_cluster_ips` | Correspondance des ClusterIP des services propres à chaque étape. |
| `service_external_ip` | IP externe du LoadBalancer (lorsqu'une IP statique est réservée). |
| `service_url` | URL permettant d'accéder à WriteFreely. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État de la surveillance et canaux de notification. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration et d'import (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails du CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État de VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au
> moteur du socle [App_GKE](App_GKE.md), qui valide les valeurs *et leurs combinaisons* au
> moment du plan — IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS,
> un `database_type` qui ne correspond pas à une extension activée, des valeurs de quota mémoire
> sans suffixe d'unité binaire, un `backup_retention_days` hors plage. Une configuration
> invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de la moindre
> ressource, si bien que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Clés AES-256 (`WF_KEY_*`, générées automatiquement) | Ne jamais les faire tourner après le premier démarrage | Critique | Une rotation déconnecte tous les utilisateurs et rend indéchiffrables les adresses e-mail chiffrées. |
| `application_database_name` / `application_database_user` | définis une seule fois | Critique | Immuables après le premier déploiement ; un renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_cloudsql_volume` | `true` | Critique | Sur GKE, le sidecar Auth Proxy est obligatoire ; le désactiver supprime l'écoute sur `127.0.0.1:3306` et rompt la connectivité à MySQL. |
| `enable_backup_import` | `false`, sauf en cas de restauration | Critique | L'activer sans fichier de sauvegarde valide fait échouer le job d'import. |
| `container_image_source` | `custom` | Élevé | Définir `prebuilt` sans image intégrant le point d'entrée de génération de configuration produit un pod incapable de générer `config.ini`, qui ne démarre pas. |
| `WF_PUBLIC_URL` | URL du LoadBalancer externe / domaine | Élevé | Un hôte public incorrect casse les liens générés, la fédération et les redirections. |
| `reserve_static_ip` | `true` | Élevé | Avec `false`, `GKE_SERVICE_URL` peut se rabattre sur un hôte interne `*.svc.cluster.local` injoignable au moment de l'apply (une condition de concurrence liée à l'IP éphémère du LB), que le point d'entrée inscrit dans `config.ini` comme hôte public — constaté sur WriteFreely. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont des octets et bloquent toute planification de pods dans l'espace de noms. |
| `min_instance_count` | `1` | Élevé | GKE exige min ≥ 1 ; la validation rejette les valeurs invalides. |
| `session_affinity` | `ClientIP` | Moyen | Sans persistance, les sessions peuvent passer d'un pod à l'autre ; des clés de cookies stables rendent cela tolérable, mais l'affinité est préférable. |
| `application_version` | Épingler une version | Moyen | `latest` peut faire changer l'image de base d'un redéploiement à l'autre ; l'épinglage garantit des builds reproductibles. |
| `WF_OPEN_REGISTRATION` | `false` après le premier administrateur | Moyen | Laisser les inscriptions ouvertes permet à toute personne disposant de l'URL de créer un compte. |
| `enable_pod_disruption_budget` | `true` | Moyen | Le désactiver permet à GKE d'évincer tous les pods simultanément pendant la maintenance. |
| `backup_retention_days` | `7` (à augmenter en production) | Moyen | Trop court pour une rétention de conformité. |

---

Pour le comportement du socle évoqué tout au long de ce guide — IAM et Workload Identity, autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir des images — consultez **[App_GKE](App_GKE.md)**. La configuration applicative propre à WriteFreely, partagée avec la variante Cloud Run, est décrite dans **[WriteFreely_Common](WriteFreely_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : WriteFreely sur GKE Autopilot](../labs/WriteFreely_GKE.md) — déployez-le pas à pas, avec les écrans de la console et les commandes à chaque étape.
- [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md) — la même application sur Cloud Run, lorsque vous avez besoin de l'autre cible de déploiement.
- [WriteFreely Common — Configuration applicative partagée](WriteFreely_Common.md) — la configuration partagée par les deux cibles de déploiement.
