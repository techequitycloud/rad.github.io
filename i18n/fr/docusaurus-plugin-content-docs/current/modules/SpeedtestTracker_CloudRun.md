---
title: "Speedtest Tracker sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Speedtest Tracker sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SpeedtestTracker_CloudRun.md @ e69407af sha256:f96fd299be52 -->

# Speedtest Tracker sur Google Cloud Run {#speedtest-tracker-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SpeedtestTracker_CloudRun.png" alt="Speedtest Tracker sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Speedtest Tracker est un outil de surveillance de test de vitesse Internet gratuit,
open-source et auto-hébergé, basé sur Laravel (PHP). Il exécute des tests de
vitesse Ookla selon un calendrier récurrent, stocke les résultats dans une base
de données et les présente sous forme de graphiques historiques via un tableau
de bord web et une API REST. Ce module déploie Speedtest Tracker sur **Cloud Run
v2** en s'appuyant sur la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Speedtest Tracker et
sur la manière de les explorer et de les opérer depuis la console Google Cloud
et la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte Speedtest Tracker sur RAD, et comment cela se compare {#what-speedtest-tracker-costs-on-rad-and-how-that-compares}

**L'exécution de Speedtest Tracker dans votre propre projet GCP coûte environ 104,37 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Si un coût d'exécution inférieur est plus important que la cible de déploiement,
consultez le guide GKE pour l'option à moindre coût ; sinon, si vous déployez
dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement
lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~104,37 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~49 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|---|
| Cloud Run, 1x vCPU / 1 GiB (alwaysOn) | 47,34 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **104,37 $** |

### Comment cela se compare {#how-it-compares}

- L'empreinte propre de Speedtest Tracker ici (1x vCPU / 1 GiB) est plus petite
  que cette classe de référence, donc un niveau de VPS encore moins cher ferait
  tout aussi bien, mais dimensionné à la plus petite classe couramment citée
  pour comparaison : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**,
  un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP
  Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus
  le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité
  et les mises à niveau, que le Cloud SQL géré par RAD, Secret Manager et la
  surveillance couvrent pour vous — mais le prix de RAD n'est jamais destiné à
  battre un VPS, seulement à remplacer le temps d'administration qu'un VPS
  nécessite encore.
- Speedtest Tracker exécute des tests planifiés sur une minuterie plutôt que de
  servir un trafic continu, il faut donc noter que ce module nécessite `alwaysOn`
  de calcul pour maintenir le calendrier actif sur Cloud Run, c'est pourquoi
  c'est la cible la plus coûteuse des deux ici malgré la faible charge de
  travail.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré
par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression d'un module, cela ne supprime pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce que cela nécessite : vous devez être propriétaire du projet (pas un projet
dont RAD gère uniquement la facturation), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, donc votre
solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits
pour le niveau sandbox que la plupart des utilisations d'étude/démo
correspondent). Google indique que la plupart des services sont à nouveau
entièrement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en
dehors du projet) avant de la supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Speedtest
Tracker purement et simplement et de le redéployer plus tard. Un redéploiement
coûte à nouveau les frais de module, plus les builds — environ 75 + 3-6 crédits
de temps de build.

La suppression ne permet d'économiser de l'argent que si Speedtest Tracker
devait rester inutilisé suffisamment longtemps pour compenser ce coût de
redéploiement par rapport à son propre coût d'exécution quotidien — par rapport
au total du projet ci-dessus, cela représente environ 2 jours ou plus. La
plupart des coûts d'exécution ici sont généralement liés à la base de données ;
elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la
suppression de cette application alors que quelque chose d'autre partage le
projet n'économise que la partie calcul propre à cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc
copiez la dernière sauvegarde avant de la supprimer si vous voulez la
conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, afin que
  personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les frais propres de RAD et les
estimations de crédits quotidiens ;
https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les
mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Speedtest Tracker s'exécute comme un conteneur PHP sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur PHP (LinuxServer), 1 vCPU / 1 GiB par défaut, **toujours actif** (pas de mise à l'échelle à zéro) |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — ce module fixe MySQL ; le comportement par défaut de SQLite de l'image amont est ignoré |
| Cache et sessions | Redis (facultatif) | Désactivé par défaut ; Speedtest Tracker utilise le pilote de cache local fichier/sync |
| Secrets | Secret Manager | Clé d'application Laravel `APP_KEY` auto-générée ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée (`database_type = "MYSQL_8_0"`) ; PostgreSQL n'est pas
  pris en charge. Le comportement par défaut de SQLite de Speedtest Tracker
  (utilisé lorsque aucune variable d'environnement de base de données n'est
  définie) n'est jamais atteint car ce module connecte toujours MySQL.
- **L'image pré-construite `linuxserver/speedtest-tracker` est utilisée directement.** Il n'y a
  pas de Cloud Build personnalisé pour le déploiement par défaut ; l'image
  officielle LinuxServer.io est mise en miroir dans Artifact Registry
  (`enable_image_mirroring = true`) et déployée telle quelle. Repli : `ghcr.io/alexjustesen/speedtest-tracker`
  (basé sur Alpine, sans s6-overlay) si l'image LinuxServer s'avère
  incompatible avec le sandbox gVisor de Cloud Run — une classe de risque
  documentée pour les images s6-overlay dans ce catalogue (confirmé sur
  Prowlarr, bien que non universel ; BookStack, également LinuxServer,
  fonctionne bien sur Cloud Run).
- **Le conteneur écoute sur le port 80** (`container_port = 80`, `container_protocol = "http1"`).
- **Toujours actif par conception, pas par défaut de coût.** `cpu_always_allocated = true` et
  `min_instance_count = 1` / `max_instance_count = 1`. L'expression cron `SPEEDTEST_SCHEDULE`
  déclenche un **planificateur Laravel intégré** qui exécute des tests de
  vitesse indépendamment de toute requête HTTP entrante — sous facturation basée
  sur les requêtes ou mise à l'échelle à zéro, le calendrier ne termine jamais
  silencieusement son travail (la même classe d'échec documentée pour n8n/Kestra
  dans ce catalogue). `max_instance_count` est plafonné à 1 car le
  planificateur n'a pas de verrouillage inter-instance ; plus d'une instance
  chaude risque de déclencher des tests de vitesse en double au même moment.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application
  Laravel est générée une fois et stockée dans Secret Manager ; la faire tourner
  rend toutes les valeurs de base de données chiffrées indéchiffrables.
- **L'image exécute `php artisan migrate --force` automatiquement au démarrage**, de sorte que le
  schéma est créé au premier démarrage après que `db-init` ait
  provisionné la base de données et l'utilisateur — il n'y a pas de tâche de
  migration distincte.
- **Pas de stockage par défaut.** Speedtest Tracker stocke tous les résultats et
  la configuration dans Cloud SQL, sans flux de téléchargement de fichiers
  utilisateur — `create_cloud_storage` et `enable_nfs` sont
  désactivés par défaut.
- **Cloud Run se connecte à Cloud SQL via TCP IP privée.** `enable_cloudsql_volume = false`
  par défaut, donc `DB_HOST` est l'IP privée de l'instance ; MySQL
  sur TCP IP privée n'a pas besoin de SSL.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont
définis. Les noms de services et de ressources sont rapportés dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Speedtest Tracker {#a-cloud-run--the-speedtest-tracker-service}

Speedtest Tracker s'exécute comme un service Cloud Run v2 maintenu toujours
actif (`min_instance_count = 1`) afin que son planificateur cron intégré
continue de se déclencher. Chaque déploiement crée une révision immuable ; le
trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Speedtest Tracker stocke tous les résultats des tests de vitesse et la
configuration de l'application dans une instance gérée de Cloud SQL pour MySQL
8.0. Le service se connecte via l'**IP privée** de Cloud SQL via l'égression VPC
(`enable_cloudsql_volume = false`) ; `DB_HOST` est défini sur l'IP privée de
l'instance et aucune IP publique n'est exposée. Lors du premier déploiement, un
job d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=speedtesttracker --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Redis (cache et sessions facultatifs) {#c-redis-optional-cache--sessions}

Redis est **désactivé par défaut** (`enable_redis = false`) ; Speedtest Tracker
utilise ses pilotes de cache et de session locaux fichier/sync, ce qui convient
pour un déploiement à instance unique. Lorsque `enable_redis = true` est
défini, la couche partagée injecte `REDIS_HOST` et `REDIS_PORT`.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the DB/schedule wiring in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ',' '\n' | grep -E 'DB_|REDIS_|SPEEDTEST_'
  ```

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret
Manager : la **clé d'application Laravel** (`APP_KEY`)
(`base64:<44-char base64>`), utilisée pour chiffrer toutes les données
d'application que Speedtest Tracker stocke chiffrées. Le mot de passe de la base
de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut
(`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine
personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres
d'ingress et l'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Speedtest Tracker {#3-speedtest-tracker-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`.
  Il détecte le socket Cloud SQL ou le point de terminaison TCP, attend que
  MySQL soit accessible, crée la base de données et l'utilisateur de
  l'application, accorde les privilèges, vérifie que l'utilisateur de
  l'application peut se connecter et arrête gracieusement le sidecar Cloud SQL
  Auth Proxy. Le job est idempotent et peut être réexécuté en toute sécurité
  (`max_retries = 3`).
- **Auto-migration du schéma au démarrage.** L'image LinuxServer Speedtest
  Tracker exécute `php artisan migrate --force` automatiquement à chaque démarrage du
  conteneur, de sorte que le schéma est créé au premier démarrage et mis à
  niveau lors des démarrages ultérieurs — il n'y a **pas de job de migration
  distinct**.
- **`APP_KEY` est immuable après le premier démarrage.** La clé d'application
  Laravel est générée une fois et écrite dans Secret Manager. La faire tourner
  rend toutes les valeurs de base de données chiffrées indéchiffrables de
  manière permanente. Ne la faites tourner que pendant une fenêtre de
  maintenance planifiée avec un plan de rechiffrement.
- **Planificateur cron intégré.** `SPEEDTEST_SCHEDULE` (par défaut `"0 * * * *"`,
  toutes les heures) déclenche le propre planificateur Laravel de Speedtest
  Tracker pour exécuter des tests de vitesse automatisés. Cela se déclenche sans
  requête HTTP entrante, de sorte que le déploiement par défaut `cpu_always_allocated = true`
  + `min_instance_count = 1` spécifiquement pour le maintenir fiable — ne les
  modifiez pas à moins que le calendrier ne soit entièrement désactivé.
- **Élagage des résultats.** `PRUNE_RESULTS_OLDER_THAN` (par défaut `"0"`,
  désactivé) supprime automatiquement les résultats des tests de vitesse
  antérieurs au nombre de jours configuré.
- **Chemin de santé.** La sonde de vivacité cible `/api/healthcheck` — le point de
  terminaison de santé JSON non authentifié de Speedtest Tracker. La sonde de
  démarrage est une vérification TCP sur le port 80. Prévoyez une fenêtre de
  premier démarrage généreuse : la sonde de vivacité a un délai initial de 300
  secondes pour s'adapter aux migrations automatiques.
- **Configuration initiale.** L'interface utilisateur web de Speedtest Tracker
  propose la création de compte lors de la première visite — il n'y a pas de
  compte administrateur par défaut pré-rempli à modifier.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Speedtest Tracker sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `speedtesttracker` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Speedtest Tracker` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Speedtest Tracker — automated internet speed test monitoring and history` | Description du service. |
| `application_version` | `latest` | Tag de l'image `linuxserver/speedtest-tracker` ; épingler (par exemple `version-v1.6.3`) en production. |
| `speedtest_schedule` | `0 * * * *` | Expression cron pour le calendrier des tests de vitesse automatisés. |
| `prune_results_older_than` | `0` | Jours après lesquels les anciens résultats sont élagués ; `0` désactive l'élagage. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déployer directement l'image LinuxServer mise en miroir — pas de build personnalisé. |
| `container_image` | `""` | Remplacer la référence de l'image ; laisser vide pour utiliser la valeur par défaut mise en miroir. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU par défaut. |
| `memory_limit` | `1Gi` | Mémoire par instance. |
| `cpu_always_allocated` | `true` | **Doit rester vrai** — le planificateur cron a besoin de CPU sans requête entrante. |
| `min_instance_count` | `1` | **Doit rester ≥ 1** — le planificateur a besoin d'une instance toujours en cours d'exécution. |
| `max_instance_count` | `1` | Garder à 1 — évite les tests de vitesse planifiés en double sur plusieurs instances. |
| `container_port` | `80` | Speedtest Tracker écoute sur le port 80. |
| `container_protocol` | `http1` | HTTP/1.1. |
| `execution_environment` | `gen2` | Environnement d'exécution Gen2. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | Se connecter via TCP IP privée Cloud SQL (correct pour MySQL sur Cloud Run). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image LinuxServer dans Artifact Registry. |
| `max_revisions_to_retain` | `7` | Combien d'anciennes révisions conserver. |

### Groupe 5 — Ingress et VPC {#group-5--ingress--vpc}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` autorise l'accès public au tableau de bord. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple `DISPLAY_TIMEZONE`, `SPEEDTEST_SERVERS`). Ne pas définir `APP_KEY` ou `DB_*` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et maintenance {#group-7--backup--maintenance}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS après le
provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Cloud Armor, CDN et domaine personnalisé {#group-10--cloud-armor-cdn--custom-domain}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Cloud Storage et NFS {#group-11--cloud-storage--nfs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer tous les buckets déclarés dans `storage_buckets` (vide par défaut). |
| `storage_buckets` | `[]` | Buckets GCS à provisionner. Non nécessaire par défaut. |
| `enable_nfs` | `false` | Non requis par défaut — tout l'état réside dans Cloud SQL. |
| `nfs_mount_path` | `/config` | Chemin de montage si NFS est activé (par exemple pour les certificats personnalisés). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Base de données {#group-12--database}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — Speedtest Tracker nécessite MySQL 8.0 dans ce module. |
| `db_name` | `speedtesttracker` | Nom de la base de données MySQL (préfixé par le locataire). Immuable après le premier déploiement. |
| `db_user` | `speedtesttracker` | Utilisateur de la base de données de l'application (préfixé par le locataire). Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | `false` / `90` | Rotation du mot de passe de la base de données. |

### Groupe 13 — Automatisation des charges de travail {#group-13--workload-automation}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Pour les tâches de maintenance non liées — le propre calendrier de tests de vitesse de Speedtest Tracker s'exécute en interne via `SPEEDTEST_SCHEDULE`. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 80, délai 30s | Sonde de démarrage (vérification d'écoute de port). |
| `liveness_probe` | HTTP `/api/healthcheck`, délai 300s | Sonde de vivacité contre le point de terminaison de santé non authentifié. |
| `uptime_check_config` | `{ enabled=false, path="/api/healthcheck" }` | Test de disponibilité Cloud Monitoring facultatif. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et sessions Redis {#group-21--redis-cache--sessions}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Injecter `REDIS_HOST`/`REDIS_PORT` afin que Speedtest Tracker puisse utiliser Redis pour le cache/les sessions. Non requis par défaut. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée, sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (vides par défaut). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa
> configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui
> valide les valeurs *et les combinaisons* au moment de la planification — un
> réplica en lecture sans son primaire, IAP sans identités autorisées, un
> environnement d'exécution `gen1` avec des montages NFS/GCS, un
> `database_type` qui ne correspond pas au moteur requis par Speedtest
> Tracker, un `redis_port`/`backup_retention_days` hors plage. Ce
> module valide en outre que `cpu_always_allocated=true` implique `min_instance_count >= 1`, et
> que `max_instance_count <= 1` chaque fois que `speedtest_schedule` est défini. Une
> configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant qu'aucune ressource ne soit créée.

| Paramètre | Valeur judicieuse | Risque | Conséquence si incorrect |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire tourner après le premier démarrage | Critique | La faire tourner rend toutes les valeurs de base de données chiffrées indéchiffrables de manière permanente. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `database_type` | `MYSQL_8_0` | Critique | Speedtest Tracker nécessite MySQL dans ce module ; tout autre moteur interrompt le démarrage. |
| `cpu_always_allocated` / `min_instance_count` | `true` / `1` | Critique | Inverser l'un ou l'autre arrête silencieusement `SPEEDTEST_SCHEDULE` de se déclencher — il semblera déployé et sain mais n'exécutera jamais réellement un test de vitesse planifié. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 avec un `speedtest_schedule` actif risque de déclencher des tests de vitesse en double au même moment (pas de verrouillage inter-instance). |
| `memory_limit` | `1Gi` | Élevé | Des valeurs inférieures risquent des arrêts OOM pendant les migrations ou l'utilisation concurrente du tableau de bord. |
| `enable_cloudsql_volume` | `false` (TCP IP privée) | Élevé | Sur Cloud Run, Speedtest Tracker se connecte via TCP IP privée ; forcer le chemin du socket est inutile et peut interrompre la connectivité de la base de données. |
| `ingress_settings` | `all` | Élevé | La définition à `internal` bloque tout accès externe au tableau de bord. |
| `enable_iap` | uniquement lorsque les lecteurs doivent s'authentifier | Élevé | IAP bloque tout accès anonyme. |
| `container_image_source` | `prebuilt` | Moyen | Un Cloud Build personnalisé sans Dockerfile fait échouer le build. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, ingress et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Speedtest Tracker partagée avec la variante GKE est
décrite dans **[SpeedtestTracker_Common](SpeedtestTracker_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : Speedtest Tracker sur Cloud Run](../labs/SpeedtestTracker_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Speedtest Tracker sur GKE Autopilot](SpeedtestTracker_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Speedtest Tracker Common — Configuration d'application partagée](SpeedtestTracker_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Uptime Kuma sur Google Cloud Run](UptimeKuma_CloudRun.md), [Gatus sur Google Cloud Run](Gatus_CloudRun.md), [Healthchecks sur Google Cloud Run](Healthchecks_CloudRun.md), [Beszel sur Google Cloud Run](Beszel_CloudRun.md) dans la solution **Monitoring & NOC**.
