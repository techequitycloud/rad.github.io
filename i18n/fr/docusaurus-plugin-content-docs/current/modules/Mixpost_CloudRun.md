---
title: "Mixpost sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Mixpost sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Mixpost_CloudRun.md @ 1665a43e sha256:83ae8a19bc48 -->

# Mixpost sur Google Cloud Run {#mixpost-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Mixpost_CloudRun.png" alt="Mixpost sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Mixpost est une plateforme open-source et auto-hébergée de planification et de
gestion des médias sociaux — une alternative à Buffer/Hootsuite pour composer,
planifier, publier et analyser des publications sur plusieurs comptes sociaux
depuis un tableau de bord unique. Il est livré sous la forme d'une application
Laravel unique (nginx + PHP-FPM + supervisord exécutant le worker de file
d'attente et le planificateur à l'intérieur d'un seul conteneur, l'image
officielle `inovector/mixpost`). Ce module déploie Mixpost sur **Cloud Run v2**
au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et
gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Mixpost et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Mixpost sur RAD, et comment cela se compare {#what-mixpost-costs-on-rad-and-how-that-compares}

**L'exécution de Mixpost dans votre propre projet GCP coûte environ 98,82 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettre en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Temps de build | mesuré en crédits pendant l'exécution du build (quelques crédits, généralement) | idem |
| Coût d'exécution Google Cloud | ~98,82 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~32 crédits/jour, mesuré à l'heure par RAD au prix catalogue majoré d'une marge |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 2x vCPU / 2 GiB (scaleToZero) | 28,37 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **98,82 $** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de SaaS géré officiel vérifié pour Mixpost à comparer, donc la base de référence honnête est un VPS nu : Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go est également à **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) est à environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré par RAD, Secret Manager et la surveillance couvrent pour vous.
- RAD n'est pas censé être moins cher qu'un VPS en termes monétaires, et ne l'est généralement pas — pour un outil de planification sociale d'une petite équipe, le véritable argument est ce que RAD gère pour vous (sauvegardes, correctifs, secrets, surveillance) plutôt que le prix affiché.
- Dans tous les cas, il s'agit d'un outil de planification sociale pour une petite équipe, donc le coût d'exécution ci-dessus est ce qui génère réellement la facture, pas les frais de module — et ce coût d'exécution est celui que vous pouvez mettre en pause (voir ci-dessous).

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logicielle récupérable de 30 jours de Google.
Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou
la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien
n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à
Google de récupérer le projet et de rattacher son compte de facturation, puis vous
demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est
revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à
jour ne facture plus jamais les frais de module. Cela ne coûte qu'une poignée de crédits
(moins de 1 $ US) au total pour une chaîne de déploiement typique de 2-3.

Ce qu'il faut : vous devez être propriétaire du projet (pas un projet dont RAD gère
uniquement la facturation), vous devez le restaurer vous-même dans les 30 jours —
après cela, Google le supprime définitivement — et la restauration est admise comme la
création d'un nouveau projet, donc votre solde de crédits achetés doit toujours
dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient à la
plupart des utilisations d'étude/démo). Google indique que la plupart des services
fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket à
l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage
explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous
supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si
vous avez personnalisé l'application et que vous souhaitez conserver ce travail,
copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de
supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas
d'importance.

### Payer uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Mixpost purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module, plus les builds — environ 110 + 3-6 crédits de temps de build.

La suppression ne permet d'économiser de l'argent que si Mixpost reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 3 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM de fichier/cache partagée ; elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet ne sauve que la partie calcul de cette application.

**Conserver les données en premier :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

Mixpost s'exécute comme un conteneur web unique et autonome sur Cloud Run v2 —
pas d'étape de build séparée, puisque l'image pré-construite officielle est
déployée directement.

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx + PHP-FPM + supervisord écoutant sur le port 80, 2 vCPU / 2 GiB par défaut ; autoscaling sans serveur |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis et fixe — `Mixpost_Common` code en dur `MYSQL_8_0` |
| File d'attente, cache et sessions | Redis | Activé par défaut ; pilote `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` ; utilise par défaut l'IP du serveur NFS co-localisé si aucun hôte externe n'est spécifié |
| Stockage d'objets | Cloud Storage | Un bucket `storage` suffixé provisionné automatiquement par `Mixpost_Common` |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Mixpost_Common` définit `database_type = "MYSQL_8_0"`
  et `DB_CONNECTION = "mysql"` inconditionnellement ; la valeur faciale de la variable
  `database_type` n'est pas réellement transmise depuis le module d'application
  pour le choix du moteur Mixpost — seul MySQL est pris en charge.
- **La base de données est accessible via un socket Unix Cloud SQL Auth Proxy, pas TCP.**
  `enable_cloudsql_volume` active par défaut `false` sur ce module (contrairement à la
  plupart des modules Cloud Run MySQL/Laravel) — vérifiez la révision déployée si
  l'application ne peut pas atteindre la base de données ; l'activation monte le socket à
  `/cloudsql` et `db-init.sh` détecte automatiquement le type de connexion
  (`-S <socket>` vs `-h <host> --get-server-public-key`).
- **Redis est activé par défaut et effectivement requis.** `enable_redis = true`
  connecte `QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER` à `redis`
  (en revenant à `sync`/`file` uniquement si désactivé) — cette fusion
  se produit dans les variables locales `main.tf` du module d'application, et non dans
  `Mixpost_Common`. Lorsque `redis_host` est vide, l'IP de la VM du serveur NFS est
  utilisée comme point de terminaison Redis (nécessite `enable_nfs = true`).
- **`min_instance_count = 0`, `cpu_always_allocated = false` — démarrage à froid,
  facturation basée sur les requêtes.** Contrairement à la variante GKE (qui utilise par
  défaut `min = 1` pour maintenir le planificateur intégré au pod en
  fonctionnement continu), la variante Cloud Run se met à l'échelle à zéro entre les
  requêtes. **Compromis :** le cron `schedule:run` Laravel et le worker de file
  d'attente ne s'exécutent que lorsqu'une instance est chaude/sert une requête, de sorte
  que les publications sociales planifiées ne sont **pas** publiées de manière fiable
  par elles-mêmes — externalisez `schedule:run` avec Cloud Scheduler en
  atteignant un point de terminaison cron (toutes les minutes), ou définissez
  `cpu_always_allocated = true` **et** `min_instance_count >= 1` pour restaurer
  le fonctionnement continu en cours de processus (reflétant les applications toujours
  actives documentées dans le CLAUDE.md du dépôt).
- **NFS est activé par défaut** (`enable_nfs = true`, `/mnt/nfs`) pour le
  stockage partagé de médias/fichiers, et sert également d'hôte Redis par défaut lorsque
  `redis_host` est laissé vide.
- **`APP_KEY` est généré automatiquement** et stocké dans Secret Manager au
  format natif `base64:<value>` de Laravel — ne le faites jamais pivoter après le
  premier démarrage.
- **Le mappage des variables d'environnement de la base de données Laravel est codé en dur dans `main.tf`.**
  `db_user_env_var_name =
  "DB_USERNAME"`, `db_name_env_var_name = "DB_DATABASE"` et `service_url_env_var_name = "APP_URL"` sont définis dans
  `main.tf` du module d'application (non configurable par l'opérateur) afin que
  les URL `DB_USER`/`DB_NAME`/de service de la fondation,
  définies par le locataire, correspondent aux noms de variables d'environnement que
  `env()` de Laravel lit réellement.
- **La sonde de démarrage est TCP, la sonde de vivacité est HTTP.** `main.tf`
  remplace la configuration de `Mixpost_Common` pour utiliser une sonde de démarrage
  `TCP` sur le port 80 (les vérifications de santé Cloud Run arrivent via
  HTTP simple depuis une adresse interne à Google, et TCP est suffisant pour confirmer
  que le port écoute) et une sonde de vivacité `HTTP` contre
  `/`, à laquelle Mixpost répond avec `200`.
- **`container_image_source = "prebuilt"`** déploie `inovector/mixpost:<version>`
  directement ; il n'y a pas de build Dockerfile personnalisé pour ce module.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Mixpost {#a-cloud-run--the-mixpost-service}

Mixpost s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Mixpost stocke toutes les données de l'application (comptes sociaux, publications, métadonnées multimédias, utilisateurs) dans une instance Cloud SQL gérée pour MySQL 8.0. Lors du premier déploiement, le job d'initialisation `db-init` crée la base de données de l'application (`utf8mb4`) et l'utilisateur et accorde les privilèges ; la méthode de connexion (socket vs TCP) est auto-détectée à partir de `$DB_HOST`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Un bucket **Cloud Storage** dédié suffixé `storage` est provisionné
automatiquement par `Mixpost_Common`. Des buckets supplémentaires peuvent être
déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~storage"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (file d'attente, cache et sessions) {#d-redis-queue-cache--sessions}

Redis est **activé par défaut** (`enable_redis = true`), pilotant
`QUEUE_CONNECTION`, `CACHE_DRIVER` et `SESSION_DRIVER`. Aucune
instance Memorystore dédiée n'est provisionnée par ce module — à moins que
`redis_host` ne soit remplacé par une instance externe, Redis est attendu à
l'adresse IP de la VM du serveur NFS (la même VM Compute Engine qui sert NFS
exécute également Redis dans la convention d'infrastructure partagée de ce
référentiel).

- **Console :** Memorystore → Redis (uniquement si pointé vers une instance gérée) ;
  sinon Compute Engine → Instances de VM pour l'hôte NFS/Redis.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'QUEUE_CONNECTION|CACHE_DRIVER|SESSION_DRIVER'
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Mixpost est généré automatiquement : la `APP_KEY`
Laravel (`secret-<resource_prefix>-<application_name>-app-key`), une valeur aléatoire de 32 caractères
encodée en base64 au format natif `base64:<value>` de Laravel. Le mot de passe de la
base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~mixpost"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Cloud Filestore (NFS) {#f-cloud-filestore-nfs}

**Activé par défaut** (`enable_nfs = true`), monté à `/mnt/nfs` pour la
persistance partagée des médias/téléchargements, et — lorsque `redis_host` est
laissé vide — également le point de terminaison Redis par défaut.

- **Console :** Filestore → Instances ; ou Compute Engine → Instances de VM si l'hôte
  Redis/NFS est la VM NFS auto-gérée du référentiel.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud compute instances list --project "$PROJECT" --filter="name~nfs"
  ```

### G. Réseau et ingress {#g-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'égression VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Mixpost {#3-mixpost-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job d'initialisation
  `db-init` exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il
  détecte automatiquement si `$DB_HOST` est un chemin de socket Unix
  (`-S`) ou un hôte TCP (`-h ... --get-server-public-key`, nécessaire car
  `caching_sha2_password` de MySQL 8 refuse d'envoyer un mot de passe sur ce qui
  ressemble à une connexion non chiffrée), crée de manière idempotente la base de
  données de l'application avec `utf8mb4`, crée l'utilisateur de
  l'application et accorde les privilèges. Le job peut être réexécuté en toute
  sécurité (`execute_on_apply = true`, `max_retries = 1`).
- **Pas de job de migration séparé.** Le point d'entrée supervisord intégré de
  l'image pré-construite `inovector/mixpost` exécute `php artisan migrate --force` et
  initialise le compte administrateur à chaque démarrage, il n'y a donc pas de job
  d'initialisation de migration distinct — la mise à niveau de `application_version`
  applique automatiquement les modifications de schéma au prochain démarrage.
- **`APP_KEY` est immuable après le premier démarrage.** Généré une fois
  par `Mixpost_Common` et écrit dans Secret Manager sous le nom
  `base64:<32-char value>`. Sa rotation invalide les données de session/cookie chiffrées
  et tous les champs de base de données chiffrés.
- **Les valeurs par défaut du compte administrateur sont intégrées à l'image, non configurables via ce module.**
  `mixpost_admin_email` est déclaré pour la transmission mais n'est **pas
  actuellement injecté** dans la configuration du conteneur en cours d'exécution —
  l'image initialise son propre compte administrateur par défaut, quelle que soit
  cette variable. Récupérez les identifiants de première connexion réels à partir
  des valeurs par défaut documentées de l'image et modifiez le mot de passe
  immédiatement après la première connexion.
- **La publication planifiée dépend du maintien de l'instance en activité.** Avec le
  démarrage à froid par défaut (`min_instance_count = 0`, `cpu_always_allocated = false`),
  le planificateur/worker de file d'attente Laravel intégré au conteneur ne
  s'exécute que lorsqu'une requête est en cours ou que l'instance est dans sa
  fenêtre de maintien en activité. Pour une publication planifiée fiable, soit
  pointez un job Cloud Scheduler vers un point de terminaison cron/santé toutes
  les minutes pour maintenir une instance en vie et déclencher `schedule:run`,
  soit définissez `cpu_always_allocated = true` avec `min_instance_count >= 1`.
- **Chemin de santé.** La sonde de démarrage est `TCP` sur le port 80
  (évite toute complication de redirection/authentification HTTP au premier
  démarrage) ; la sonde de vivacité est `HTTP` sur `/`,
  à laquelle Mixpost/nginx répond directement avec `200`. `REQUIRE_HTTPS = false`
  est injecté car Cloud Run termine le TLS devant le conteneur.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```
- **Inspecter la configuration en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -E 'DB_|APP_URL|QUEUE_CONNECTION'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Mixpost sont listés ; toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `mixpost` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Mixpost` | Nom lisible par l'homme affiché dans la Console. |
| `application_description` | `Mixpost - Open-source social media management platform` | Description du service. |
| `application_version` | `latest` | Tag d'image `inovector/mixpost` déployé directement (pré-construit, pas de build personnalisé). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie `inovector/mixpost` directement ; transmis explicitement afin que la Fondation ne le traite pas comme un build personnalisé sans Dockerfile. |
| `container_image` | `""` | Remplacer par un URI d'image miroir ou personnalisé. |
| `cpu_limit` | `2000m` | 2 vCPU recommandés. |
| `memory_limit` | `2Gi` | Mixpost nécessite au moins 2 GiB pour le traitement des médias et les workers de file d'attente. |
| `cpu_always_allocated` | `false` | Facturation basée sur le démarrage à froid/les requêtes. Définir `true` (avec `min_instance_count >= 1`) pour maintenir le planificateur/worker de file d'attente Laravel en fonctionnement continu ; sinon externaliser `schedule:run` via Cloud Scheduler. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1`+ pour éviter les démarrages à froid et maintenir le planificateur en activité. |
| `max_instance_count` | `3` | Plafond de coût ; augmenter avec prudence — Mixpost n'a pas de coordination de file d'attente multi-instances intégrée au-delà de Redis. |
| `container_port` | `80` | nginx + PHP-FPM servent du HTTP simple sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Socket Unix Cloud SQL Auth Proxy. Activer pour les connexions basées sur socket ; `db-init.sh` détecte automatiquement le socket ou le TCP dans tous les cas. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Mixpost dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |
| `container_protocol` | `http1` | `h2c` disponible si l'application prend en charge HTTP/2 en clair. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin de montage pour le socket Cloud SQL Auth Proxy. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour l'interface utilisateur Mixpost et tous les webhooks entrants des plateformes sociales. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `APP_*`/`DB_*`/`MAIL_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `explicit_secret_values` | `{}` | Valeurs sensibles brutes écrites directement dans Secret Manager pendant le déploiement. |
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

### Groupe 9 — Instance NFS et SQL personnalisé {#group-9--nfs-instance--custom-sql}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `nfs_instance_name` / `nfs_instance_base_name` | _(défini)_ | Instance NFS existante / nom de base pour une instance intégrée. |
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |

### Groupe 10 — Cloud Armor, CDN et rétention d'images {#group-10--cloud-armor-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "storage" }]` | Le bucket auto-provisionné plus tous les buckets supplémentaires. |
| `enable_nfs` | `true` | Activé par défaut pour les médias/téléchargements partagés, et sert également de source d'hôte Redis par défaut. |
| `nfs_mount_path` | `/var/www/html/storage/app/public` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Mixpost_Common` ; non modifiable pour un autre moteur. |
| `application_database_name` | `mixpost` | Nom de la base de données. Immuable après le premier déploiement. |
| `application_database_user` | `mixpost` | Utilisateur de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non connecté au propre planificateur de Mixpost — utiliser ceci ou un job Cloud Scheduler externe si vous externalisez `schedule:run` sous le démarrage à froid par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` port 80, délai de 90s, `failure_threshold=36` | Sonde de démarrage remplacée dans `main.tf` par TCP. |
| `liveness_probe` | HTTP `/`, délai de 120s, `failure_threshold=3` | Sonde de vivacité ; Mixpost/nginx répond `/` avec `200`. |
| `startup_probe_config` | HTTP `/`, délai de 90s | Sonde structurée alternative (valeur par défaut de l'objet de configuration ; remplacée par la substitution `startup_probe` ci-dessus pour la révision Cloud Run réelle). |
| `health_check_config` | HTTP `/`, délai de 120s | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Connecte `QUEUE_CONNECTION`/`CACHE_DRIVER`/`SESSION_DRIVER` à `redis` ; revient à `sync`/`file` si désactivé. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

### Groupe 23 — Paramètres de l'application Mixpost {#group-23--mixpost-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `mixpost_admin_email` | `admin@example.com` | Déclaré pour le câblage ; **non actuellement injecté** dans la configuration en cours d'exécution — l'image initialise son propre compte administrateur par défaut, quelle que soit cette variable. |
| `mail_from_name` | `Mixpost` | Nom d'affichage de l'expéditeur sur les e-mails sortants (`MAIL_FROM_NAME`). |
| `mail_from_address` | `mixpost@example.com` | Adresse de l'expéditeur sur les e-mails sortants (`MAIL_FROM_ADDRESS`) ; `MAIL_MAILER = "smtp"` est défini automatiquement. |

Toutes les autres entrées suivent le comportement standard de [App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

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
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critique | Non modifiable pour un autre moteur ; `Mixpost_Common` code en dur MySQL quelle que soit la valeur nominale de cette variable. |
| `application_database_name` / `application_database_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | La rotation de la clé Laravel invalide les données de session/cookie chiffrées et tous les champs de base de données chiffrés. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` si utilisation de la publication planifiée | Élevé | Laisser la valeur par défaut de démarrage à froid (`false` / `0`) signifie que le planificateur Laravel et le worker de file d'attente ne s'exécutent que lorsqu'une instance est chaude — les publications sociales planifiées cessent silencieusement de publier selon un calendrier, à moins d'être externalisées via Cloud Scheduler. |
| `enable_redis` + `redis_host` / `enable_nfs` | `true` + NFS activé, ou un `redis_host` explicite | Élevé | L'activation de Redis sans source d'hôte (pas de `redis_host`, pas de NFS) laisse la connexion Redis vide et l'application ne parvient pas à mettre en file d'attente/mettre en cache/gérer les sessions correctement. |
| `enable_cloudsql_volume` | Correspondre aux attentes de connexion à la base de données de l'application | Élevé | Ce module le définit par défaut `false` (TCP/IP privée) ; si `db-init` ou l'application ne peut pas atteindre la base de données, vérifiez si un socket (`true`) ou un chemin TCP est réellement utilisé dans la révision déployée. |
| `memory_limit` | `2Gi` | Élevé | Mixpost nécessite au moins 2 Go pour le traitement des médias et les workers de file d'attente ; des valeurs inférieures risquent des arrêts OOM sous une charge concurrente. |
| `mixpost_admin_email` | Récupérer les véritables identifiants après le déploiement | Moyen | La variable n'est pas injectée dans la configuration en cours d'exécution ; l'image amorce son propre compte administrateur par défaut quoi qu'il arrive — changez le mot de passe immédiatement après la première connexion. |
| `min_instance_count` | `0` pour le coût, `1`+ pour la latence/planification | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité, en plus du compromis de planification ci-dessus. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur d'administration et la connexion sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle
et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Mixpost
(le secret `APP_KEY`, le script `db-init` et les variables d'environnement
fusionnées dans le conteneur) est partagée avec la variante GKE via le module interne
`Mixpost_Common`, qui n'est pas déployé directement et n'a pas encore
son propre guide de configuration.

## Guides associés {#related-guides}

- [Lab pratique : Mixpost sur Cloud Run](../labs/Mixpost_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Mixpost sur GKE Autopilot](Mixpost_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Mixpost Common — Configuration d'application partagée](Mixpost_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Matomo sur Google Cloud Run](Matomo_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md) dans la solution **Marketing Automation Suite**.
