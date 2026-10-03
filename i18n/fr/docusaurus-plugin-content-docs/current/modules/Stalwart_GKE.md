---
title: "Module Stalwart GKE — Guide de configuration"
description: "Référence de configuration pour le déploiement de Stalwart sur GKE Autopilot avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Stalwart_GKE.md @ 2829548 sha256:c2ef3f232a56 -->

# Module Stalwart GKE — Guide de configuration {#stalwart-gke-module--configuration-guide}

Ce guide décrit les variables de configuration disponibles dans le module `Stalwart_GKE`. `Stalwart_GKE` est un **module enveloppe** qui combine le module d'infrastructure générique [`App_GKE`](./App_GKE.md) avec la configuration d'application partagée [`Stalwart_Common`](./Stalwart_Common.md) pour déployer [Stalwart Mail Server](https://stalw.art/) — un serveur de messagerie open-source qui fournit SMTP, IMAP, POP3, JMAP et ManageSieve à partir d'un seul binaire Rust — sur Google Kubernetes Engine (GKE) Autopilot.

La plupart des options de configuration de `Stalwart GKE` correspondent directement aux mêmes options de `App GKE`. Lorsqu'une variable a un comportement identique, ce guide fait référence au guide `App GKE` plutôt que de répéter la même documentation. Seules les variables et les valeurs par défaut **spécifiques à Stalwart** sont décrites en détail ici.

> **Remarque :** Les variables marquées comme *gérées par la plateforme* sont définies et maintenues par la plateforme. Vous n'avez normalement pas besoin de les modifier.

> **GKE uniquement :** Il n'existe pas de variante Cloud Run. Les protocoles de messagerie sont des protocoles en ligne que Cloud Run ne peut pas transférer, et Stalwart fonctionne normalement sur le port 443 tandis que son port 8080 ne s'ouvre que lorsqu'il n'est pas configuré ou n'a pas réussi à démarrer — le contrat `$PORT` de Cloud Run ne serait donc satisfait que lorsque le serveur est en panne.

---

## Référence de configuration standard {#standard-configuration-reference}

Les zones de configuration suivantes sont fournies par le module sous-jacent `App_GKE`. Consultez les sections liées du [Guide de configuration App_GKE](./App_GKE.md) pour une documentation complète.

| Zone de configuration | Section App GKE.md | Notes spécifiques à Stalwart |
|---|---|---|
| Projet et identité | §2 IAM et contrôle d'accès | Identique. |
| Identité de l'application | §3.A Compute (GKE Autopilot) | Modifier le nom d'affichage `Wiki.js` restant ; voir [Groupe 3](#group-3-application-identity). |
| Exécution et mise à l'échelle | §3.A Compute (GKE Autopilot) | `container_port = 443` ; conserver un réplica ; voir [Groupe 4](#group-4-runtime--scaling). |
| Variables d'environnement et secrets | §3 Configuration du service principal | `STALWART_RECOVERY_ADMIN` appartient à `secret_environment_variables` ; voir [Groupe 5](#group-5-environment-variables--secrets). |
| Service Kubernetes et ports | §5 Trafic et Ingress | L4 `LoadBalancer` transportant 443 plus six ports de messagerie ; voir [Groupe 6 et la carte des ports](#group-6-kubernetes-service-workload--ports). |
| Charges de travail avec état | §3.A Compute (GKE Autopilot) | StatefulSet avec un PVC à `/var/lib/stalwart` ; voir [Groupe 7](#group-7-stateful-workloads). |
| Budgets d'interruption de pod | §7.A Budgets d'interruption de pod | Créé uniquement pendant `max_instance_count > 1`. |
| Observabilité et vérifications de santé | §3.A Compute (GKE Autopilot) | **Sondes TCP sur 443** ; voir [Groupe 10](#group-10-observability--health). |
| Jobs d'initialisation et CronJobs | §3.E Jobs d'initialisation et CronJobs | Pas de job d'initialisation — Stalwart crée son propre schéma. |
| CI/CD, autorisation binaire | §6 CI/CD et livraison, §4.C | Identique. |
| Stockage — NFS / GCS | §3.C Stockage (NFS / GCS / GCS Fuse) | Non utilisé par Stalwart ; voir [Groupes 13-14](#groups-13-and-14-storage). |
| Redis | §8.A Redis / Memorystore | Désactiver ; voir [Groupe 15](#group-15-redis). |
| Configuration de la base de données | §3.B Base de données (Cloud SQL) | **MySQL 8.0, fixé par `Stalwart_Common`** ; voir [Groupe 16](#group-16-database). |
| Plan de sauvegarde, importation et SQL personnalisé | §3.B, §8.B, §3.E | Identique. |
| Domaine personnalisé et IP statique | §5.C Réservation d'IP statique | IP statique sur le LoadBalancer ; pas de Gateway ; voir [Groupe 19](#group-19-custom-domain-static-ip--network-tags). |
| IAP, Cloud Armor, CDN | §4.A, §4.B, §5.B | Fonctionnalités de la Gateway (HTTP) — elles ne couvrent pas les ports de messagerie. |
| Contrôles de service VPC | §4.D Contrôles de service VPC | Identique. |

---

## Comment Stalwart GKE est lié à App GKE {#how-stalwart-gke-relates-to-app-gke}

`Stalwart GKE` transmet ses variables à `App GKE` et ajoute un sous-module `Stalwart Common` qui fournit la configuration d'application spécifique à Stalwart. Les principaux effets sont les suivants :

1. **Une image enveloppe écrit `config.json`.** Stalwart lit un seul fichier `--config /etc/stalwart/config.json` qui ne contient que sa définition de **DataStore**, et le fichier n'est pas livré dans l'image. `App_GKE` ne peut pas monter une ConfigMap dans le conteneur de l'application, donc `Stalwart_Common` construit `FROM stalwartlabs/stalwart:<version>` avec un point d'entrée qui rend le fichier à partir des `DB_IP`, `DB_PORT`, `DB_NAME` et `DB_USER` de la fondation à chaque démarrage. Le mot de passe n'est pas écrit dans le fichier — son `authSecret` est `{ "@type": "EnvironmentVariable", "variableName": "DB_PASSWORD" }`.
2. **La base de données est MySQL 8.0, accessible via l'IP privée.** `Stalwart_Common` définit `database_type = "MYSQL_8_0"` et `enable_cloudsql_volume = false` ; le `host` du DataStore est l'IP privée brute de Cloud SQL. Ces valeurs proviennent de `Stalwart_Common` et remplacent les entrées `database_type` et `enable_cloudsql_volume` de l'enveloppe, tout comme le port du conteneur (443).
3. **Il n'y a pas de job d'initialisation.** L'étape `db-create` de la fondation provisionne la base de données et l'utilisateur, et Stalwart crée ses propres tables (27 lors d'une nouvelle installation) lors de la première connexion.
4. **Le conteneur sert sur 443, jamais 8080.** Le port d'écoute HTTPS normal de Stalwart (interface d'administration, JMAP, `/healthz/live`) est 443. Le port 8080 ne s'ouvre que dans ses états de démarrage ("aucun fichier de configuration n'a été trouvé") et de récupération ("le démarrage a échoué").
5. **Les sondes sont TCP sur 443.** Le `HEALTHCHECK` de l'image est `curl https://127.0.0.1:443/healthz/live || curl http://127.0.0.1:8080/healthz/live`, qui signale un serveur cassé comme sain via le repli 8080. Une sonde HTTP n'est pas non plus possible : la sonde HTTP de `App_GKE` n'a pas de champ `scheme`, elle ne peut donc pas vérifier un port HTTPS.
6. **Le Service est un LoadBalancer TCP L4 avec les ports de messagerie ajoutés.** `service_port = 443` plus `extra_service_ports` (25, 465, 587, 993, 995, 4190).
7. **Réplica unique par conception.** Un deuxième réplica nécessite le coordinateur de Stalwart, qui nécessite Redis ; le module évite Redis. Notez que la valeur par défaut `max_instance_count` de l'enveloppe est `3` — définissez-la sur `1`.
8. **Les domaines, les écouteurs et le TLS ne sont pas configurés.** Chaque paramètre Stalwart autre que le DataStore réside dans la base de données et est appliqué avec `stalwart-cli` (une image séparée). Le module ne gère pas cette étape.

---

## Groupe 1 : Projet et identité {#group-1-project--identity}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-1--project--identity). Entrées : `project_id` (obligatoire), `tenant_id` (`"demo"`), `region` (`"us-central1"`).

---

## Groupe 2 : Environnement de déploiement {#group-2-deployment-environment}

Identique à `App_GKE` : `support_users` (`[]`) et `resource_labels` (`{}`).

---

## Groupe 3 : Identité de l'application {#group-3-application-identity}

| Variable | Valeur par défaut Stalwart GKE | Notes |
|---|---|---|
| `application_name` | `"stalwart"` | Nom de base pour toutes les ressources GCP et Kubernetes. **Ne pas modifier après le déploiement.** |
| `application_display_name` | `"Wiki.js"` | Un vestige du module à partir duquel l'enveloppe a été copiée. C'est ce que la console GCP, la description de l'IP statique et les tableaux de bord affichent — définissez-le sur `"Stalwart Mail Server"` ou similaire. |
| `application_description` | `"Wiki.js - The most powerful and extensible open source Wiki software"` | Également un vestige, mais **non utilisé** — la description de la charge de travail provient de `Stalwart_Common` ("Stalwart — serveur de messagerie et de collaboration open-source…"). |
| `application_version` | `"v0.16.22"` | Tag `stalwartlabs/stalwart`, passé à la build comme `STALWART_VERSION`. **Épinglez une version exacte** — cette valeur remplace la valeur par défaut `_Common`. Une reconstruction sous un tag inchangé ne produit pas de diff Terraform. |

---

## Groupe 4 : Exécution et mise à l'échelle {#group-4-runtime--scaling}

| Variable | Valeur par défaut Stalwart GKE | Notes |
|---|---|---|
| `container_port` | `443` | **Sans effet** — `App_GKE` prend le port du conteneur de `Stalwart_Common`, qui le fixe à 443, le port d'écoute HTTPS normal de Stalwart (jamais 8080, le port de démarrage/récupération). Les sondes TCP vérifient ce port. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "2Gi" }` | Également passé à `Stalwart_Common` comme limites du conteneur. |
| `min_instance_count` | `1` | Gardez au moins un réplica — le courrier doit être reçu en continu. |
| `max_instance_count` | `3` | **Définir sur `1`.** Toute valeur supérieure à 1 crée un HorizontalPodAutoscaler (min `min_instance_count`, max cette valeur, mise à l'échelle sur l'utilisation du CPU et de la mémoire) et un PodDisruptionBudget. Un deuxième réplica nécessite le coordinateur de Stalwart, qui nécessite Redis, que ce module ne configure pas. |
| `container_image_source` | `"custom"` | Construit l'image de l'enveloppe. `"prebuilt"` déploierait une image sans le générateur `config.json` ; Stalwart ne trouverait alors aucune configuration et ouvrirait le port 8080. |
| `container_image` | `"stalwartlabs/stalwart"` | Référence de l'image de base. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image dans Artifact Registry. |
| `enable_cloudsql_volume` | `true` | **Sans effet** — `Stalwart_Common` le définit toujours sur `false` (pas de sidecar Auth Proxy). |
| `service_annotations` / `service_labels` | `{}` | Appliqué au Service Kubernetes **uniquement lors de la création** ; `App_GKE` ignore les modifications ultérieures. |

---

## Groupe 5 : Variables d'environnement et secrets {#group-5-environment-variables--secrets}

Ces variables se comportent de manière identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

**Comportement spécifique à Stalwart :**

`Stalwart_Common` définit deux variables d'environnement, et `environment_variables` est fusionné par-dessus :

| Variable | Valeur par défaut | Objectif |
|---|---|---|
| `STALWART_PUBLIC_URL` | `""` | URL de base publiée pour la découverte OAuth, OIDC et JMAP. Laissée vide volontairement — une mauvaise valeur est transmise aux clients dans les documents de découverte. L'enveloppe n'a pas d'entrée dédiée pour cela ; définissez-la via `environment_variables` une fois que vous avez un domaine (par exemple `https://mail.example.com`). |
| `STALWART_DATASTORE_TYPE` | `"MySql"` | Le `@type` du DataStore que le point d'entrée rend, dérivé du moteur `Stalwart_Common` provisions. Ne le remplacez pas. |

Le point d'entrée lit également `STALWART_DB_USE_TLS` et `STALWART_DB_ALLOW_INVALID_CERTS` (tous deux par défaut `false`) pour la connexion DataStore ; les valeurs par défaut sont correctes pour Cloud SQL via l'IP privée.

**Administrateur de démarrage — définissez-le :**

L'administrateur de Stalwart est fourni comme `STALWART_RECOVERY_ADMIN`, avec la valeur `username:password`. Stockez-le dans Secret Manager et mappez-le dans `secret_environment_variables` :

```bash
printf 'admin:%s' "$(openssl rand -base64 24)" | \
  gcloud secrets create stalwart-recovery-admin --data-file=- --project "$PROJECT"
```

```hcl
secret_environment_variables = {
  STALWART_RECOVERY_ADMIN = "stalwart-recovery-admin"
}
```

Sans cela, Stalwart génère un mot de passe administrateur aléatoire et l'imprime dans le journal du conteneur **une seule fois** ; le point d'entrée enregistre `recovery_admin=<unset - a random password will be printed below>` juste avant.

Les variables de secrets restantes (`secret_rotation_period`, `secret_propagation_delay`, `protect_sensitive_environment_variables`) se comportent comme décrit dans [App_GKE](./App_GKE.md#group-5--environment-variables--secrets).

---

## Groupe 6 : Service Kubernetes, charge de travail et ports {#group-6-kubernetes-service-workload--ports}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `service_type` | `"LoadBalancer"` | Un équilibreur de charge réseau externe passthrough (`networking.gke.io/load-balancer-type: External`). Les protocoles de messagerie en ont besoin — une Gateway/Ingress ne transporte que du HTTP. |
| `service_port` | `443` | Port de service principal (nommé `http`), ciblant le port de conteneur 443. |
| `session_affinity` | `"ClientIP"` | Les requêtes provenant d'une même adresse IP client vont au même pod. |
| `workload_type` | `"StatefulSet"` | Identité stable plus le PVC par pod du Groupe 7. |
| `namespace_name` | `""` | Dérivé du nom du service lorsqu'il est vide. |
| `enable_network_segmentation` | `false` | Kubernetes NetworkPolicies. |
| `termination_grace_period_seconds` | `30` | Secondes entre SIGTERM et SIGKILL. |

**Carte des ports.** `extra_service_ports` (une entrée du Groupe 0, gérée par la plateforme) ajoute les ports de messagerie au même Service. Chacun cible le même port sur le conteneur et utilise TCP :

| Port | Nom | Protocole |
|---|---|---|
| `443` | `http` | HTTPS — interface d'administration, JMAP, `/healthz/live`. Le TLS est terminé par Stalwart, pas par Google. |
| `25` | `smtp` | SMTP. En pratique, uniquement entrant — Google Cloud bloque le port 25 sortant. |
| `465` | `submissions` | Soumission SMTP, TLS implicite. |
| `587` | `submission` | Soumission SMTP (STARTTLS) ; également le port pour relayer le courrier sortant via un hôte intelligent. |
| `993` | `imaps` | IMAP, TLS implicite. |
| `995` | `pop3s` | POP3, TLS implicite. |
| `4190` | `managesieve` | ManageSieve (vérifié pour renvoyer la propre bannière de Stalwart). |

IMAP en texte clair (143) et POP3 (110) sont omis volontairement — les ports TLS implicites font le même travail sans chemin d'accès aux identifiants en texte clair. Le port 8080 n'est pas publié. GKE crée automatiquement les règles de pare-feu pour un service `LoadBalancer`. La description de la variable indique toujours qu'elle est "déclarée mais NON transférée" ; ce texte est obsolète — `main.tf` la transfère à `App_GKE`.

---

## Groupe 7 : Charges de travail avec état {#group-7-stateful-workloads}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `stateful_pvc_enabled` | `true` | Un PVC par pod. |
| `stateful_pvc_mount_path` | `"/var/lib/stalwart"` | Répertoire de travail et état local de Stalwart. Le courrier lui-même est stocké dans le DataStore Cloud SQL. |
| `stateful_pvc_size` | `"10Gi"` | Taille de chaque PVC. |
| `stateful_pvc_storage_class` | `"standard-rwo"` | PD équilibré. Les modèles de PVC StatefulSet sont immuables — choisissez la classe avant le premier déploiement. |
| `stateful_fs_group` | `0` | `fsGroup` du pod. |
| `stateful_headless_service`, `stateful_pod_management_policy`, `stateful_update_strategy` | `null` | Valeurs par défaut `App_GKE` (`OrderedReady`, `RollingUpdate`). |

`/etc/stalwart` n'est délibérément **pas** persisté — `config.json` est régénéré à partir des variables de la plateforme à chaque démarrage.

---

## Groupe 9 : Politiques de fiabilité {#group-9-reliability-policies}

`enable_pod_disruption_budget` (`true`) et `pdb_min_available` (`"1"`). `App_GKE` crée le PDB uniquement lorsque `max_instance_count > 1` ; avec le `max_instance_count = 1` recommandé, aucun PDB n'existe. Voir [App_GKE](./App_GKE.md).

---

## Groupe 10 : Observabilité et santé {#group-10-observability--health}

Contrairement aux enveloppes dont les sondes proviennent des propres variables de leur module `_Common`, `Stalwart GKE` transmet `startup_probe_config` et `health_check_config` à `Stalwart_Common`, de sorte que **ces deux entrées sont les sondes sur le conteneur Stalwart**.

**Sonde de démarrage (`startup_probe_config`) :**

| Champ | Valeur par défaut | Notes |
|---|---|---|
| `type` | `"TCP"` | Connexion TCP à `container_port` (443). Ne pas passer à HTTP — la sonde ne peut pas parler HTTPS. |
| `initial_delay_seconds` | `60` | |
| `timeout_seconds` | `5` | |
| `period_seconds` | `10` | |
| `failure_threshold` | `3` | |

**Sonde de vivacité (`health_check_config`) :** `TCP`, `initial_delay_seconds = 60`, `timeout_seconds = 5`, `period_seconds = 30`, `failure_threshold = 3`.

**Ce que la sonde détecte.** Elle fait échouer un serveur qui n'a pas démarré (seul le port 8080 est alors lié). Elle ne fait **pas** échouer un serveur qui a démarré avec son DataStore connecté mais sans configuration de serveur — le port 443 est également lié dans cet état, et sur le déploiement vérifié, les ports 443 et 8080 ont répondu `/healthz/live` avec 200. Vérifier que le port 8080 est fermé est une tâche d'opérateur :

```bash
kubectl exec -n "$NS" <pod> -- curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:8080/healthz/live
```

Un serveur entièrement configuré refuse cette connexion. **Ne redirigez pas une sonde défaillante vers le port 8080.**

`uptime_check_config` est par défaut `{ enabled = false, path = "/" }`. Sans Gateway, la vérification de disponibilité de `App_GKE` est une vérification HTTP simple (pas de SSL) contre `service_port` sur l'adresse externe — mais Stalwart sert le port 443 uniquement via HTTPS, donc laissez-le désactivé.

---

## Groupe 11 : Jobs et services additionnels {#group-11-jobs--additional-services}

Aucun job d'initialisation n'est défini — laissez `initialization_jobs = []`. `cron_jobs` et `additional_services` se comportent comme dans [App_GKE](./App_GKE.md#group-11--workload-automation).

---

## Groupe 12 : CI/CD et autorisation binaire {#group-12-cicd--binary-authorization}

Identique à `App_GKE`. Voir [App_GKE](./App_GKE.md#group-12--cicd).

---

## Groupes 13 et 14 : Stockage {#groups-13-and-14-storage}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `enable_nfs` | `true` | Monte un partage NFS à `nfs_mount_path` (`"/mnt/nfs"`). Stalwart ne le lit ni ne l'écrit ; son état est sur le PVC et dans Cloud SQL. |
| `create_cloud_storage` | `true` | Crée le bucket générique `data` à partir de `storage_buckets`. `Stalwart_Common` ne déclare aucun de ses propres buckets. |
| `gcs_volumes` | `[]` | Pas de montages GCS FUSE par défaut. |

Les autres entrées de stockage et de rétention d'images se comportent comme dans [App_GKE](./App_GKE.md#group-13--nfs-storage).

---

## Groupe 15 : Redis {#group-15-redis}

`enable_redis` est par défaut `false` ; laissez-le désactivé. Redis ne serait nécessaire que pour plusieurs réplicas, et la connexion Redis de Stalwart est une URL (`redis://user:pass@host:port`), dans laquelle une chaîne AUTH Memorystore devrait être encodée en pourcentage — le module ne le fait pas.

---

## Groupe 16 : Base de données {#group-16-database}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `database_type` | `"MYSQL_8_0"` | Utilisé uniquement par la validation au moment de la planification. Le moteur provisionné et rendu dans `config.json` est défini par `Stalwart_Common` (MySQL 8.0) ; l'enveloppe ne lui transmet pas cette valeur. |
| `application_database_name` / `application_database_user` | `"stalwart"` | **Inerte** — la fondation nomme la base de données et l'utilisateur d'après le service. |
| `database_password_length` | `32` | Ne pas modifier sur un déploiement en cours d'exécution — cela écrit un nouveau mot de passe dans Secret Manager sans mettre à jour l'utilisateur de la base de données. |
| `enable_postgres_extensions` | `false` | Non applicable à MySQL ; laissez `false`. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Stalwart lit le mot de passe de la variable d'environnement `DB_PASSWORD`, de sorte qu'un mot de passe modifié prend effet lorsque le pod est redémarré après la modification. |

---

## Groupe 17 : Sauvegarde {#group-17-backup}

Identique à `App_GKE` : `backup_schedule` (`"0 2 * * *"`, un CronJob Kubernetes), `backup_retention_days` (`7`, une règle de cycle de vie sur le bucket de sauvegardes), et les entrées de restauration `enable_backup_import` / `backup_source` / `backup_file` / `backup_format`.

---

## Groupe 18 : Scripts SQL personnalisés {#group-18-custom-sql-scripts}

Identique à `App_GKE`. Les scripts s'exécutent sur la base de données Stalwart via l'IP privée. Ne modifiez pas les tables appartenant à Stalwart.

---

## Groupe 19 : Domaine personnalisé, IP statique et balises réseau {#group-19-custom-domain-static-ip--network-tags}

| Variable | Valeur par défaut | Notes |
|---|---|---|
| `reserve_static_ip` | `true` | Réserve une IP externe statique **régionale** et l'attribue au service LoadBalancer, afin que les enregistrements MX et DNS aient une cible stable. (Elle n'est pas appliquée lorsque Cloud Deploy est activé.) |
| `static_ip_name` | `""` | Auto-généré comme `<service-name>-lb-ip` lorsqu'il est vide. |
| `enable_custom_domain` | `false` | Laissez `false`. `true` crée une Gateway, qui est uniquement HTTP et duplique le port 443 déjà sur le LoadBalancer — et utilise une autre IP externe. |
| `application_domains` | `[]` | Utilisé uniquement avec une Gateway. |
| `network_tags` | `["nfsserver"]` | Balises réseau de nœud/pod. |

---

## Groupes 20-22 : IAP, Cloud Armor et CDN, Contrôles de service VPC {#groups-2022-iap-cloud-armor--cdn-vpc-service-controls}

`enable_iap`, `enable_cloud_armor` et `enable_cdn` agissent tous sur une Gateway (HTTP) ; l'activation de Cloud Armor ou CDN en crée une. Aucun d'entre eux ne protège les ports de messagerie sur le LoadBalancer. Les contrôles de service VPC et la journalisation d'audit (Groupe 22) sont identiques à [App_GKE](./App_GKE.md).

---

## Gardes de validation {#validation-guards}

`validation.tf` échoue le plan lorsque `min_instance_count > max_instance_count` ; lorsque `enable_redis = true` sans `redis_host` ni `enable_nfs` ; lorsque `enable_iap = true` sans les deux champs client OAuth ; ou lorsque `enable_cloudsql_volume = true` avec `database_type = "NONE"`.

---

## Exploration du déploiement {#exploring-the-deployment}

### Console Google Cloud {#google-cloud-console}

- **Kubernetes Engine → Charges de travail** — le StatefulSet Stalwart et son pod.
- **Kubernetes Engine → Gateways, Services et Ingress** — le service LoadBalancer avec ses sept ports et son IP externe.
- **Réseau VPC → Adresses IP** — l'adresse `…-lb-ip` réservée.
- **SQL** — l'instance Cloud SQL contenant la base de données Stalwart.
- **Secret Manager** — le mot de passe de la base de données et votre secret `STALWART_RECOVERY_ADMIN`.

### gcloud CLI et kubectl {#gcloud-cli-and-kubectl}

```bash
# Cluster credentials
gcloud container clusters get-credentials <cluster-name> --region "$REGION" --project "$PROJECT"

# Namespace, pod, Service and PVC
NS=$(kubectl get ns -o name | grep stalwart | head -1 | cut -d/ -f2)
kubectl get statefulset,pods,svc,pvc -n "$NS"

# The ports published on the LoadBalancer
kubectl get svc -n "$NS" -o jsonpath='{range .items[*].spec.ports[*]}{.name}{"\t"}{.port}{"\n"}{end}'

# Startup lines written by the entrypoint (DataStore target, admin state)
kubectl logs -n "$NS" statefulset/"$(kubectl get statefulset -n "$NS" -o jsonpath='{.items[0].metadata.name}')" | grep '\[startup\]'

# Health from inside the pod (443 must answer; 8080 should refuse once configured)
POD=$(kubectl get pods -n "$NS" -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n "$NS" "$POD" -- curl -sk -o /dev/null -w '%{http_code}\n' https://127.0.0.1:443/healthz/live
kubectl exec -n "$NS" "$POD" -- curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8080/healthz/live

# Database password secret
gcloud secrets list --project "$PROJECT" --filter="name~stalwart"
```

---

## Sorties du module {#module-outputs}

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Kubernetes |
| `namespace` | Espace de noms Kubernetes |
| `service_cluster_ip` | ClusterIP du service |
| `service_external_ip` | IP externe du LoadBalancer — l'adresse vers laquelle les clients de messagerie et les enregistrements MX pointent |
| `service_url` | Rendu comme `http://` plus l'IP externe. Stalwart répond **HTTPS sur 443**, utilisez donc `https://` + `service_external_ip`. |
| `database_instance_name` / `database_name` / `database_user` | Instance Cloud SQL, base de données et utilisateur |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données |
| `database_host` | Rapporte toujours `127.0.0.1` (la valeur par défaut du proxy de la fondation) ; Stalwart se connecte en fait à l'IP privée de Cloud SQL |
| `database_port` | Port de la base de données |
| `storage_buckets` | Buckets GCS créés |
| `container_image` | Image de conteneur utilisée pour le déploiement |
| `initialization_jobs` / `db_import_job` | Noms des jobs |
| `cicd_enabled` / `github_repository_url` | Statut CI/CD |
| `kubernetes_ready` | `true` lorsque le point de terminaison du cluster était accessible et que les ressources Kubernetes ont été déployées |

---

## Pièges de configuration et valeurs par défaut judicieuses {#configuration-pitfalls--sensible-defaults}

> Niveaux de risque : **Critique** (perte de données, panne complète, faille de sécurité) — **Élevé** (service indisponible ou dégradation significative) — **Moyen** (fonction dégradée ou coût accru) — **Faible** (impact mineur).

| Variable | Valeur par défaut judicieuse | Risque | Conséquence d'une valeur incorrecte |
|---|---|---|---|
| `startup_probe_config` / `health_check_config` | `type = "TCP"` | **Critique** | Une sonde `HTTP` ne peut pas vérifier le port 443 de Stalwart, qui est uniquement HTTPS, et fera échouer un pod sain. Le port de la sonde est fixé à 443 par `Stalwart_Common` ; ne contournez jamais une sonde défaillante en ciblant le port 8080, qui répond précisément lorsque Stalwart n'est pas configuré ou n'a pas réussi à démarrer. |
| `container_image_source` | `"custom"` | **Critique** | Sans l'enveloppe, il n'y a pas de `config.json` ; Stalwart ouvre le port 8080 en mode démarrage et ne sert aucun courrier. |
| `STALWART_RECOVERY_ADMIN` | Défini via `secret_environment_variables` | **Élevé** | Non défini, le seul mot de passe administrateur est imprimé une fois dans le journal du conteneur. |
| `max_instance_count` | `1` | **Élevé** | La valeur par défaut `3` permet au HPA d'ajouter des réplicas, qui nécessitent un coordinateur basé sur Redis que le module ne configure pas, et crée un PDB. |
| Configuration du serveur (domaines, écouteurs, TLS) | Appliquer avec `stalwart-cli` après le déploiement | **Élevé** | Non effectué par le module. Tant que ce n'est pas fait, le port 8080 reste ouvert dans le pod et des connexions TLS externes ont été observées comme étant fermées sans certificat. |
| Courrier sortant | Hôte intelligent sur 587 | **Élevé** | Google Cloud bloque le port 25 sortant ; la livraison MX directe vers d'autres domaines ne peut pas fonctionner. |
| `database_password_length` | Laisser inchangé | **Élevé** | Le modifier sur un déploiement en cours d'exécution interrompt l'authentification de la base de données. |
| `application_version` | Un tag de version exact | **Moyen** | Une reconstruction sous un tag inchangé ne crée pas de nouveau modèle de pod ; `kubectl rollout restart` tire l'image reconstruite (politique de tirage `Always`). |
| `enable_custom_domain` / `enable_cloud_armor` / `enable_cdn` | `false` | **Moyen** | Chacun crée une Gateway qui ne transporte que du HTTP et consomme une autre IP externe ; les ports de messagerie ne sont pas affectés. |
| `reserve_static_ip` | `true` | **Moyen** | Avec `false`, le LoadBalancer obtient une IP éphémère qui change chaque fois que le service est recréé — les enregistrements MX deviendraient obsolètes. |
| `stateful_pvc_storage_class` / `stateful_pvc_size` | Décider avant le premier déploiement | **Moyen** | Les modèles de PVC StatefulSet sont immuables ; les modifications ultérieures ne s'appliquent pas au PVC existant. |
| `application_display_name` | `"Stalwart Mail Server"` | **Faible** | La valeur par défaut fournie affiche `Wiki.js` dans la console et les tableaux de bord. |
| `enable_nfs` | `false` si rien d'autre n'en a besoin | **Faible** | Par défaut `true` et monte un partage NFS que Stalwart n'utilise jamais. |

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Stalwart sur GKE Autopilot](../labs/Stalwart_GKE.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Module de configuration partagée Stalwart Common](Stalwart_Common.md) — la couche d'application sur laquelle ce module est construit.
