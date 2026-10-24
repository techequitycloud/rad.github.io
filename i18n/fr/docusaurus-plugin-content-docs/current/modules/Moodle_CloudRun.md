---
title: "Moodle sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Moodle sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Moodle_CloudRun.md @ 1665a43e sha256:fe18813270e4 -->

# Moodle sur Google Cloud Run {#moodle-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Moodle_CloudRun.png" alt="Moodle sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Moodle est le système de gestion de l'apprentissage (LMS) open source le plus
populaire au monde, utilisé par les universités, les écoles, les entreprises et
les fournisseurs de formation en ligne du monde entier. Ce module déploie Moodle
sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Moodle et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Moodle sur RAD, et comment cela se compare {#what-moodle-costs-on-rad-and-how-that-compares}

**L'exécution de Moodle dans votre propre projet GCP coûte environ 83,61 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~83,61 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, mesuré à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **83,61 $** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour Moodle à comparer, donc la base de référence honnête est un VPS nu : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est généralement pas — pour le système de gestion de l'apprentissage d'une institution, le véritable argument est ce que RAD gère pour vous (sauvegardes, correctifs, secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit du système de gestion de l'apprentissage d'une institution, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré
par RAD délie d'abord sa facturation, puis demande à Google de supprimer
complètement le projet — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression d'un seul module, cela ne détruit pas
Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du
projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de restaurer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter la mise à jour sur chaque déploiement
pour confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3
déploiements.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD
gère uniquement la facturation), vous devez le restaurer vous-même dans les 30
jours — après quoi Google le supprime définitivement — et la restauration est
admise comme la création d'un nouveau projet, donc votre solde de crédits
achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
sandbox qui convient à la plupart des utilisations d'étude/démo). Google
déclare que la plupart des services sont à nouveau pleinement opérationnels dans
les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez
conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en
dehors du projet) avant de la supprimer. Pour une installation par défaut sans
rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de
restauration de 30 jours ci-dessus), l'alternative est de supprimer Moodle
complètement et de le redéployer plus tard. Un redéploiement coûte à nouveau les
frais de module, plus les builds — environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Moodle reste inutilisé
assez longtemps pour compenser ce coût de redéploiement par rapport à son coût
d'exécution quotidien — par rapport au total du projet ci-dessus, cela
représente environ 4 jours ou plus. La majeure partie du coût d'exécution ici
est généralement la base de données et la VM de fichier/cache partagée ; elles
ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la
suppression de cette application alors que quelque chose d'autre partage le
projet n'économise que la partie de calcul propre à cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un
bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la
dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant reçoit l'application dans son propre projet
  Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation
  définie par le formateur. Soit le formateur finance toutes les places, soit
  chaque participant paie la sienne. Tout est supprimé à la fin de la session et
  les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est mise en pause et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
  NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing
Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les
estimations de crédits quotidiens ;
https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les
mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Moodle s'exécute comme un conteneur PHP 8.3/Apache sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP 8.3/Apache, 1 vCPU / 2 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — Moodle ne prend pas en charge MySQL dans ce déploiement |
| Fichiers partagés | Filestore (NFS) | Répertoire Moodle `moodledata` partagé entre toutes les instances ; obligatoire |
| Stockage d'objets | Cloud Storage | Un bucket de données et tout bucket supplémentaire défini par l'utilisateur |
| Cache et sessions | Redis | Activé par défaut ; requis pour la cohérence des sessions PHP multi-instances |
| Secrets | Secret Manager | Mot de passe cron, mot de passe SMTP et mot de passe de base de données générés automatiquement |
| Planificateur | Cloud Scheduler | Tâche cron provisionnée automatiquement (toutes les minutes) pour `/admin/cron.php` |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixe et
  `MOODLE_DB_TYPE =
  "pgsql"` est codé en dur ; la sélection de MySQL ou `NONE`
  interrompt le démarrage.
- **NFS est obligatoire.** Le répertoire Moodle `moodledata` doit être un système de
  fichiers partagé inscriptible accessible à toutes les instances. `enable_nfs`
  par défaut à `true` et nécessite `execution_environment = "gen2"`.
- **La sonde de démarrage est HTTP ciblant `/health.php`.** Contrairement à certaines
  applications PHP qui émettent des redirections HTTP→HTTPS, Apache dans ce
  déploiement se lie sur le port 8080 sans redirection, donc une sonde HTTP
  vers `/health.php` renvoie 200 directement.
- **Redis est activé par défaut.** Sans un magasin de sessions partagé, les
  utilisateurs sont déconnectés lorsqu'une requête atteint une instance Cloud
  Run différente.
- **Une tâche Cloud Scheduler est provisionnée automatiquement.** Elle se
  déclenche toutes les minutes vers `/admin/cron.php` en utilisant un mot de passe cron
  sécurisé, généré automatiquement et stocké dans Secret Manager.
- Le **mot de passe cron** et le **mot de passe SMTP** sont générés
  automatiquement et stockés dans Secret Manager ; vous ne les définissez
  jamais en texte clair.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Moodle {#a-cloud-run--the-moodle-service}

Moodle s'exécute comme un service Cloud Run v2 sans état. L'autoscaling basé sur
les requêtes ajoute des instances sous charge et, avec `min_instance_count = 0`, se met à zéro
entre les sessions (développement) ou maintient une instance chaude lorsqu'il
est défini sur `1` (production).

- **Console :** Cloud Run → sélectionnez le service Moodle pour les journaux, les
  révisions, les métriques et la configuration.
- **CLI :**
  ```bash
  gcloud run services list --region "$REGION" --project "$PROJECT"
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT"
  gcloud run revisions list --service <service-name> --region "$REGION" --project "$PROJECT"
  # Stream recent logs:
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="<service-name>"' \
    --project "$PROJECT" --limit 50 --order asc
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails sur la mise à l'échelle,
la concurrence et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Moodle stocke toutes les données de l'application (cours, utilisateurs, notes,
journaux d'activité) dans une instance Cloud SQL pour PostgreSQL 15 gérée.
Chaque instance Cloud Run se connecte en privé via le sidecar **Cloud SQL Auth
Proxy** sur un socket Unix, de sorte qu'aucune IP publique n'est exposée. Lors
du premier déploiement, une tâche d'initialisation crée la base de données et
l'utilisateur et active l'extension `pg_trgm` pour la recherche en texte intégral
de Moodle.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs et les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  # Open an interactive shell to inspect schema/data:
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, le nom de la base de données, l'utilisateur et le secret
Secret Manager contenant le mot de passe sont tous affichés dans les
[Sorties](#5-outputs). Pour le modèle de connexion, les sauvegardes
automatisées et la rotation des mots de passe, voir
[App_CloudRun](App_CloudRun.md).

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `moodledata` de Moodle est écrit sur un partage **Filestore (NFS)**
monté sur chaque instance Cloud Run afin que toutes les instances voient les
mêmes fichiers téléchargés, les mêmes supports de cours et les mêmes soumissions
d'utilisateurs. Un bucket de données **Cloud Storage** dédié est également
provisionné ; le compte de service se voit accorder l'accès automatiquement.

> Les montages de volumes NFS nécessitent `execution_environment = "gen2"` (la valeur par défaut).

- **Console :** Filestore → Instances pour le partage NFS ; Cloud Storage →
  Buckets pour le bucket de données.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le provisionnement NFS, GCS Fuse et
les options CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge la gestion des sessions PHP de Moodle et le cache
d'application. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est
activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison
Redis — ce qui convient pour le développement. Pour la production avec plusieurs
instances, définissez `redis_host` sur une adresse IP d'instance Cloud Memorystore.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping           # from a host with network access
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe cron et le mot de passe SMTP de Moodle sont générés
automatiquement par `Moodle_Common` et stockés en tant que secrets Secret Manager. Le mot
de passe de la base de données est généré et géré par la fondation. Les trois
sont injectés dans les instances Cloud Run au moment de l'exécution ; le texte
clair n'apparaît jamais dans les fichiers de configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Le nom du secret du mot de passe de la base de données se trouve dans les
[Sorties](#5-outputs). Après le déploiement, mettez à jour le secret du mot de
passe SMTP avec votre véritable identifiant SMTP :
```bash
echo -n "your-smtp-password" | \
  gcloud secrets versions add <smtp-password-secret> --data-file=- --project "$PROJECT"
```

Voir [App_CloudRun](App_CloudRun.md) pour les détails de rotation.

### F. Cloud Scheduler {#f-cloud-scheduler}

Une tâche Cloud Scheduler est provisionnée automatiquement à chaque déploiement
pour piloter la file d'attente des tâches internes de Moodle. Elle se déclenche
toutes les minutes et s'authentifie à l'aide de `MOODLE_CRON_PASSWORD` généré
automatiquement.

- **Console :** Cloud Scheduler → Tâches.
- **CLI :**
  ```bash
  gcloud scheduler jobs list --project "$PROJECT"
  gcloud scheduler jobs describe <job-name> --location "$REGION" --project "$PROJECT"
  # Manually trigger a cron run:
  gcloud scheduler jobs run <job-name> --location "$REGION" --project "$PROJECT"
  ```

### G. Réseau et entrée {#g-networking--ingress}

Par défaut, Moodle est accessible via l'URL `run.app` gérée par Cloud Run. Un
équilibreur de charge HTTPS facultatif avec Cloud Armor et un domaine
personnalisé peut être activé. La définition de `application_domains` injecte
automatiquement `MOODLE_REVERSE_PROXY = "true"` et `ENABLE_REVERSE_PROXY = "TRUE"` afin que Moodle génère des URL HTTPS
correctes derrière l'équilibreur de charge.

- **Console :** Cloud Run → sélectionnez le service → Réseau ; Services réseau →
  Équilibrage de charge (si vous utilisez Cloud Armor).
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --project "$PROJECT" \
    --format="value(status.url)"
  gcloud compute forwarding-rules list --project "$PROJECT"     # if LB is enabled
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les domaines personnalisés, Cloud
CDN et les détails IP statiques.

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les sorties standard/erreur des instances Cloud Run sont acheminées vers Cloud
Logging ; les métriques de requête et les métriques Cloud SQL sont acheminées
vers Cloud Monitoring. Des vérifications de disponibilité et des politiques
d'alerte facultatives sont disponibles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord
  / Alertes.
- **CLI :**
  ```bash
  gcloud logging read \
    'resource.type="cloud_run_revision" AND resource.labels.service_name="<service-name>"' \
    --project "$PROJECT" --limit 50
  ```

---

## 3. Comportement de l'application Moodle {#3-moodle-application-behaviour}

- **Configuration de la base de données lors du premier déploiement.** Deux
  tâches d'initialisation s'exécutent avant que le service Cloud Run ne devienne
  actif. La tâche `db-init` crée la base de données et l'utilisateur Moodle,
  active l'extension `pg_trgm` et accorde les privilèges (idempotent, peut être
  réexécuté en toute sécurité). La tâche `nfs-init` crée les sous-répertoires
  Moodle requis (`filedir`, `temp`, `cache`, `localcache`) sur le partage NFS et définit
  la propriété `www-data`.
- **Planification cron automatique.** Une tâche Cloud Scheduler se déclenche
  toutes les minutes en ciblant `/admin/cron.php?password=<MOODLE_CRON_PASSWORD>`. Cela pilote toutes les tâches
  planifiées de Moodle : sauvegardes de cours, notifications par e-mail,
  traitement des badges et achèvements d'activités. La tâche est toujours
  créée et ne peut pas être désactivée.
- **Chemin de santé.** Les sondes de démarrage et de vivacité utilisent HTTP
  `/health.php`, qui renvoie HTTP 200 lorsque PHP est opérationnel. La sonde de
  démarrage autorise jusqu'à 10 minutes (`failure_threshold = 20`, `period_seconds = 30`) pour la création du
  schéma au premier démarrage et l'enregistrement des plugins.
- **E-mail sortant SMTP.** Les paramètres SMTP sont injectés en tant que
  variables d'environnement. Remplacez les valeurs par défaut à l'aide de
  `environment_variables` (voir Groupe 6). Le mot de passe SMTP est généré
  automatiquement et stocké dans Secret Manager ; mettez à jour le secret avec
  votre véritable identifiant après le déploiement.
- **Résolution `wwwroot`.** Le `config.php` de Moodle résout `wwwroot` à partir de la
  variable d'environnement `APP_URL`, en revenant à `CLOUDRUN_SERVICE_URL`. Lorsque `application_domains` est
  défini, `MOODLE_REVERSE_PROXY` et `ENABLE_REVERSE_PROXY` sont automatiquement définis sur `"true"` / `"TRUE"`
  afin que Moodle génère des URL HTTPS correctes derrière l'équilibreur de
  charge.
- **Mise à l'échelle à zéro.** `min_instance_count = 0` est la valeur par défaut ; la première
  requête après l'inactivité démarrera à froid le conteneur PHP/Apache.
  Définissez `min_instance_count = 1` en production pour éliminer la latence de démarrage à froid
  pour les étudiants.
- **Connexion administrateur.** Le nom d'utilisateur et l'e-mail de
  l'administrateur initial sont configurables via `environment_variables`. Le mot de passe de
  l'administrateur est défini lors de la première installation de Moodle via
  `admin/cli/install_database.php`.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Moodle sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec son comportement standard et ses valeurs
par défaut.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Court suffixe qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources pour le suivi des coûts/propriété. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `moodle` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Moodle LMS` | Nom convivial affiché dans la console. |
| `description` | `Moodle LMS - Online learning and course management platform` | Annotation de description du service. |
| `application_version` | `4.5.1` | Tag de version de l'image conteneur ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance. Augmenter à `2000m` pour la production avec des étudiants concurrents. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 GiB offre une marge pour PHP avec OPcache. |
| `cpu_always_allocated` | `false` | Valeur par défaut de démarrage à froid axée sur les coûts (facturation basée sur les requêtes, associée à `min_instance_count = 0`). Le cron Moodle intégré au conteneur s'arrête, mais Moodle prend officiellement en charge le cron externe — Cloud Scheduler pilote `admin/cli/cron.php` pendant que le service se met à l'échelle à zéro, il n'y a donc aucune perte de fonctionnalité. Définissez `true` avec `min_instance_count >= 1` pour restaurer un fonctionnement continu et toujours actif. |
| `min_instance_count` | `0` | Instances actives minimales. Définir sur `1` pour éliminer la latence de démarrage à froid. |
| `max_instance_count` | `3` | Nombre maximal d'instances concurrentes. |
| `container_port` | `8080` | Moodle/Apache écoute sur le port 8080. |
| `execution_environment` | `gen2` | Requis pour les montages de volumes NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête ; augmenter jusqu'à 3600 pour les téléchargements de fichiers volumineux. |
| `enable_image_mirroring` | `false` | Désactivé — Moodle utilise un Dockerfile personnalisé sans image préconstruite externe. |

### Groupe 5 — Réseau {#group-5--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `"all"` autorise le trafic Internet public. Utilisez `"internal-and-cloud-load-balancing"` lorsque Cloud Armor est en amont. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminement uniquement du trafic RFC 1918 via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Remplacez les valeurs par défaut SMTP auto-injectées ici (par exemple, `MOODLE_SMTP_HOST`, `MOODLE_ADMIN_EMAIL`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |

### Groupe 7 — Sauvegarde et récupération {#group-7--backup--recovery}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30-90 pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et intégration GitHub {#group-8--cicd--github-integration}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après
le provisionnement. Utilisez ceci pour installer des extensions PostgreSQL
supplémentaires ou des données d'amorçage. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Sécurité, stockage et images {#group-10--security-storage--images}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Attacher un WAF Cloud Armor + équilibreur de charge HTTPS. |
| `application_domains` | `[]` | Noms de domaine personnalisés ; active également `MOODLE_REVERSE_PROXY = "true"`. |
| `enable_cdn` | `false` | Activer Cloud CDN sur l'équilibreur de charge. |
| `create_cloud_storage` | `true` | Provisionner le bucket de données. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires à provisionner. |

### Groupe 11 — Système de fichiers (NFS) et Cloud Storage {#group-11--filesystem-nfs--cloud-storage}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour Moodle `moodledata` (garder activé — requis pour tous les déploiements). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin du conteneur où le partage NFS est monté ; injecté comme `MOODLE_DATA_DIR`. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse pour les thèmes ou les plugins. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixé à PostgreSQL 15 — ne pas modifier. |
| `db_name` | `moodle` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `moodle` | Utilisateur de la base de données de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré. |
| `enable_auto_password_rotation` | `false` | Rotation du mot de passe de la base de données sans interruption de service. |

### Groupe 13 — Jobs {#group-13--jobs}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les jobs `db-init` et `nfs-init` intégrés. |
| `cron_jobs` | `[]` | Jobs Cloud Run supplémentaires déclenchés par Cloud Scheduler (le job du planificateur cron Moodle est toujours créé séparément). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/health.php`, 20 échecs × 30 s | Jusqu'à 10 minutes pour que Moodle termine la configuration du premier démarrage. |
| `liveness_probe` | HTTP `/health.php`, 120 s de délai initial | Vérification de santé périodique après le démarrage. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring facultative. |
| `alert_policies` | `[]` | Politiques d'alerte métrique facultatives. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour les sessions PHP et le cache d'application Moodle. |
| `redis_host` | `""` | Laisser vide pour utiliser l'adresse IP de l'hôte NFS (développement uniquement) ; définir sur une adresse IP Cloud Memorystore pour la production. |
| `redis_port` | `6379` | Port Redis (type chaîne). |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Ces valeurs sont renvoyées lors d'un déploiement réussi et constituent le moyen
le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut pour atteindre Moodle. |
| `service_location` | Région du service Cloud Run. |
| `stage_services` | URL des révisions de service spécifiques à l'étape (lorsque Cloud Deploy est activé). |
| `load_balancer_ip` | IP de l'équilibreur de charge externe (lorsque Cloud Armor + domaine personnalisé est activé). |
| `load_balancer_url` | URL HTTPS via l'équilibreur de charge. |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` | Nom de la base de données de l'application. |
| `database_user` | Utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Hôte de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions disponibles. |
| `nfs_server_ip` | IP privée du serveur NFS Filestore (sensible). |
| `nfs_instance_tags` | Tags réseau GCE sur l'instance NFS. |
| `nfs_mount_path` | Chemin du conteneur où le partage NFS est monté. |
| `nfs_share_path` | Chemin d'exportation sur le serveur NFS. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` | État et canaux de surveillance. |
| `uptime_check_names` | Noms des vérifications de disponibilité Cloud Monitoring. |
| `initialization_jobs` / `nfs_setup_job` | Noms des jobs de configuration et d'initialisation NFS. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `cicd_configuration` | État et détails CI/CD (dépôt, déclencheur, registre). |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Moodle nécessite PostgreSQL ; `MOODLE_DB_TYPE = "pgsql"` est codé en dur — tout autre moteur interrompt le démarrage. |
| `enable_nfs` | `true` | Critique | Sans stockage NFS partagé, `moodledata` n'est pas partagé entre les instances et les téléchargements sont perdus au redémarrage. |
| `execution_environment` | `gen2` (par défaut) | Critique | Les montages de volumes NFS ne sont pas pris en charge dans la génération 1 ; le service ne démarrera pas avec NFS activé. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue la tâche d'importation. |
| `enable_redis` | `true` | Élevé | Sans un magasin de sessions partagé, les utilisateurs sur les déploiements multi-instances sont déconnectés à chaque nouvelle instance. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Pas de point de terminaison valide si Redis est activé mais NFS est désactivé et aucun hôte n'est défini. |
| `memory_limit` | `2Gi` | Élevé | Trop peu de mémoire provoque des erreurs OOM PHP lors des importations de cours ou des téléchargements de fichiers volumineux. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` pour la production | Élevé | Les deux par défaut `0` / `false` (démarrage à froid axé sur les coûts) : le service se met à l'échelle à zéro et le CPU est facturé uniquement par requête. `0` provoque des retards de démarrage à froid lors de la première requête après l'inactivité, y compris le déclenchement Cloud Scheduler par minute vers `admin/cli/cron.php` — Moodle prend officiellement en charge ce modèle de cron externe, de sorte que les tâches planifiées s'exécutent toujours correctement (pas de perte de fonctionnalité), juste avec une latence occasionnelle ajoutée. Définissez les deux sur `1` / `true` pour éliminer les démarrages à froid et restaurer un fonctionnement continu. |
| `nfs_mount_path` | `/mnt/nfs` | Élevé | Doit correspondre à `MOODLE_DATA_DIR` ; la modification après le premier déploiement déplace la racine des données et interrompt l'installation. |
| `application_domains` + `MOODLE_REVERSE_PROXY` | définis ensemble | Élevé | Sans les drapeaux de proxy inverse, Moodle génère des URL HTTP derrière un équilibreur de charge HTTPS, ce qui rompt les liens et les connexions. |
| `enable_cloud_armor` / `enable_iap` | activer pour l'interface d'administration | Moyen | L'interface utilisateur d'administration est autrement accessible publiquement. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `max_revisions_to_retain` | `7` | Faible | Un nombre illimité de révisions conservées peut s'accumuler au fil du temps. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, entrée et équilibrage de charge, mise à l'échelle et concurrence,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et cycle de
vie des images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
partagée spécifique à Moodle est décrite dans **[Moodle_Common](Moodle_Common.md)**.

## Guides associées {#related-guides}

- [Lab pratique : Moodle sur Cloud Run](../labs/Moodle_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Moodle sur GKE Autopilot](Moodle_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Moodle Common — Configuration d'application partagée](Moodle_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Nextcloud sur Google Cloud Run](Nextcloud_CloudRun.md), [OnlyOffice sur Google Cloud Run](OnlyOffice_CloudRun.md), [Synapse sur Google Cloud Run](Synapse_CloudRun.md), [Element sur Google Cloud Run](Element_CloudRun.md) dans la solution **Plateforme de gestion de l'apprentissage**.
