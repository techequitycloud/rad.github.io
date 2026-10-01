---
title: "Stirling-PDF sur Google Cloud Run"
description: "Référence de configuration pour déployer Stirling-PDF sur Google Cloud Run avec le module RAD — variables, architecture, réseau et exploitation."
---

<!-- translated-from: docs/modules/StirlingPDF_CloudRun.md @ 3055034 sha256:d27da4c67dd3 -->

# Stirling-PDF sur Google Cloud Run {#stirling-pdf-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/StirlingPDF_CloudRun.png" alt="Stirling-PDF sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Stirling-PDF est une boîte à outils PDF web open source (cœur sous licence MIT) et
auto-hébergée — fusion, découpage, conversion, OCR, compression, filigrane,
signature, caviardage et plus de 50 autres opérations PDF, toutes traitées sur votre
propre infrastructure, de sorte que les documents ne transitent jamais par un service
tiers. Ce module déploie Stirling-PDF sur **Cloud Run v2** au-dessus du socle
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google
Cloud partagée.

Ce guide se concentre sur les services cloud qu'utilise Stirling-PDF et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et en
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run —
identité du service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls et
cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## 1. Vue d'ensemble {#1-overview}

Stirling-PDF s'exécute dans un conteneur Java / Spring Boot (avec un LibreOffice
intégré pour les conversions de documents) sur Cloud Run v2. Le déploiement assemble
un ensemble volontairement restreint de services Google Cloud — Stirling-PDF est sans
état ; il n'y a donc ni base de données, ni stockage persistant, ni secrets à gérer :

| Capacité | Service Google Cloud | Remarques |
|---|---|---|
| Calcul | Cloud Run v2 | Service Java, 1 vCPU / 2 GiB par défaut, autoscaling serverless ; mise à l'échelle jusqu'à zéro activée |
| Image de conteneur | Artifact Registry | Image officielle `stirlingtools/stirling-pdf`, dupliquée par défaut |
| Entrée | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe et domaine personnalisé facultatifs |
| Redis (inerte) | Redis | Désactivé par défaut. `enable_redis` amène seulement le socle à injecter les variables d'environnement `REDIS_*` — Stirling-PDF ne les lit jamais, cela n'apporte donc ni limitation de débit ni détection de bots |
| Observabilité | Cloud Logging / Cloud Monitoring | Journaux des conteneurs, métriques, test de disponibilité et alertes facultatifs |

**Valeurs par défaut pertinentes à connaître d'emblée :**

- **Sans état — ni base de données, ni stockage, ni secrets.** `database_type = "NONE"`,
  aucun bucket GCS, pas de NFS et une map de secrets vide. Chaque opération PDF
  s'exécute dans un répertoire de travail éphémère propre à la requête, supprimé à la
  fin du traitement.
- **Image préconstruite.** `container_image_source = "prebuilt"` déploie directement
  l'image officielle `stirlingtools/stirling-pdf` ; `enable_image_mirroring = true`
  la duplique dans Artifact Registry pour éviter les limites de débit de Docker Hub.
- **La connexion est désactivée par défaut.** `enable_login = false`
  (`SECURITY_ENABLELOGIN=false`) livre une instance ouverte. Activez-la et placez le
  service derrière IAP ou Cloud Armor pour un déploiement privé.
- **Facturation à la requête et mise à l'échelle jusqu'à zéro.**
  `cpu_always_allocated = false` et `min_instance_count = 0` — le CPU n'est facturé
  que pendant le traitement d'une requête, et le service descend à zéro instance
  lorsqu'il est inactif. Un démarrage à froid ajoute quelques secondes de préchauffage
  de la JVM.
- **Plancher mémoire de 2 GiB.** La JVM et LibreOffice ont besoin d'au moins `2Gi` ;
  augmentez `memory_limit` pour les charges de travail lourdes d'OCR / de conversion.
- **Entrée publique par défaut.** `ingress_settings = "all"`, de sorte que la boîte à
  outils est accessible à son URL `run.app`. Combinez avec IAP pour un accès contrôlé
  par identité.
- **Les sondes de santé interrogent `/api/v1/info/status`** — un point de terminaison
  public et non authentifié qui renvoie 200 une fois la JVM et LibreOffice
  initialisés (fenêtre d'environ 70s au premier démarrage).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définies. Les noms des
services et des ressources figurent dans les [Outputs](#5-outputs) du déploiement.

### A. Cloud Run — le service Stirling-PDF {#a-cloud-run--the-stirling-pdf-service}

Stirling-PDF s'exécute sous la forme d'un service Cloud Run v2 qui s'adapte
automatiquement à la charge des requêtes entre le nombre minimal (0) et le nombre
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements progressifs sûrs.

- **Console :** Cloud Run → sélectionnez le service pour consulter les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Artifact Registry — l'image de conteneur {#b-artifact-registry--the-container-image}

L'image officielle `stirlingtools/stirling-pdf` est dupliquée dans Artifact Registry
(`enable_image_mirroring = true`) et Cloud Run la récupère depuis cet emplacement.
Aucune étape Cloud Build n'est exécutée — l'image est préconstruite en amont.

- **Console :** Artifact Registry → Repositories.
- **CLI :**
  ```bash
  gcloud artifacts repositories list --project "$PROJECT" --location "$REGION"
  gcloud artifacts docker images list <repo-path> --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le mécanisme de duplication et la
conservation des images.

### C. Réseau et entrée {#c-networking--ingress}

Le service est accessible par défaut à son URL `run.app` (`ingress_settings = "all"`).
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peuvent être ajoutés par-dessus ; les paramètres d'entrée et la sortie
VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Network services → Load balancing.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md).

### D. Redis (inerte — enable_redis n'a aucun effet sur l'application) {#d-redis-inert--enable_redis-has-no-application-effect}

Redis est **désactivé par défaut** (`enable_redis = false`). Définir
`enable_redis = true` amène seulement le socle `App_CloudRun` à injecter les variables
d'environnement `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH` dans le conteneur —
Stirling-PDF **ne les lit jamais**. Le commentaire de `stirlingpdf.tf` lui-même
confirme « no DB or Redis », et ni `StirlingPDF_Common` ni ce module ne font
correspondre ces variables d'environnement à un paramètre reconnu par Stirling-PDF.
Activer Redis n'implémente **pas** de limitation de débit ni de détection de bots
pour cette application ; il n'existe aucun moyen pris en charge d'ajouter ce
comportement à Stirling-PDF via ce module. Utilisez `enable_cloud_armor` pour une
véritable protection contre les abus sur une instance publique.

- **CLI (pour confirmer que les variables d'environnement sont présentes mais inutilisées) :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Identity-Aware Proxy (facultatif) {#e-identity-aware-proxy-optional}

Comme Stirling-PDF traite des documents potentiellement sensibles, un déploiement
privé doit contrôler l'accès avec IAP. Activer `enable_iap` exige une identité Google
authentifiée et autorisée avant qu'une requête n'atteigne le service — sans VPN ni
configuration de connexion Stirling-PDF.

- **Console :** Security → Identity-Aware Proxy.
- **CLI :**
  ```bash
  gcloud iap web get-iam-policy --resource-type=backend-services --project "$PROJECT"
  ```

Consultez [App_CloudRun](App_CloudRun.md) pour le câblage d'IAP.

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés vers Cloud Logging ; les métriques de Cloud
Run sont envoyées vers Cloud Monitoring, avec des tests de disponibilité et des
règles d'alerte facultatifs.

- **Console :** Logging → Logs Explorer ; Monitoring → Dashboards / Alerting.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Stirling-PDF {#3-stirling-pdf-application-behaviour}

- **Rien n'est persisté.** Les fichiers envoyés sont écrits dans un répertoire de
  travail éphémère propre à la requête et supprimés au retour de la réponse. Il n'y a
  ni base de données ni bucket — un redéploiement ou un événement de mise à l'échelle
  ne fait rien perdre, puisqu'il n'y a rien à perdre.
- **Premier démarrage lent.** L'initialisation de Spring Boot et de LibreOffice prend
  plusieurs dizaines de secondes. La sonde de démarrage cible `/api/v1/info/status`
  et accorde jusqu'à environ 70 secondes (délai initial de 10s + 6 × 10s) avant que
  la révision ne soit marquée comme non saine.
- **La connexion est facultative et désactivée par défaut.** `enable_login = false`
  livre une instance ouverte. Définissez `enable_login = true` pour exiger
  l'authentification intégrée de Stirling-PDF ; combinez avec IAP pour une défense en
  profondeur.
- **Les mises à niveau de version se font par changement d'étiquette d'image.** Comme
  l'image est celle d'origine, non modifiée, et qu'il n'y a pas de schéma, modifier
  `application_version` déploie une nouvelle révision sans étape de migration.
- **Fichiers volumineux et conversions longues.** Augmentez `memory_limit` et
  `timeout_seconds` pour les documents volumineux ou l'OCR intensif ; définissez
  `SYSTEM_MAXFILESIZE` via `environment_variables` pour plafonner la taille des envois.
- **Confirmer la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme
de déploiement. Seuls les paramètres propres à Stirling-PDF ou notables pour lui sont
listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md)
avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région du service et des ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques pour chaque environnement. |
| `support_users` | `[]` | Adresses e-mail auxquelles sont accordés l'accès au projet et les alertes de supervision. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `stirlingpdf` | Nom de base des ressources. Ne le modifiez pas après le premier déploiement. |
| `display_name` | `Stirling-PDF` | Nom lisible affiché dans la console. |
| `application_version` | `latest` | Étiquette de l'image Stirling-PDF ; épinglez une version précise en production. |
| `enable_login` | `false` | Active l'authentification intégrée de Stirling-PDF (`SECURITY_ENABLELOGIN`). |
| `default_locale` | `en-US` | Langue par défaut de l'interface (`SYSTEM_DEFAULTLOCALE`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour ne provisionner que l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie l'image officielle (`prebuilt`) ou construit une image personnalisée. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; **plancher de 2Gi** pour la JVM et LibreOffice. |
| `cpu_always_allocated` | `false` | Facturation à la requête — Stirling-PDF n'effectue aucun travail en arrière-plan. |
| `min_instance_count` | `0` | Fixé à 0 (mise à l'échelle jusqu'à zéro) — le module code cette valeur en dur ; la variable n'est pas transmise au socle et ne peut pas être modifiée. |
| `max_instance_count` | `3` | Limite supérieure de l'autoscaling (peut être augmentée sans risque — aucun état partagé). |
| `container_port` | `8080` | Stirling-PDF écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 recommandé. |
| `timeout_seconds` | `60` | Durée maximale d'une requête ; augmentez-la pour les conversions volumineuses. |
| `enable_cloudsql_volume` | `false` | Non utilisé — Stirling-PDF n'a pas de base de données. |
| `enable_image_mirroring` | `true` | Duplique l'image dans Artifact Registry. |
| `traffic_split` | `[]` | Répartit le trafic entre les révisions pour des déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` pour un accès public ; `internal-and-cloud-load-balancing` derrière un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | N'achemine que le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exige une connexion Google. Recommandé pour les instances privées ou traitant des documents sensibles. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres Stirling-PDF supplémentaires (par exemple `SYSTEM_MAXFILESIZE`). La connexion et la langue sont définies via `enable_login` / `default_locale`. |
| `secret_environment_variables` | `{}` | Références Secret Manager. Stirling-PDF n'en a besoin d'aucune par défaut. |
| `secret_propagation_delay` | `30` | Nombre de secondes d'attente après la création d'un secret avant de poursuivre. |
| `secret_rotation_period` | `2592000s` | Fréquence des notifications de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Stirling-PDF est sans état ; les entrées de sauvegarde (`backup_schedule`,
`backup_retention_days`, `enable_backup_import`, `backup_source`, `backup_uri`,
`backup_format`) n'ont donc aucune donnée applicative à protéger. Elles sont laissées
à leurs valeurs par défaut.

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration Cloud Build / Cloud Deploy standard d'App_CloudRun — consultez
[App_CloudRun](App_CloudRun.md). Entrées principales : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et conservation des images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionne un équilibreur de charge HTTPS global et le WAF Cloud Armor. Recommandé pour les instances publiques. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles du WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Active Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(définies)_ | Règle de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `false` | Stirling-PDF est sans état — aucun bucket par défaut. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires facultatifs. |
| `enable_nfs` | `false` | NFS désactivé par défaut ; activez-le uniquement si vous hébergez Redis sur le serveur NFS. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixe — Stirling-PDF n'utilise aucune base de données. |
| `database_password_length` | `32` | Non utilisé. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Sans objet. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/v1/info/status`, délai de 10s, 6 tentatives | Sonde de démarrage. Fenêtre d'environ 70s au premier démarrage pour la JVM et LibreOffice. |
| `liveness_probe` | HTTP `/api/v1/info/status`, délai de 15s | Sonde de vivacité. |
| `uptime_check_config` | `{ enabled=false, path="/api/v1/info/status" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Règles d'alerte sur les métriques. |

### Groupe 21 — Redis (transmission inerte au socle) {#group-21--redis-inert-foundation-passthrough}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Inerte pour Stirling-PDF : amène seulement `App_CloudRun` à injecter les variables d'environnement `REDIS_HOST`/`REDIS_PORT`/`REDIS_AUTH`, que l'application ne lit jamais. L'activer n'apporte ni limitation de débit ni détection de bots. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'adresse IP du serveur NFS. Inutilisé par Stirling-PDF, quelle que soit la valeur. |
| `redis_port` | `6379` | Port Redis. Inutilisé par Stirling-PDF, quelle que soit la valeur. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). Inutilisé par Stirling-PDF, quelle que soit la valeur. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Applique un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(définies)_ | CIDR du niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Cloud Audit Logs détaillés. |

---

## 5. Outputs {#5-outputs}

Renvoyés lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Output | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle s'exécute le service. |
| `stage_services` | URL des services propres à chaque étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | Adresse IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (vide — Stirling-PDF est sans état). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de la supervision, canaux, tests de disponibilité. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | Statut et détails du CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Statut de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut pertinentes {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critical** (perte de données / panne / sécurité) — **High** (service dégradé) —
> **Medium** (coût ou dégradation partielle) — **Low** (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration au moteur du socle [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et leurs combinaisons* au moment du plan — IAP sans identité autorisée, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`timeout_seconds` hors limites, une mémoire inférieure au plancher de gen2. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource ; la plupart des erreurs ci-dessous sont donc détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur recommandée | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_login` + entrée | `enable_login = true` **ou** IAP pour un usage privé | High | La valeur par défaut `enable_login = false` associée à une entrée publique laisse une boîte à outils PDF ouverte, utilisable par quiconque possède l'URL. |
| `enable_iap` | À activer pour les instances traitant des documents sensibles | High | Sans IAP (et avec la connexion désactivée), le service n'est pas authentifié ; les utilisateurs peuvent envoyer des documents confidentiels vers un point de terminaison ouvert. |
| `memory_limit` | `2Gi` | High | En dessous d'environ 2Gi, la JVM et LibreOffice sont arrêtés pour manque de mémoire (OOM) pendant les conversions ; gen2 rejette également `< 512Mi` au moment du plan. |
| `timeout_seconds` | `60`, à augmenter pour les gros fichiers | High | Les traitements volumineux d'OCR/de conversion qui dépassent le délai renvoient une erreur 504 en cours d'opération. |
| Fenêtre de `startup_probe` | Conserver la valeur par défaut d'environ 70s | Medium | Raccourcir le délai initial / le seuil d'échec marque la révision comme non saine avant que LibreOffice n'ait terminé son préchauffage. |
| `enable_cloud_armor` | À activer pour les instances publiques | Medium | Une boîte à outils publique sans WAF est exposée aux abus et aux analyses automatisées. |
| `enable_redis` | Laisser à `false` — il est inerte pour cette application | Low | L'activer ne fait qu'ajouter des variables d'environnement `REDIS_*` inutilisées à la révision ; Stirling-PDF ne les lit jamais, cela n'apporte donc **aucune** limitation de débit ni détection de bots. Utilisez plutôt `enable_cloud_armor` pour une véritable protection contre les abus. |
| `min_instance_count` | `0` (fixe) | Low | La mise à l'échelle jusqu'à zéro ajoute quelques secondes de préchauffage de la JVM à la première requête après une période d'inactivité. Le module code `min_instance_count = 0` en dur — la variable n'est pas transmise et ne peut donc pas être portée à `1` pour éliminer les démarrages à froid. |
| `SYSTEM_MAXFILESIZE` (via `environment_variables`) | Définir un plafond raisonnable | Low | Des envois non plafonnés permettent à un seul gros fichier de consommer la mémoire de l'instance. |

---

Pour le comportement du socle évoqué tout au long de ce guide — identité du service,
mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC et duplication d'images — consultez
**[App_CloudRun](App_CloudRun.md)**. La configuration applicative propre à
Stirling-PDF, partagée avec la variante GKE, est décrite dans
**[StirlingPDF_Common](StirlingPDF_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Stirling-PDF sur Cloud Run](../labs/StirlingPDF_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Stirling-PDF sur GKE Autopilot](StirlingPDF_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Stirling-PDF Common — Configuration applicative partagée](StirlingPDF_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Outline sur Google Cloud Run](Outline_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md) dans la solution **Knowledge Base & Documentation**.
