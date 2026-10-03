---
title: "Dolibarr sur GKE Autopilot"
description: "Référence de configuration pour le déploiement de Dolibarr sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Dolibarr_GKE.md @ 15fd4c7 sha256:57772836ae0b -->

# Dolibarr sur GKE Autopilot {#dolibarr-on-gke-autopilot}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Dolibarr_GKE.png" alt="Dolibarr sur GKE Autopilot" style={{maxWidth: "100%", borderRadius: "8px"}} />

Dolibarr est une suite ERP et CRM gratuite et open source couvrant les clients et prospects,
les devis, les commandes, les factures, les produits et les stocks, les RH, les projets et la comptabilité via une
interface web PHP modulaire. Ce module déploie Dolibarr sur **GKE Autopilot** au-dessus de la
fondation [App_GKE](App_GKE.md), qui provisionne et gère l'infrastructure Google
Cloud et Kubernetes partagée.

Ce guide se concentre sur les services cloud utilisés par Dolibarr et sur la manière de les explorer et de les
exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes
communs à toutes les applications GKE — Workload Identity, ingress, autoscaling,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et
le cycle de vie du déploiement — reportez-vous au [guide de la fondation App_GKE](App_GKE.md)
plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Dolibarr fonctionne comme une seule charge de travail web PHP/Apache. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | GKE Autopilot | Pods PHP/Apache sur le port 80, 1 vCPU / 2 GiB par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — le moteur est fixé à `MYSQL_8_0` |
| Persistance des fichiers | Cloud Filestore (NFS) | Les documents/PDFs téléchargés persistent sous `/var/lib/dolibarr`, partagés entre les pods |
| Stockage d'objets | Cloud Storage | Un bucket `dolibarr-documents` provisionné automatiquement |
| Secrets | Secret Manager | `DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` auto-générés ; mot de passe de la base de données |
| Ingress | Cloud Load Balancing | LoadBalancer externe avec une IP statique réservée ; domaine personnalisé optionnel + certificat géré |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée
  (la variante passe `database_type = null`, ce qui conserve la valeur par défaut commune
  `MYSQL_8_0`) ; les autres moteurs ne sont pas pris en charge.
- **Cloud SQL est accessible via le sidecar Auth Proxy sur loopback.** La variante définit
  `DB_HOST = 127.0.0.1` ; un sidecar cloud-sql-proxy (`enable_cloudsql_volume = true`)
  écoute sur `127.0.0.1:3306`, et le point d'entrée du wrapper aliasse l'injecté
  `DB_*` sur `DOLI_DB_*`.
- **Réplica unique par défaut.** `min_instance_count = 1`, `max_instance_count = 1`.
  Dolibarr conserve l'état de session et de verrouillage ; la charge de travail basée sur NFS se déploie avec la
  stratégie `Recreate`, donc ne pas dépasser 1 sans vérifier le comportement du stockage partagé.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/lib/dolibarr`)
  afin que les documents téléchargés et les PDF générés persistent et puissent être partagés entre les pods.
- **L'affinité de session est `ClientIP`** afin que les requêtes d'un client atteignent le même pod.
- **Auto-installation au premier démarrage.** `DOLI_INSTALL_AUTO = 1` fait en sorte que l'installateur Dolibarr
  crée le schéma au premier démarrage ; il n'y a pas de job de migration séparé.
- **`DOLI_ADMIN_PASSWORD` et `DOLI_INSTANCE_UNIQUE_ID` sont générés automatiquement**
  et stockés dans Secret Manager. Le mot de passe administrateur crée le compte super-administrateur
  (nom d'utilisateur `DOLI_ADMIN_LOGIN`, par défaut `admin`) au premier démarrage.
- **`DOLI_URL_ROOT` n'est pas prédéfini sur GKE.** Définissez-le via `environment_variables` sur l'URL
  du LoadBalancer externe ou du domaine personnalisé une fois l'IP attribuée, afin que les liens absolus
  et les redirections de connexion se résolvent correctement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que vous avez exécuté
`gcloud container clusters get-credentials <cluster> --region <region> --project <project>`
et que `PROJECT`, `REGION` et `NAMESPACE` sont définis. L'espace de noms et les autres
identifiants sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. GKE Autopilot — la charge de travail Dolibarr {#a-gke-autopilot--the-dolibarr-workload}

Les pods Dolibarr sont planifiés sur Autopilot, qui facture le CPU/la mémoire que les pods
demandent réellement. Comme la charge de travail est basée sur NFS, le déploiement utilise la
stratégie `Recreate` (une mise à jour progressive exécuterait deux pods sur le même volume NFS
et la même base de données partagée et provoquerait un blocage).

- **Console :** Kubernetes Engine → Charges de travail → sélectionnez la charge de travail Dolibarr pour
  les pods, les révisions et les événements. Kubernetes Engine → Services et Ingress affiche l'IP
  externe.
- **CLI :**
  ```bash
  kubectl get pods,svc -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" deploy/<service-name> --tail=100
  kubectl describe pod -n "$NAMESPACE" -l app=<service-name>
  ```

Voir [App_GKE](App_GKE.md) pour la gestion d'Autopilot, de la mise à l'échelle et du type de charge de travail
(Deployment vs StatefulSet).

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Dolibarr stocke toutes les données d'application (tiers, factures, produits, utilisateurs,
comptabilité) dans une instance Cloud SQL gérée pour MySQL 8.0. Les pods l'atteignent via le
sidecar **Cloud SQL Auth Proxy** sur `127.0.0.1:3306` ; aucune IP publique n'est exposée. Lors du
premier déploiement, le job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations ;
l'installateur Dolibarr crée ensuite le schéma.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret Secret Manager contenant le
mot de passe sont tous dans les [Sorties](#5-outputs). Voir [App_GKE](App_GKE.md) pour le
modèle de connexion, les sauvegardes automatisées et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `dolibarr-documents`) est provisionné
automatiquement et le compte de service de la charge de travail se voit accorder l'accès. Séparément,
l'arborescence des documents de Dolibarr se trouve sur **NFS (Cloud Filestore)** à `/var/lib/dolibarr`,
partagée entre les pods.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~dolibarr-documents"
  gcloud filestore instances list --project "$PROJECT"
  kubectl get pvc -n "$NAMESPACE"
  ```

Voir [App_GKE](App_GKE.md) pour les options CMEK et les montages GCS Fuse.

### D. Secret Manager {#d-secret-manager}

Deux secrets Dolibarr sont générés automatiquement et stockés dans Secret Manager :
`DOLI_ADMIN_PASSWORD` (le mot de passe super-administrateur au premier démarrage) et
`DOLI_INSTANCE_UNIQUE_ID` (un sel de sécurité par instance). Le mot de passe de la base de données est
géré séparément par la fondation. Sur GKE, les secrets sont projetés dans les pods via
le pilote CSI Secret Store.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~dolibarr"
  gcloud secrets versions access latest --secret=<admin-password-secret-name> --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour l'intégration et la rotation de Secret Store CSI.

### E. Réseau et ingress {#e-networking--ingress}

Par défaut, la charge de travail est exposée via une IP externe Cloud Load Balancing
(`service_type = LoadBalancer`, `reserve_static_ip = true` afin que l'adresse survive aux
redéploiements). Un domaine personnalisé avec un certificat géré par Google peut être activé.

- **Console :** Services réseau → Équilibrage de charge ; Réseau VPC → Adresses IP.
- **CLI :**
  ```bash
  kubectl get svc,ingress -n "$NAMESPACE"
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_GKE](App_GKE.md) pour les domaines personnalisés, Cloud CDN et les détails de l'IP statique.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les flux stdout/stderr des pods vers Cloud Logging ; les métriques GKE et Cloud SQL vers Cloud
Monitoring. Des tests de disponibilité et des politiques d'alerte optionnels sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud logging read 'resource.type="k8s_container" AND resource.labels.namespace_name="'"$NAMESPACE"'"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Dolibarr {#3-dolibarr-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte à Cloud SQL (socket Unix sous `/cloudsql` via le
  sidecar Auth Proxy), crée de manière idempotente la base de données de l'application, l'utilisateur et les
  autorisations, vérifie que l'utilisateur de l'application peut se connecter, puis arrête le sidecar proxy. Le
  job peut être réexécuté en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Auto-installation au premier démarrage (pas de job de migration séparé).** Avec
  `DOLI_INSTALL_AUTO = 1`, l'image Dolibarr exécute son propre installateur au premier démarrage du pod,
  créant le schéma dans la base de données vide. Les mises à niveau de version exécutent les étapes de mise à niveau
  propres à l'image au démarrage.
- **Compte administrateur.** L'installateur crée un super-administrateur dont le nom d'utilisateur est
  `DOLI_ADMIN_LOGIN` (par défaut `admin`) et dont le mot de passe est le secret généré
  `DOLI_ADMIN_PASSWORD`. Récupérez-le avant la première connexion.
- **Alias de variable d'environnement DB sur loopback.** La plateforme injecte `DB_HOST = 127.0.0.1`
  (le sidecar proxy) et les autres valeurs `DB_*` ; Dolibarr lit `DOLI_DB_*`. Le
  point d'entrée du wrapper les aliasse et préfère les valeurs injectées aux valeurs par défaut
  `mysql`/`dolidb` intégrées à l'image.
- **Les déploiements basés sur NFS utilisent `Recreate`.** Les mises à jour terminent l'ancien pod avant
  de démarrer le nouveau, évitant ainsi que deux pods ne se bloquent sur le volume NFS partagé et les verrous de la base de données.
- **Définissez `DOLI_URL_ROOT` une fois l'IP connue.** Il n'est pas prédéfini sur GKE — corrigez le
  déploiement ou définissez `environment_variables` sur l'URL externe une fois l'IP du LoadBalancer
  attribuée :
  ```bash
  kubectl patch deploy <service-name> -n "$NAMESPACE" \
    -p '{"spec":{"template":{"spec":{"containers":[{"name":"dolibarr","env":[
      {"name":"DOLI_URL_ROOT","value":"https://dolibarr.example.com"}]}]}}}}'
  ```
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 80 ; la sonde de vivacité est **HTTP**
  `GET /` (la page de connexion renvoie 200 sans authentification). Prévoyez plusieurs minutes au premier
  démarrage pour l'installateur.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  kubectl get jobs -n "$NAMESPACE"
  kubectl logs -n "$NAMESPACE" job/<db-init-job-name>
  kubectl exec -n "$NAMESPACE" deploy/<service-name> -- env | grep DOLI_DB
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Dolibarr sont listés ; toute autre entrée est
héritée de [App_GKE](App_GKE.md) avec son comportement standard et ses valeurs par défaut.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `dolibarr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_version` | `latest` | Tag d'image `dolibarr/dolibarr` utilisé comme base de construction personnalisée ; `latest` est épinglé à un tag connu et valide (`23.0.3`) au moment de la construction. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; à augmenter pour les modules lourds/grandes bibliothèques de documents. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement / POST ; conserver `post_max_size ≥ upload_max_filesize`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `cpu_limit` | `1000m` | 1 vCPU minimum pour Dolibarr + MySQL. |
| `memory_limit` | `2Gi` | Minimum 512 Mi ; 2 Gi recommandés pour la production. |
| `min_instance_count` | `1` | Maintenir à 1 pour que la charge de travail reste accessible. |
| `max_instance_count` | `1` | **Maintenir à 1** sauf si le partage multi-pod est vérifié. |
| `container_port` | `80` | Dolibarr fonctionne sur Apache, port 80. |
| `enable_cloudsql_volume` | `true` | Sidecar Auth Proxy (loopback) — requis sur GKE. |

### Groupe 6 — Backend GKE et cluster {#group-6--gke-backend--cluster}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `service_type` | `LoadBalancer` | IP externe pour l'interface utilisateur de Dolibarr. |
| `workload_type` | `null` → `Deployment` | Déploiement (basé sur NFS, stratégie `Recreate`). |
| `session_affinity` | `ClientIP` | Routage persistant pour qu'un client atteigne le même pod. |

### Groupe 13 — Système de fichiers (NFS) {#group-13--filesystem-nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est activé par défaut afin que les documents téléchargés persistent et soient partagés. |
| `nfs_mount_path` | `/var/www/documents` | Où Dolibarr stocke les documents/PDFs. |

### Groupe 16 — Backend de base de données {#group-16--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `null` → `MYSQL_8_0` | Conserve la valeur par défaut commune de MySQL 8.0. |
| `application_database_name` | `dolibarr` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `dolibarr` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |

### Groupe 19 — Domaine personnalisé, IP statique et réseau {#group-19--custom-domain-static-ip--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `reserve_static_ip` | `true` | IP externe stable sur les redéploiements. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés + certificat géré. |

Toutes les autres entrées suivent le comportement standard de [App_GKE](App_GKE.md).

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen le plus rapide de
localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes. |
| `namespace` | Espace de noms dans lequel la charge de travail s'exécute. |
| `service_cluster_ip` | ClusterIP intra-cluster. |
| `stage_service_cluster_ips` | Carte des ClusterIPs pour les services spécifiques à l'étape. |
| `service_external_ip` | IP du LoadBalancer externe (lorsqu'une IP statique est réservée). |
| `service_url` | URL pour atteindre Dolibarr. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (127.0.0.1 via l'Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `initialization_jobs` / `db_import_job` | Noms des jobs de configuration (`db-init`) et d'importation (facultatif). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `github_repository_url` / `github_repository_owner` / `github_repository_name` | Détails GitHub CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `kubernetes_ready` | Indique si le cluster/la charge de travail est prêt. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_GKE](App_GKE.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `StatefulSet` forcé à côté d'un paramètre sans état, IAP sans identités autorisées, `quota_memory_*` donné comme des entiers bruts, un `container_port`/`backup_retention_days` hors de portée. Une configuration invalide échoue à la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `null` (→ `MYSQL_8_0`) | Critique | La sélection d'un moteur non-MySQL interrompt l'installateur et toutes les requêtes. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `DOLI_INSTANCE_UNIQUE_ID` (auto-généré) | Ne jamais changer | Critique | La modification du sel après le premier démarrage invalide les jetons signés et les URL cron. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les documents/PDFs téléchargés éphémères — perdus lors de la recréation du pod. |
| `enable_cloudsql_volume` | `true` | Élevé | Le sidecar Auth Proxy sur `127.0.0.1:3306` est requis pour la connectivité à la base de données sur GKE. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans un comportement de stockage partagé/verrouillage vérifié risque des sessions fractionnées et des conflits de verrouillage NFS/DB. |
| `session_affinity` | `ClientIP` | Élevé | Sans persistance, les requêtes rebondissent entre les pods et perturbent les sessions authentifiées. |
| `DOLI_URL_ROOT` (défini après que l'IP est connue) | URL du LoadBalancer externe/domaine | Élevé | Une URL racine erronée ou manquante rompt les liens absolus et la redirection de connexion. |
| `memory_limit` | `2Gi` | Élevé | En dessous de 512 Mi, le pod PHP/Apache manque de mémoire sous charge. |
| `quota_memory_requests` / `_limits` | unités binaires (`4Gi`, `8192Mi`) | Critique | Les entiers bruts sont traités comme des octets et bloquent toute planification de pod dans l'espace de noms. |
| `DOLI_ADMIN_PASSWORD` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous bloque l'accès au premier compte super-administrateur jusqu'à la réinitialisation via la base de données. |
| `reserve_static_ip` | `true` | Moyen | Sans cela, l'IP externe peut changer lors des redéploiements, rompant le DNS et `DOLI_URL_ROOT`. |
| `backup_retention_days` | `7` (à augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — IAM et Workload Identity,
autoscaling, ingress et certificats, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_GKE](App_GKE.md)**.
La configuration d'application spécifique à Dolibarr partagée avec la variante Cloud Run est
décrite dans **[Dolibarr_Common](Dolibarr_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Dolibarr sur GKE Autopilot](../labs/Dolibarr_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Dolibarr sur Google Cloud Run](Dolibarr_CloudRun.md) — la même application sur Cloud Run, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Dolibarr Common — Configuration d'application partagée](Dolibarr_Common.md) — la configuration partagée par les deux cibles de déploiement.
