---
title: "Module Jitsi GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Jitsi sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Jitsi_GKE.md @ 2829548 sha256:1556892b817d -->

# Module Jitsi GKE — Guide de configuration {#jitsi-gke-module--configuration-guide}

Ce guide décrit toutes les variables de configuration disponibles dans le module `Jitsi_GKE`. `Jitsi_GKE` est un **module wrapper** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Jitsi_Common`](./Jitsi_Common.md) pour déployer [Jitsi Meet](https://jitsi.org/jitsi-meet/) — une solution de visioconférence open source basée sur un navigateur, sans compte requis pour participer — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Jitsi GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Jitsi** sont décrites en détail ici.

> **Note :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE uniquement :** Le pont vidéo de Jitsi transporte tout l'audio et la vidéo sur le **port UDP 10000** et doit annoncer une adresse publique fixe aux navigateurs. Cloud Run ne peut pas accepter l'UDP entrant, donc Jitsi n'est proposé que sur GKE.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section du guide App_GKE | Notes spécifiques à Jitsi |
|---|---|---|
| Projet et identité | Groupe 1 — Projet et identité | Identique. `region` place également l'IP statique du pont vidéo. |
| Identité de l'application | Groupe 3 — Identité de l'application | `application_version` épingle **les quatre** images ; voir [Groupe 3](#group-3-application-identity). |
| Exécution et mise à l'échelle | Groupe 4 — Exécution et mise à l'échelle | `container_image_source = "prebuilt"`, `container_port = 80` ; voir [Groupe 4](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | Groupe 5 — Variables d'environnement et secrets | Entrées spécifiques à Jitsi `public_url`, `xmpp_domain`, `enable_auth`, `enable_guests`, `timezone` ; voir [Groupe 5](#group-5-environment-variables--secrets). |
| Configuration du backend GKE | Groupe 6 — Configuration du backend GKE | `service_type = "ClusterIP"` ; ajoute `jvb_port` ; voir [Groupe 6](#group-6-gke-backend-configuration). |
| Services additionnels | Groupe 11 — Automatisation des charges de travail | prosody, jicofo et jvb sont fournis par `Jitsi Common` ; voir [Groupe 11](#group-11-workload-automation). |
| Stockage — NFS | Groupe 13 — Stockage NFS | Activé par défaut mais inutilisé par Jitsi ; voir [Groupe 13](#group-13-nfs). |
| Stockage — GCS | Groupe 14 — Cloud Storage | Un bucket `data` est créé par défaut mais inutilisé par Jitsi ; voir [Groupe 14](#group-14-cloud-storage). |
| Configuration de la base de données | Groupe 16 — Configuration de la base de données | **Pas de base de données** — moteur fixé à `NONE` ; voir [Groupe 16](#group-16-database). |
| Planification et rétention des sauvegardes | Groupe 17 — Sauvegarde et maintenance | Non applicable (pas de base de données). |
| Scripts SQL personnalisés | Groupe 18 — Scripts SQL personnalisés | Non applicable (pas de base de données). |
| Observabilité et vérifications de santé | Groupe 10 — Observabilité | `startup_probe_config` / `health_check_config` **sont** les sondes web déployées ; voir [Groupe 10](#group-10-observability--health). |
| Cloud Armor WAF | Groupe 21 — Cloud Armor et CDN | Protège le point d'entrée web uniquement — pas l'équilibreur de charge UDP jvb. |
| Proxy sensible à l'identité (IAP) | Groupe 20 — Proxy sensible à l'identité | Protège le point d'entrée web uniquement. |
| Autorisation binaire | Groupe 12 — CI/CD | Identique. |
| Contrôles de service VPC | Groupe 22 — Contrôles de service VPC et journalisation d'audit | Identique. |
| Pilote CSI du magasin de secrets | Groupe 5 — Variables d'environnement et secrets | Toujours activé — aucune configuration requise. |
| Trafic et Ingress | Groupe 19 — Accès et réseau | Web via la passerelle ; média via un équilibreur de charge UDP séparé. |
| Domaine personnalisé et IP statique | Groupe 19 — Accès et réseau | Définir `public_url` pour correspondre ; voir [Groupe 19](#group-19-custom-domain--networking). |
| Déclencheurs Cloud Build | Groupe 12 — CI/CD | Identique. |
| Pipeline Cloud Deploy | Groupe 12 — CI/CD | Identique. |
| Mise en miroir des images | Groupe 4 — Exécution et mise à l'échelle | S'applique à l'image web. |
| Budgets d'interruption de pod | Groupe 9 — Fiabilité | Activé par défaut pour la charge de travail web. |
| Cache Redis | Groupe 15 — Cache Redis | Non utilisé par aucun composant Jitsi. |

---

## Comment Jitsi GKE est lié à App GKE {#how-jitsi-gke-relates-to-app-gke}

`Jitsi GKE` transmet ses variables à `App GKE` et ajoute un sous-module `Jitsi Common` qui fournit la configuration spécifique à Jitsi. Il crée également une ressource propre. Les principaux effets sont les suivants :

1.  **Quatre images, une étiquette.** `jitsi/web` est le conteneur principal ; `jitsi/prosody`, `jitsi/jicofo` et `jitsi/jvb` sont fournis en tant que `additional_services`. Les quatre utilisent l'étiquette `application_version` (par défaut `stable-11031`). Le mélange de versions n'est pas pris en charge — jicofo et jvb utilisent un protocole versionné pour communiquer avec prosody — et aucune des images n'a d'étiquette `latest`.
2.  **Pas de build, pas de base de données.** `container_image_source = "prebuilt"` : les images amont sont entièrement configurées via des variables d'environnement, il n'y a donc pas de Dockerfile. `database_type` est fixé à `NONE` par `Jitsi Common` ; aucune instance Cloud SQL, aucun utilisateur de base de données ni aucun job d'initialisation n'est créé.
3.  **Une adresse réservée pour le pont vidéo.** Le wrapper crée une adresse `google_compute_address` externe régionale nommée `<service-name>-jvb` et la transmet à jvb en tant que `JVB_ADVERTISE_IPS` (et `DOCKER_HOST_ADDRESS`). jvb transmet cette adresse aux navigateurs dans les candidats ICE, elle doit donc être connue avant le démarrage de jvb — une IP éphémère d'équilibreur de charge n'est connue qu'après. `JVB_DISABLE_STUN = "true"` car l'adresse annoncée est déjà publique.
4.  **Média sur son propre équilibreur de charge UDP.** Le service de jvb est un `LoadBalancer` sur **UDP 10000** épinglé à cette adresse. GCP ne permet pas à un service d'équilibreur de charge de mélanger TCP et UDP, donc jvb ne peut pas partager le service web. Il n'y a pas de repli TCP dans cette build.
5.  **Web derrière la passerelle.** `service_type = "ClusterIP"` ; le navigateur atteint `jitsi/web` sur le port 80 via la passerelle L7, qui termine le TLS. Le conteneur est configuré pour ne pas effectuer le TLS lui-même (`ENABLE_LETSENCRYPT = 0`, `DISABLE_HTTPS = 1`).
6.  **prosody est trouvé par le nom du service.** Le docker-compose amont atteint prosody via un alias réseau. Kubernetes n'en a pas, donc le wrapper calcule le nom du service prosody (`<service-name>-prosody`) à partir du même module `deployment_id` que `App GKE` utilise et le définit comme `XMPP_SERVER`.
7.  **Mots de passe de composants générés.** `Jitsi Common` génère `JICOFO_AUTH_PASSWORD` et `JVB_AUTH_PASSWORD`, les stocke dans Secret Manager (réplication régionale, gérée par l'utilisateur), et les trois conteneurs backend les lisent à partir du même secret Kubernetes, de sorte que prosody provisionne les comptes avec exactement les mots de passe utilisés par les composants.
8.  **Les sondes atteignent le conteneur déployé.** Contrairement à certains wrappers, `Jitsi GKE` transmet `startup_probe_config` et `health_check_config` à `Jitsi Common` en tant que sondes de démarrage/vivacité `startup_probe`/`liveness_probe` du conteneur web, de sorte que les modifier modifie les sondes déployées. Les conteneurs backend n'ont pas de sondes.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity).

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | *(obligatoire)* | Projet GCP dans lequel `Services_GCP` a été déployé. |
| `tenant_id` | `"demo"` | 1 à 7 caractères alphanumériques minuscules ajoutés aux noms de ressources. |
| `region` | `"us-central1"` | Région de repli lorsque la découverte de sous-réseau VPC ne peut pas en déterminer une. La région découverte (ou de repli) est également l'endroit où l'IP statique jvb et les deux répliques Secret Manager sont créées. |

---

## Groupe 2 : Environnement de déploiement {#group-2-deployment-environment}

Identique à `App_GKE` : `support_users` (`[]`) reçoivent les alertes de surveillance ; `resource_labels` (`{}`) sont appliqués à chaque ressource.

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

| Variable | Valeur par défaut Jitsi GKE | Valeur par défaut App GKE | Notes |
|---|---|---|---|
| `application_name` | `"jitsi"` | `"gkeapp"` | Nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Jitsi Meet"` | `"App GKE Application"` | Affiché dans l'interface utilisateur de la plateforme. Peut être modifié librement. |
| `application_description` | `"Jitsi Meet — open-source video conferencing: browser-based meetings with no account required."` | — | Étiquette descriptive. |
| `application_version` | `"stable-11031"` | `"1.0.0"` | Étiquette appliquée à **toutes les quatre** images. Ne la modifiez que pour une autre étiquette `stable-NNNN` publiée qui existe pour web, prosody, jicofo et jvb. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

| Variable | Valeur par défaut Jitsi GKE | Notes |
|---|---|---|
| `container_image_source` | `"prebuilt"` | Gardez `"prebuilt"`. Jitsi ne fournit pas de Dockerfile ; `"custom"` rendrait une étape Cloud Build sans Dockerfile à construire. |
| `container_image` | `"jitsi/web"` | L'image web ; l'étiquette provient de `application_version`. |
| `enable_image_mirroring` | `true` | Met en miroir l'image web dans Artifact Registry. |
| `container_port` | `80` | Fixé par `Jitsi Common` — `jitsi/web` sert du HTTP simple sur le port 80. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | S'applique uniquement au conteneur **web**, et seules les limites sont transmises. Les conteneurs backend ont des limites fixes : prosody `1000m`/`1Gi`, jicofo `1000m`/`2Gi`, jvb `1000m`/`2Gi`. |
| `min_instance_count` | `1` | Répliques web minimales. |
| `max_instance_count` | `3` | Répliques web maximales. prosody, jicofo et jvb sont fixés à **une réplique chacun** et ne sont pas mis à l'échelle par ces variables. |
| `enable_cloudsql_volume` | `false` | Pas de base de données. Le définir `true` est rejeté au moment de la planification tant que `database_type = "NONE"`. |

Les variables d'exécution restantes (`deploy_application`, `container_build_config`, `cloudsql_volume_mount_path`, `service_annotations`, `service_labels`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-4--runtime--scaling).

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables spécifiques à Jitsi sont transmises à `Jitsi Common` :

| Variable | Valeur par défaut | Description |
|---|---|---|
| `public_url` | `""` | URL publique utilisée par les navigateurs, par exemple `"https://meet.example.com"`. Définie comme `PUBLIC_URL` sur le web et prosody et écrite dans la configuration que l'application web sert — une mauvaise valeur donne une page qui se charge mais ne peut pas se connecter. **Non dérivée automatiquement.** |
| `xmpp_domain` | `"meet.jitsi"` | Racine de la famille de domaines XMPP interne. Les sous-domaines `auth.`, `guest.`, `muc.`, `internal-muc.` et `recorder.` en sont dérivés. Ce sont les hôtes virtuels de prosody, jamais résolus dans le DNS public. Les quatre conteneurs doivent être d'accord — laissez la valeur par défaut à moins que vous ne sachiez pourquoi vous la modifiez. |
| `enable_auth` | `false` | `ENABLE_AUTH` : exige une authentification pour **créer** une salle. |
| `enable_guests` | `true` | `ENABLE_GUESTS` : permet aux participants non authentifiés de rejoindre les salles créées par un utilisateur authentifié. |
| `timezone` | `"UTC"` | `TZ` sur chaque conteneur. |

**Variables d'environnement que le module définit sur `jitsi/web` :**

| Variable | Valeur |
|---|---|
| `PUBLIC_URL` | `var.public_url` |
| `XMPP_DOMAIN`, `XMPP_AUTH_DOMAIN`, `XMPP_GUEST_DOMAIN`, `XMPP_MUC_DOMAIN`, `XMPP_INTERNAL_MUC_DOMAIN`, `XMPP_RECORDER_DOMAIN` | Dérivé de `xmpp_domain` |
| `XMPP_SERVER` | `<service-name>-prosody` |
| `XMPP_BOSH_URL_BASE` | `http://<service-name>-prosody:5280` |
| `XMPP_WEBSOCKET` | `/xmpp-websocket` (un chemin sur l'origine publique, proxifié par le web) |
| `ENABLE_AUTH`, `ENABLE_GUESTS` | `"1"`/`"0"` des variables ci-dessus |
| `ENABLE_LETSENCRYPT` | `"0"` |
| `DISABLE_HTTPS` | `"1"` |

Les entrées `environment_variables` sont fusionnées **sur** celles-ci sur le conteneur web (elles n'atteignent pas prosody, jicofo ou jvb). `secret_environment_variables` s'ajoute aux deux mots de passe de composants générés.

**Secrets créés par `Jitsi Common` :**

| Secret | Variable d'environnement | Lu par |
|---|---|---|
| `secret-<prefix>-jitsi-jicofo-auth` | `JICOFO_AUTH_PASSWORD` | prosody, jicofo |
| `secret-<prefix>-jitsi-jvb-auth` | `JVB_AUTH_PASSWORD` | prosody, jvb |

Les deux sont des valeurs aléatoires de 32 caractères sans caractères spéciaux, répliquées uniquement dans la région de déploiement (`user_managed`), car la politique d'emplacement de dossier sur les projets gérés par RAD refuse les secrets `global`.

Les variables restantes (`protect_sensitive_environment_variables`, `secret_propagation_delay`, `secret_rotation_period`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Configuration du backend GKE {#group-6-gke-backend-configuration}

| Variable | Valeur par défaut Jitsi GKE | Notes |
|---|---|---|
| `service_type` | `"ClusterIP"` | Le service web. La passerelle a déjà une adresse externe ; un `LoadBalancer` ici alloue une **deuxième** IP externe pour la même surface HTTP, ce qui, sur un projet soumis à un quota, peut laisser les équilibreurs de charge web et jvb bloqués en `<pending>`. |
| `service_port` | `80` | Port sur le service web. |
| `jvb_port` | `10000` | Port UDP du service videobridge et `JVB_PORT`. Le service jvb est toujours `LoadBalancer` et toujours UDP. |
| `session_affinity` | `"ClientIP"` | Affinité du service web. |
| `workload_type` | `"Deployment"` | La charge de travail web. |
| `termination_grace_period_seconds` | `30` | — |
| `deployment_strategy` | `null` | Déclaré mais non référencé — sans effet. |

`namespace_name` et `enable_network_segmentation` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-6--gke-backend-config).

---

## Groupe 7 : Charges de travail avec état {#group-7-stateful-workloads}

Identique à `App_GKE`. Jitsi ne stocke rien sur disque, donc `stateful_pvc_enabled` (par défaut `false`) devrait rester désactivé.

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_pod_disruption_budget` | `true` | Crée un PodDisruptionBudget pour la charge de travail web. |
| `pdb_min_available` | `"1"` | Avec une seule réplique web, cela signifie que les évictions volontaires (mises à niveau de nœuds) attendent un remplacement. |

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

`startup_probe_config` et `health_check_config` sont transmis à `Jitsi Common` en tant que sondes de démarrage et de vivacité du conteneur **web**, ce sont donc les sondes qui s'exécutent réellement.

| Sonde | Chemin | Délai initial | Délai d'expiration | Période | Seuil d'échec |
|---|---|---|---|---|---|
| Démarrage (`startup_probe_config`) | `/` (HTTP) | 60s | 5s | 10s | 3 |
| Vivacité (`health_check_config`) | `/` (HTTP) | 60s | 5s | 30s | 3 |

prosody, jicofo et jvb n'ont pas de sondes, donc un conteneur backend qui est en cours d'exécution mais non connecté (par exemple jvb refusé par prosody) n'est pas redémarré automatiquement — vérifiez leurs logs.

`uptime_check_config` est par défaut `{ enabled = false, path = "/" }`. `alert_policies` se comporte comme décrit dans [App_GKE](./App_GKE.md#group-10--observability).

---

## Groupe 11 : Automatisation des charges de travail {#group-11-workload-automation}

`Jitsi Common` fournit toujours trois `additional_services` ; vos propres entrées `additional_services` leur sont **ajoutées**.

| Service | Image | Type de service | Ports | Limites |
|---|---|---|---|---|
| `prosody` | `jitsi/prosody:<version>` | ClusterIP | TCP 5222, 5280 (`bosh`), 5347 (`xmpp-component`) | `1000m` / `1Gi` |
| `jicofo` | `jitsi/jicofo:<version>` | ClusterIP | TCP 8888 (requis pour construire un service ; rien ne s'y connecte) | `1000m` / `2Gi` |
| `jvb` | `jitsi/jvb:<version>` | **LoadBalancer** sur l'IP réservée | **UDP** `jvb_port` (10000) | `1000m` / `2Gi` |

Chacun exécute une réplique. jicofo rejoint le MUC `jvbbrewery` sur le domaine MUC interne pour découvrir le pont ; prosody provisionne les comptes `focus` (jicofo) et `jvb`.

`initialization_jobs` est vide (Jitsi n'en a pas besoin) et `cron_jobs` se comporte comme décrit dans [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Groupe 12 : CI/CD et intégration GitHub {#group-12-cicd--github-integration}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd). Variables : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `github_app_installation_id`, `cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`, `enable_binary_authorization`.

---

## Groupe 13 : NFS {#group-13-nfs}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Monte le partage NFS `Services_GCP` dans le pod web. Aucun composant Jitsi ne le lit ou ne l'écrit. |
| `nfs_mount_path` | `"/mnt/nfs"` | — |

`nfs_volume_name`, `nfs_instance_name` et `nfs_instance_base_name` se comportent comme décrit dans [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Groupe 14 : Cloud Storage {#group-14-cloud-storage}

`create_cloud_storage = true` avec la valeur par défaut `storage_buckets = [{ name_suffix = "data" }]` crée un bucket. Jitsi ne l'utilise pas, et `Jitsi Common` ne déclare aucun bucket propre. Les variables restantes de stockage et de rétention d'images se comportent comme décrit dans [App_GKE](./App_GKE.md#group-14--cloud-storage).

---

## Groupe 15 : Redis {#group-15-redis}

`enable_redis` (par défaut `false`), `redis_host`, `redis_port`, `redis_auth` se comportent comme dans [App_GKE](./App_GKE.md#group-15--redis-cache). Aucun composant Jitsi n'utilise Redis.

---

## Groupe 16 : Base de données {#group-16-database}

Jitsi n'a pas de base de données. `Jitsi Common` définit `database_type = "NONE"` dans la configuration de l'application, et c'est ce que `App GKE` provisionne indépendamment du propre `database_type` du wrapper (par défaut `"NONE"`), qui ne fait qu'alimenter les gardes de validation au moment de la planification. `application_database_name`/`application_database_user` (`"jitsi"`), `database_password_length`, les variables d'extension PostgreSQL/MySQL, `enable_auto_password_rotation` et les alias `db_*_env_var_name` n'ont aucun effet.

---

## Groupes 17-18 : Sauvegarde et maintenance, SQL personnalisé {#groups-1718-backup--maintenance-custom-sql}

Non applicable. `enable_backup_import` et `enable_custom_sql_scripts` sont rejetés au moment de la planification tant que `database_type = "NONE"`.

---

## Groupe 19 : Domaine personnalisé et réseau {#group-19-custom-domain--networking}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-19--access--networking).

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_custom_domain` | `true` | Provisionne la passerelle pour le service web. |
| `application_domains` | `[]` | Vide utilise un nom d'hôte `nip.io` gratuit dérivé de l'IP réservée de la passerelle, avec un certificat géré par Google. |
| `reserve_static_ip` | `true` | IP statique globale pour la passerelle (séparée de l'IP régionale jvb). |

> **Définissez `public_url` pour qu'il corresponde.** Lorsque vous servez sur un domaine personnalisé, définissez `public_url = "https://<your-domain>"`. Les navigateurs n'accordent l'accès à la caméra et au microphone que sur des origines sécurisées (HTTPS), alors testez les appels via l'URL HTTPS.

---

## Groupes 20-22 : IAP, Cloud Armor, contrôles de service VPC {#groups-2022-iap-cloud-armor-vpc-service-controls}

Identique à `App_GKE` — voir [App_GKE](./App_GKE.md#group-20--identity-aware-proxy). IAP et Cloud Armor s'appliquent à la passerelle (le point d'entrée web). Ils ne se trouvent **pas** devant l'équilibreur de charge UDP jvb, qui doit accepter les médias du réseau de chaque participant.

---

## Exploration du déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

**Charges de travail :** **Kubernetes Engine → Charges de travail**, filtré sur l'espace de noms du déploiement, affiche quatre déploiements — la charge de travail web plus `<service-name>-prosody`, `<service-name>-jicofo` et `<service-name>-jvb`.

**Services :** **Kubernetes Engine → Passerelles, services et Ingress** affiche le service web (ClusterIP), les services prosody et jicofo (ClusterIP) et le service jvb (`LoadBalancer`, UDP).

**Adresses IP :** **Réseau VPC → Adresses IP** liste l'adresse régionale `*-jvb` et l'adresse globale de la passerelle.

**Secrets :** **Sécurité → Secret Manager** liste les secrets `*-jicofo-auth` et `*-jvb-auth`.

### gcloud CLI et kubectl {#gcloud-cli-and-kubectl}

```bash
# Cluster credentials
gcloud container clusters get-credentials CLUSTER_NAME --region=REGION --project=PROJECT_ID

# All four workloads and their Services
kubectl get deploy,pods,svc -n NAMESPACE

# The videobridge's reserved address and its UDP forwarding rule
gcloud compute addresses list --project=PROJECT_ID --filter="name~jvb"
gcloud compute forwarding-rules list --project=PROJECT_ID --filter="IPProtocol=UDP"

# jicofo has authenticated to prosody and found the bridge
kubectl logs -n NAMESPACE deploy/SERVICE_NAME-jicofo | grep -E "authenticated|addJvbAddress"

# jvb advertises the public address (StaticMappingCandidateHarvester ... mask=<public-ip>)
kubectl logs -n NAMESPACE deploy/SERVICE_NAME-jvb | grep StaticMapping

# The web front end
curl -s -o /dev/null -w "%{http_code}\n" SERVICE_URL/
```

---

## Sorties du module {#module-outputs}

`Jitsi GKE` expose les sorties standard `App_GKE`. Celles qui sont pertinentes pour Jitsi :

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes web (également le préfixe des services prosody/jicofo/jvb) |
| `service_url` | URL du point d'entrée web (l'URL `nip.io` de la passerelle si aucun domaine personnalisé n'est défini) |
| `service_external_ip` | IP de l'équilibreur de charge externe (si l'IP statique est réservée) |
| `namespace` | Espace de noms Kubernetes |
| `deployment_id` / `resource_prefix` | Identifiants de nommage |
| `storage_buckets` | Buckets GCS créés |
| `container_image` | Image du conteneur web |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster était accessible et que les ressources Kubernetes étaient déployées |

Les sorties de la base de données sont vides. Il n'y a pas de sortie pour l'adresse jvb — lisez-la à partir du service jvb ou de l'adresse de calcul `*-jvb`.

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable / condition | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `project_id` | _(obligatoire)_ | **Critique** | Pas de valeur par défaut — le déploiement échoue immédiatement. |
| UDP 10000 vers l'IP jvb bloqué | — | **Critique** | Les appels rejoignent et listent les participants mais ne transmettent ni audio ni vidéo. Il n'y a pas de repli TCP. Vérifiez les réseaux clients et tout pare-feu devant eux. |
| `application_version` | `"stable-11031"` | **Élevé** | Les quatre images prennent cette étiquette. Une étiquette manquante sur une image entraîne l'échec du pull de ce pod ; les versions incompatibles entre les composants ne sont pas prises en charge. |
| `public_url` | `""` | **Élevé** | Écrit dans la configuration servie. Une valeur qui ne correspond pas à l'URL que les utilisateurs naviguent donne une page qui se charge mais ne peut pas se connecter. |
| `xmpp_domain` | `"meet.jitsi"` | **Élevé** | Chaque conteneur dérive ses hôtes virtuels XMPP de celui-ci ; le modifier est rarement nécessaire et une incompatibilité empêche les composants de se lier. |
| `service_type` | `"ClusterIP"` | **Moyen** | `"LoadBalancer"` ajoute une deuxième IP externe pour la surface web et peut épuiser le quota d'adresses externes du projet, laissant l'équilibreur de charge jvb `<pending>`. |
| `jvb_port` | `10000` | **Élevé** | Le modifier modifie le service et `JVB_PORT` ensemble ; toute liste blanche côté client doit également changer. |
| `container_image_source` | `"prebuilt"` | **Élevé** | `"custom"` n'a pas de Dockerfile à construire ; la construction échoue. |
| `enable_auth` | `false` | **Moyen** | Si l'authentification est désactivée, toute personne pouvant atteindre l'URL peut créer des salles. |
| `enable_cloudsql_volume` | `false` | **Faible** | `true` est rejeté au moment de la planification (pas de base de données). |
| `enable_nfs` / `create_cloud_storage` | `true` / `true` | **Faible** | Provisionné mais inutilisé par Jitsi — un petit coût évitable. |
| `max_instance_count` | `3` | **Faible** | Ne met à l'échelle que le niveau web ; il n'ajoute pas de capacité de pont vidéo. |
| `enable_pod_disruption_budget` | `true` | **Faible** | Avec une seule réplique web, les vidanges de nœuds attendent un pod de remplacement. |
| Premier apply d'un nouveau déploiement (OpenTofu exécuté directement) | — | **Moyen** | Le README `Jitsi_Common` enregistre un échec de planification (`local.additional_services will be known only after apply`) tant que l'adresse jvb n'est pas encore dans l'état ; il a été résolu par `tofu apply -target=google_compute_address.jvb`, puis `tofu apply`. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Jitsi sur GKE Autopilot](../labs/Jitsi_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Jitsi Common — Configuration d'application partagée](Jitsi_Common.md) — la configuration spécifique à Jitsi sur laquelle ce module est basé.
