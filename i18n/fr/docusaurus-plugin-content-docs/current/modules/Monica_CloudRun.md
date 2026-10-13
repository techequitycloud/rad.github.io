---
title: "Monica sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Monica sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Monica_CloudRun.md @ e69407af sha256:516a5f5004a4 -->

# Monica sur Google Cloud Run {#monica-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Monica_CloudRun.png" alt="Monica sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Monica est une application open-source de gestion des relations personnelles (PRM) — un
"CRM personnel" pour organiser la façon dont vous restez en contact avec vos amis, votre famille et
vos contacts. Ce module déploie Monica sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Monica et sur la manière de les explorer et de les exploiter
depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à
toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Monica sur RAD, et comment cela se compare {#what-monica-costs-on-rad-and-how-that-compares}

**L'exécution de Monica dans votre propre projet GCP coûte environ 83,61 $/mois en frais Google Cloud ; les frais de module de RAD sont de 75 crédits uniques (ou 67,5 crédits dans un projet géré par RAD), couvrant la configuration et le support -- pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas -- voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 75 crédits, une fois | 67,5 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits au fur et à mesure de l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~83,61 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 GiB (scaleToZero) | 13,16 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **83,61 $** |

### Comment cela se compare {#how-it-compares}

- La version hébergée officielle de Monica coûte **9 $/mois** (90 $/an facturés annuellement) (source : https://www.monicahq.com/en/pricing), gérée par le projet lui-même sans infrastructure à exploiter -- la comparaison qui importe ici est moins le prix affiché que de savoir si vous voulez le cloud du fournisseur ou votre propre projet GCP avec RAD qui le gère.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces -- Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** -- plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que le Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous -- mais le prix de RAD n'est jamais censé battre un VPS, seulement remplacer le temps d'administration qu'un VPS nécessite encore.
- Dans tous les cas, il s'agit d'un CRM personnel à utilisateur unique, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module -- et ce coût d'exécution est celui que vous pouvez suspendre (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD délie d'abord
sa facturation, puis demande à Google de supprimer le projet purement et simplement -- la propre
suppression logicielle récupérable de Google de 30 jours. Contrairement à la suppression d'un module,
cela ne détruit pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de
récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter la mise à
jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes -- c'est une vérification,
pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela ne coûte
qu'une poignée de crédits (moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce que cela nécessite : vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la
facturation), vous devez le restaurer vous-même dans les 30 jours -- après cela, Google le supprime
définitivement -- et la restauration est admise comme la création d'un nouveau projet, donc votre solde
de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox
qui convient à la plupart des utilisations d'étude/démo). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet,
et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très
probable qu'il disparaisse dès que vous supprimez le projet -- même si le projet lui-même est
récupérable pendant 30 jours. Si vous avez personnalisé l'application et que vous souhaitez conserver
ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est
de supprimer Monica purement et simplement et de la redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus
les builds — environ 75 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Monica resterait inutilisée assez longtemps pour compenser
ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela
représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM de fichier/cache partagée ;
elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que
quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec
celui-ci, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de
  l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR,
  par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://www.monicahq.com/en/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Monica s'exécute comme un conteneur PHP/Laravel (image Apache officielle) sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache/PHP, 1 vCPU / 2 GiB par défaut, autoscaling sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Monica est fixée à MySQL |
| Stockage d'objets | Cloud Storage | Un bucket `monica-uploads` dédié pour les photos et documents de contact |
| Persistance | NFS (activé par défaut) | Maintient la durabilité des téléchargements `storage/` de Laravel lors des démarrages à froid et des révisions |
| Cache | Redis (optionnel) | Désactivé par défaut ; utilisé pour le cache/session lorsqu'il est activé |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est le moteur fixe.** `database_type = "MYSQL_8_0"` est défini par la
  couche d'application partagée ; Monica ne fonctionne pas sur PostgreSQL ici.
- **L'image est l'image officielle pré-construite `monica:<version>`.** Pas d'étape Cloud Build —
  `container_image_source = "prebuilt"` tire la variante Apache de Docker Hub,
  qui sert sur le **port 80**.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager. C'est une
  clé de chiffrement Laravel et ne doit jamais être renouvelée après le premier démarrage — la renouveler
  corrompt de manière permanente chaque champ de base de données chiffré et invalide toutes les sessions.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image exécute
  `php artisan migrate --force` à chaque démarrage de conteneur, de sorte que le schéma est créé
  et mis à niveau au démarrage (après que le job `db-init` provisionne la base de données et l'utilisateur).
- **TCP IP privée directe vers Cloud SQL par défaut.** `enable_cloudsql_volume = false`
  sur Cloud Run — Monica se connecte à MySQL via l'IP privée de l'instance (le
  modèle SnipeIT/Matomo Laravel-on-MySQL), pas de socket Auth Proxy, pas de SSL requis.
- **NFS est activé par défaut** (`enable_nfs = true`) afin que les fichiers téléchargés dans le répertoire
  `storage/` de Laravel survivent aux démarrages à froid et aux nouvelles révisions.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`, `max = 1`). Les démarrages
  à froid ajoutent quelques secondes de latence plus le démarrage d'Apache/migration sur la première
  requête après l'inactivité ; définissez `min_instance_count = 1` pour maintenir une instance chaude.
- **`APP_URL` est défini à partir de l'URL de service prédite** afin que Laravel construise des liens
  absolus corrects et que la redirection `/` → setup/registration se résolve sur le bon hôte.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Monica {#a-cloud-run--the-monica-service}

Monica s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le
nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ;
le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" --filter="metadata.name~monica"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et
la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Monica stocke toutes les données de l'application (contacts, activités, rappels, entrées de journal,
utilisateurs) dans une instance gérée de Cloud SQL pour MySQL 8.0. Sur Cloud Run, le service
se connecte via l'**IP privée de l'instance** par défaut (`enable_cloudsql_volume = false`) ;
aucune IP publique n'est exposée. Lors du premier déploiement, le Job `db-init` crée la base de données
et l'utilisateur de l'application et accorde les privilèges ; le point d'entrée du conteneur exécute ensuite les
migrations Laravel.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion,
les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié (suffixe `monica-uploads`) est provisionné
automatiquement pour les fichiers téléchargés de Monica (photos de contact, documents). Des buckets
supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (cache optionnel) {#d-redis-optional-cache}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé, la
fondation injecte `REDIS_HOST`/`REDIS_PORT` ; laisser `redis_host` vide alors que NFS est
activé utilise l'IP de la VM du serveur NFS comme point de terminaison Redis (la VM NFS co-héberge Redis).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected Redis env in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager :
la **`APP_KEY`** de Laravel (utilisée pour le chiffrement AES-256-CBC des colonnes chiffrées et
pour la signature des sessions/cookies). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~monica-app-key"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un
domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le
contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud
Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Monica {#3-monica-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` en utilisant
  `mysql:8.0-debian`. Il se connecte via le socket Cloud SQL (lorsqu'il est monté) ou l'IP privée, et crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges et vérifie que l'utilisateur de l'application peut se connecter. Le job peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent automatiquement au démarrage.** Le point d'entrée de l'image officielle de Monica
  exécute `php artisan migrate --force` à chaque démarrage de conteneur — il n'y a pas de
  job de migration séparé. Le schéma est créé au premier démarrage (après `db-init`) et mis à jour
  automatiquement lorsque vous mettez à jour `application_version`.
- **`APP_KEY` est immuable après le premier démarrage.** Il est généré une fois et écrit dans
  Secret Manager. Le modifier corrompt de manière permanente tous les champs de base de données chiffrés et
  invalide chaque session — ne le faites pivoter que pendant une fenêtre de maintenance planifiée avec un
  plan de rechiffrement complet des données.
- **Configuration initiale dans l'interface utilisateur.** Monica n'a **pas de identifiants par défaut**. Ouvrez l'URL du service : un visiteur non authentifié est redirigé vers la page d'inscription/configuration. Le premier compte que vous créez devient l'administrateur. Inscrivez-vous avec `admin@techequity.cloud` pour les déploiements RAD.
- **Les téléchargements de fichiers nécessitent une persistance.** Les photos/documents téléchargés se trouvent sous le répertoire
  `storage/` de Laravel. NFS est activé par défaut afin qu'ils survivent aux démarrages à froid et aux révisions ;
  le bucket GCS `monica-uploads` est également provisionné. La désactivation de NFS risque de perdre
  les fichiers téléchargés lors du prochain démarrage à froid.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur `/` (passe dès qu'Apache
  lie le port) et la sonde de vivacité est **HTTP** `GET /` (la page d'accueil de Monica
  renvoie `200`). Prévoyez une fenêtre généreuse pour le premier démarrage d'Apache plus la
  migration initiale `php artisan migrate --force`.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls
les paramètres spécifiques ou notables pour Monica sont listés ; toute autre entrée est héritée
de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `monica` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | _(défini)_ | Nom lisible par l'homme affiché dans la Console. |
| `application_version` | `latest` | Tag de l'image Monica ; épingler à une version spécifique en production. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Tire directement l'image officielle `monica` — ne pas changer en `custom`. |
| `cpu_limit` | `1000m` | CPU par instance (1 vCPU). |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1` pour éviter la latence du démarrage à froid + migration. |
| `max_instance_count` | `1` | Une seule instance est suffisante pour un CRM personnel. |
| `container_port` | `80` | L'image Apache de Monica écoute sur le port 80. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte à MySQL via TCP IP privée ; le socket Auth Proxy est désactivé. |

### Groupe 10 — Stockage et système de fichiers {#group-10--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Activé par défaut — persiste les téléchargements `storage/` de Laravel à travers les démarrages à froid/révisions. |
| `nfs_mount_path` | `/var/www/html/storage` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` | `true` | Provisionne le bucket `monica-uploads` (plus tout autre dans `storage_buckets`). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse optionnels (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé à MySQL 8.0. |
| `db_name` | `monica` | Nom de base de la base de données (préfixé par le locataire au déploiement). Immuable après le premier déploiement. |
| `db_user` | `monica` | Nom de base de l'utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30s de délai, 20 tentatives | Passe lorsque Apache lie le port ; fenêtre généreuse pour la migration au premier démarrage. |
| `liveness_probe` | HTTP `/` 300s de délai | La page d'accueil de Monica renvoie `200`. |

### Groupe 21/22 — Cache Redis {#group-2122--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Activer pour ajouter un support de cache/session ; injecte `REDIS_HOST`/`REDIS_PORT`. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les
ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`monica-uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors plage, un `database_type` en dehors de l'ensemble pris en charge, IAP sans identités autorisées. Une configuration invalide échoue la **planification** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter corrompt de manière permanente chaque champ de base de données chiffré et invalide toutes les sessions. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `database_type` | `MYSQL_8_0` | Critique | Monica est une application MySQL ; un moteur non-MySQL casse le pilote et les migrations. |
| `enable_nfs` | `true` | Élevé | La désactivation entraîne la perte des photos/documents de contact téléchargés lors du prochain démarrage à froid ou de la prochaine révision. |
| `container_image_source` | `prebuilt` | Élevé | La définition de `custom` pointe le service vers une image Artifact Registry non construite (`Image not found`). |
| `container_port` | `80` | Élevé | L'image Apache écoute sur le port 80 ; un port non concordant fait échouer la sonde de démarrage. |
| `APP_URL` (auto-défini) | URL de service réelle | Élevé | Une mauvaise URL casse les liens absolus et la redirection `/` → setup/registration (404 sur le mauvais hôte). |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Moyen | Monica se connecte via TCP IP privée ; forcer le socket est inutile et peut laisser `DB_HOST` comme chemin de socket que le client gère mal. |
| `min_instance_count` | `0` (ou `1` pour chaud) | Moyen | La mise à l'échelle à zéro ajoute une latence de démarrage à froid + Apache/migration lors de la première requête après l'inactivité. |
| `memory_limit` | `2Gi` | Moyen | Une taille trop réduite risque un OOM PHP lors des migrations au premier démarrage et des pages lourdes. |
| `enable_redis` | désactivé sauf si nécessaire | Faible | Cache/session de sauvegarde optionnel ; lorsqu'il est activé sans hôte et NFS désactivé, le point de terminaison Redis est vide. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Monica partagée
avec la variante GKE est décrite dans **[Monica_Common](Monica_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Monica sur Cloud Run](../labs/Monica_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Monica sur GKE Autopilot](Monica_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Monica Common — Configuration d'application partagée](Monica_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Radicale sur Google Cloud Run](Radicale_CloudRun.md), [Cal.diy sur Google Cloud Run](CalDiy_CloudRun.md), [ActualBudget sur Google Cloud Run](ActualBudget_CloudRun.md) dans la solution **Organiseur Personnel**.
