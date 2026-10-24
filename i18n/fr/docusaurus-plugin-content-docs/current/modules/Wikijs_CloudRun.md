---
title: "Wiki.js sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Wiki.js sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Wikijs_CloudRun.md @ 1665a43e sha256:b722effe0ed6 -->

# Wiki.js sur Google Cloud Run {#wikijs-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Wikijs_CloudRun.png" alt="Wiki.js sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Wiki.js est une puissante plateforme wiki open source conçue pour les équipes qui
ont besoin d'une gestion des connaissances moderne et rapide, avec un contrôle de
version basé sur Git et une expérience d'écriture claire. Ce module déploie
Wiki.js sur **Cloud Run v2** sur la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Wiki.js et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Coût de Wiki.js sur RAD et comparaison {#what-wikijs-costs-on-rad-and-how-that-compares}

**L'exécution de Wiki.js sur Cloud Run dans votre propre projet Google Cloud
coûte environ 83,61 $/mois en frais Google Cloud**, en plus d'un frais de module
RAD unique de 75 crédits facturé une fois au moment du déploiement. Wiki.js
nécessite une base de données PostgreSQL et un serveur de fichiers NFS/cache
partagé derrière elle, ce qui représente la majeure partie des 83,61 $ ci-dessus.
Dans un projet géré par RAD, les frais de module tombent à 67,5 crédits (10 % de
moins) et le coût d'exécution est mesuré à l'heure en crédits au lieu d'être
facturé directement par Google — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it)
ci-dessous pour le seul avantage géré par RAD qu'un VPS auto-hébergé ne peut pas
égaler — ou voir le [guide GKE](Wikijs_GKE.md) si vous préférez l'exécuter sur
Kubernetes.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module (unique) | 75 crédits | 67,5 crédits (10 % de moins) |
| Temps de build | ~3-6 crédits par build, dans les deux cas | ~3-6 crédits par build, dans les deux cas |
| Coût d'exécution Google Cloud | 83,61 $/mois, facturé par Google au prix catalogue | ~32 crédits/jour, mesuré au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **83,61 $** |

### Comparaison {#how-it-compares}

- Wiki.js n'a pas de version SaaS hébergée officielle — comme la plupart des
  wikis auto-hébergés, il est uniquement livré sous forme de logiciel que vous
  exécutez vous-même, donc la comparaison est "gérer un VPS" contre "laisser RAD
  gérer la même pile", et non RAD contre un abonnement.
- Une comparaison auto-gérée : Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois,
  un Droplet DigitalOcean 2 vCPU/4 Go coûte le même prix de 24 $/mois, et un GCP
  Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ 49 $/mois — n'importe
  lequel de ces services est suffisant pour exécuter Wiki.js et sa base de données
  Postgres ensemble dans Docker Compose sur une seule machine, à un prix affiché
  inférieur à celui de la pile gérée par RAD.
- Ce que ce prix n'inclut pas : les sauvegardes, les correctifs de sécurité, le
  renouvellement TLS et les alertes de disque plein à 2h du matin, que Cloud SQL,
  Secret Manager et la surveillance gérés par RAD absorbent pour vous.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

C'est l'avantage principal d'un projet géré par RAD, et il ne coûte rien
lorsqu'il est en pause. La suppression d'un projet géré par RAD annule d'abord
sa facturation, puis demande à Google de supprimer purement et simplement le
projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement
à la suppression d'un module, cela ne démantèle **pas** Cloud SQL, aucune VM ou
la ressource de calcul une par une : l'ensemble du projet s'arrête
simplement, et rien n'est facturé pendant qu'il attend, car la facturation est
déjà dissociée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais à nouveau les frais de module. Cela ne coûte que quelques crédits (moins
de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet pour lequel
RAD gère uniquement la facturation), vous devez le restaurer vous-même dans les
30 jours — après cela, Google le supprime définitivement — et la restauration
est admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
déclare que la plupart des services sont à nouveau pleinement fonctionnels dans
les 36 heures suivant une restauration.

Une lacune réelle : les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que
vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
jours. Si vous avez personnalisé Wiki.js et que vous souhaitez conserver ce
travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du
projet) avant de la supprimer. Pour une installation par défaut sans rien
d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet, ou une fois que 30 jours se sont écoulés sur un projet
géré par RAD, il n'y a pas de pause gratuite — la suppression supprime les
ressources définitivement, et la remise en service de Wiki.js signifie un
redéploiement à partir de zéro. Cela coûte environ 78-81 crédits (les frais de
module de 75 crédits plus un build).

La suppression ne permet d'économiser de l'argent que si Wiki.js reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son propre
coût d'exécution — pour Wiki.js, c'est environ 3 jours ou plus. La majeure
partie de ce coût d'exécution est généralement la base de données et toute VM de
fichier/cache partagée — celles-ci ne s'arrêtent que lorsque rien d'autre dans
le projet ne les utilise, donc la suppression de cette application pendant que
quelque chose d'autre partage le projet n'économise que sa propre part de
calcul.

Priorité aux données : les sauvegardes nocturnes sont stockées dans un bucket
au sein du déploiement et sont supprimées avec celui-ci. Copiez donc la dernière
sauvegarde avant de la supprimer si vous souhaitez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

Sessions de lab, pour la formation : un formateur anime une session pour une
classe. Chaque participant obtient l'application dans son propre projet Google
Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
par le formateur. Soit le formateur finance toutes les places, soit chaque
participant paie la sienne. Tout est supprimé à la fin de la session et les
crédits inutilisés sont reversés au formateur.

Environnements gérés, pour les cabinets de conseil : un partenaire exécute
l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
et règle directement avec le client. Si le portefeuille est faible, la
facturation est suspendue et les données sont conservées, afin que personne ne
reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les
déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les
propres frais de RAD et les estimations de crédits quotidiens ;
[documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les affirmations de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Wiki.js s'exécute en tant que conteneur Node.js sur Cloud Run v2. Le déploiement
connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Wiki.js utilise PostgreSQL avec l'extension `pg_trgm` pour la recherche en texte intégral |
| Fichiers partagés | Filestore (NFS) | Actifs téléchargés partagés entre toutes les instances (montés dans le service) |
| Stockage d'objets | Cloud Storage | Un bucket `wikijs-storage` dédié, montable via GCS Fuse à `/wiki-storage` |
| Cache (facultatif) | Redis | Désactivé par défaut ; activer pour la mise en cache de session |
| Secrets | Secret Manager | Mot de passe de base de données auto-généré |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** La sélection de MySQL ou `NONE`
  empêche le démarrage. L'extension `pg_trgm` est installée
  automatiquement et est requise pour la recherche en texte intégral de Wiki.js.
- **Port 3000.** Wiki.js se lie au port 3000 (défini par `Wikijs_Common`),
  et non aux ports conventionnels 80 ou 8080.
- **L'environnement d'exécution Gen2 est requis** pour les montages NFS. Cloud
  Run gen2 est la valeur par défaut.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0` est la valeur par
  défaut — définissez-la sur `1` pour les wikis qui ne peuvent pas
  tolérer des démarrages à froid de 15 à 30 secondes.
- **Le chemin de stockage des actifs est important.** `HA_STORAGE_PATH=/wiki-storage` indique
  à Wiki.js où écrire les téléchargements. Le volume NFS ou GCS Fuse doit être
  monté au même chemin.
- **La base de données est amorcée lors du premier déploiement** par un job
  `db-init` qui crée l'utilisateur, la base de données et le schéma
  PostgreSQL. La sonde de démarrage utilise `/healthz` avec un délai
  initial de 60 secondes pour permettre cela.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de service et de ressource sont signalés dans les
[Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Wiki.js {#a-cloud-run--the-wikijs-service}

Wiki.js s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge de requêtes entre le nombre minimal et
maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic
peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Wiki.js stocke toutes les données d'application (pages, utilisateurs, navigation,
index de recherche) dans une instance Cloud SQL pour PostgreSQL 15 gérée.
L'extension `pg_trgm` est installée au moment du provisionnement et
alimente la recherche en texte intégral native de Wiki.js. Le service se
connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas
d'adresse IP publique). Lors du premier déploiement, un job d'initialisation
crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les actifs téléchargés sont écrits dans un partage **Filestore (NFS)** monté
dans le service afin que toutes les instances partagent les mêmes fichiers. Un
bucket **Cloud Storage** dédié (`wikijs-storage`) est également
provisionné pour le stockage persistant des actifs ; il peut être monté à
`/wiki-storage` via GCS Fuse.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/       # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis (facultatif) {#d-redis-cache-optional}

Redis est désactivé par défaut. Lorsqu'il est activé, il fournit la mise en
cache de session. Définissez `enable_redis = true` et fournissez `redis_host`
pour l'activer.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté
dans le service au moment de l'exécution ; le texte en clair n'apparaît jamais
dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails de l'injection et de la
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peut être superposé ; les paramètres d'ingress et de sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Wiki.js {#3-wikijs-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation (`db-init`) utilise l'image `postgres:15-alpine`
  pour se connecter via le Cloud SQL Auth Proxy, créer de manière idempotente la
  base de données et l'utilisateur `wikijs`, et accorder les
  privilèges requis. L'extension PostgreSQL `pg_trgm` est installée
  dans le cadre de la configuration `Wikijs_Common`. Le job peut être
  réexécuté en toute sécurité.
- **Migration du schéma au premier démarrage.** Wiki.js se connecte à
  PostgreSQL au démarrage et exécute sa propre migration de schéma interne. La
  sonde de démarrage a un délai initial de 60 secondes pour permettre cela lors
  du premier démarrage.
- **Chemin de stockage des actifs.** Wiki.js écrit les fichiers téléchargés
  dans le chemin défini par `HA_STORAGE_PATH` (par défaut
  `/wiki-storage`). Pour persister les actifs entre les révisions,
  configurez `gcs_volumes` pour monter le bucket `wikijs-storage` à
  `/wiki-storage`. Le chemin de montage NFS et cette variable doivent
  résoudre au même emplacement.
- **Point de terminaison de santé.** Les sondes de démarrage et de vivacité
  utilisent toutes deux `/healthz`, qui renvoie HTTP 200
  uniquement lorsque Wiki.js est en cours d'exécution et connecté à PostgreSQL.
  Ne remplacez pas cela par `/` — le chemin de l'interface
  utilisateur est lent et peut renvoyer des erreurs au démarrage.
- **Redis est facultatif.** Wiki.js ne nécessite pas Redis pour son
  fonctionnement de base. Activez-le lorsque vous souhaitez une mise en cache de
  session au niveau de l'application.

  Inspectez les jobs et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Wiki.js sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `wikijs` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Wiki.js` | Nom convivial affiché dans la console. |
| `application_version` | `2.5.311` | Tag de version de l'image Wiki.js ; incrémenter pour déclencher une nouvelle révision. |
| `db_name` | `wikijs` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement ; doit correspondre à `DB_NAME`. |
| `db_user` | `wikijs` | Utilisateur PostgreSQL. Immuable après le premier déploiement ; doit correspondre à `DB_USER`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum `1Gi` pour Node.js. |
| `min_instance_count` | `0` | Instances minimales — définir `1` pour éliminer les démarrages à froid. |
| `max_instance_count` | `1` | Instances maximales. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | `300` | Augmenter pour les exportations de pages volumineuses ou le traitement des actifs. |
| `enable_cloudsql_volume` | `true` | Cloud SQL Auth Proxy pour les connexions par socket Unix. |
| `enable_image_mirroring` | `true` | Mettre en miroir `requarks/wiki:2` de Docker Hub vers Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{ DB_TYPE="postgres", DB_PORT="5432", DB_USER="wikijs", DB_NAME="wikijs", DB_SSL="false", HA_STORAGE_PATH="/wiki-storage" }` | Pré-rempli avec les paramètres de connectivité de la base de données Wiki.js. Valeurs essentielles — ne pas supprimer. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. `DB_PASS` est câblé automatiquement. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Attacher une politique WAF / restreindre l'accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les actifs Wiki.js. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur — doit correspondre à `HA_STORAGE_PATH`. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de stockage / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe — ne pas modifier. Wiki.js nécessite PostgreSQL. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | _(défini)_ | Noms sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré de `Wikijs_Common`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/healthz`, délai initial de 60 s | Sonde de démarrage — délai généreux pour la migration de la base de données au premier démarrage. |
| `liveness_probe` | HTTP `/healthz`, délai initial de 60 s | Sonde de vivacité. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de la disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer Redis pour la mise en cache de session (facultatif pour Wiki.js). |
| `redis_host` | `""` | Point de terminaison Redis. Requis lorsque `enable_redis = true` **sauf si** `enable_nfs = true` ou un serveur NFS est autrement découvrable, auquel cas l'IP du serveur NFS est utilisée comme hôte Redis par défaut. `enable_nfs` est par défaut `true` pour ce module, donc `redis_host` n'est pas réellement requis dans la configuration par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Logs d'audit Cloud détaillés. |

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
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | État de la journalisation d'audit et de CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Wiki.js nécessite PostgreSQL ; MySQL/`NONE` empêche le démarrage. |
| `db_name` / `DB_NAME` | les deux `wikijs` | Critique | Incohérence : `db-init` crée une base de données différente de celle à laquelle Wiki.js se connecte — boucle de crash. Immuable après le premier déploiement. |
| `enable_cloudsql_volume` | `true` | Critique | La désactivation supprime le sidecar Auth Proxy — toutes les connexions PostgreSQL échouent. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `db_user` / `DB_USER` | les deux `wikijs` | Élevé | Incohérence : les autorisations sont pour un utilisateur mais Wiki.js s'authentifie comme un autre — échec d'authentification. |
| `enable_nfs` | `true` | Élevé | Sans stockage partagé, les téléchargements écrits par une instance sont invisibles pour les autres. |
| `nfs_mount_path` + `HA_STORAGE_PATH` | les deux `/wiki-storage` | Élevé | Si le chemin de montage et `HA_STORAGE_PATH` ne correspondent pas, Wiki.js écrit sur un disque éphémère. |
| `memory_limit` | `2Gi` | Élevé | En dessous de `1Gi`, Wiki.js est tué par manque de mémoire au démarrage ou sous charge. |
| `startup_probe.initial_delay_seconds` | `60` | Élevé | Trop faible — Wiki.js est tué avant la fin de la migration du schéma au premier démarrage. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro provoque des démarrages à froid de 15 à 30 secondes avec des requêtes en cours échouées. |
| `gcs_volumes` | monter à `/wiki-storage` | Élevé | Le bucket `wikijs-storage` est provisionné mais non monté automatiquement ; sans `gcs_volumes`, les téléchargements vont sur un disque éphémère. |
| `application_version` | `2.5.311` | Élevé | Wiki.js 2.x et 3.x ont des schémas incompatibles. Testez les mises à niveau en staging. |
| `enable_iap` / `ingress_settings` | restreindre pour les wikis internes | Élevé | La valeur par défaut (`all`) expose la page de connexion de Wiki.js à l'internet public. |
| `enable_redis` | `false` sauf si nécessaire | Faible | Wiki.js ne nécessite pas Redis pour son fonctionnement de base. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — identité de service, mise
à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Wiki.js partagée avec la variante GKE est décrite
dans **[Wikijs_Common](Wikijs_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Wiki.js sur Cloud Run](../labs/Wikijs_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [Wiki.js sur GKE Autopilot](Wikijs_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Wikijs Common — Configuration d'application partagée](Wikijs_Common.md) — la configuration partagée par les deux cibles de déploiement.
