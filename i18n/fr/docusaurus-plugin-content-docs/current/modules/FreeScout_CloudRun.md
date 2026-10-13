---
title: "FreeScout sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de FreeScout sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/FreeScout_CloudRun.md @ e69407af sha256:5c73abbf6354 -->

# FreeScout sur Google Cloud Run {#freescout-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/FreeScout_CloudRun.png" alt="FreeScout sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

FreeScout est une plateforme **de service d'assistance et de boîte de réception partagée** gratuite et auto-hébergée, basée sur Laravel (PHP). Elle transforme les boîtes de réception e-mail partagées en une file d'attente de tickets collaborative avec conversations, tags, réponses enregistrées, profil client, API REST et un système de plugins. Ce module déploie FreeScout sur **Cloud Run v2** en s'appuyant sur la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par FreeScout et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — veuillez vous référer au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que FreeScout coûte sur RAD, et comment cela se compare {#what-freescout-costs-on-rad-and-how-that-compares}

**L'exécution de FreeScout dans votre propre projet Google Cloud coûte environ 83,61 $ US/mois en frais Google Cloud, en plus d'un frais de module RAD unique de 110 crédits** (99 crédits — 10 % de moins — dans un projet géré par RAD). FreeScout est un service d'assistance et de boîte de réception partagée gratuit et open-source, basé sur Laravel. Si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement et le reprendre plus tard — voir "Mettez-le en pause gratuitement" ci-dessous.

*FreeScout est également disponible sur GKE — consultez le [guide GKE](FreeScout_GKE.md) si vous avez besoin d'une orchestration basée sur Kubernetes ; ce guide couvre l'option Cloud Run, moins coûteuse.*

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | **110 crédits** (une seule fois) | **99 crédits** (une seule fois, 10 % de moins) |
| Temps de build | ~3–6 crédits (une seule fois, par build) | ~3–6 crédits (une seule fois, par build) |
| Coût d'exécution Google Cloud | ~83,61 $ US/mois, facturé à votre propre compte de facturation Google au prix catalogue | ~32 crédits/jour (~3,20 $ US/jour), facturé à l'heure au prix catalogue plus la marge de RAD |

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | $ US/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **83,61 $ US** |

### Comment cela se compare {#how-it-compares}

- Il n'existe pas de version officiellement hébergée/cloud de FreeScout pour la comparaison, donc la comparaison honnête se fait avec une infrastructure auto-gérée, et non avec un SaaS concurrent.
- Un VPS nu d'environ 1 vCPU / 2 Gio — un Hetzner CPX22 (2 vCPU/4 Go, ~24 $ US/mois), un DigitalOcean 2 vCPU/4 Go Droplet (24 $ US/mois), ou le propre Compute Engine e2-standard-2 de GCP (2 vCPU/8 Go, ~49 $ US/mois) — est généralement moins cher que le prix affiché par RAD ; un VPS d'une ou deux tailles inférieures le serait encore plus.
- Ce prix inférieur n'inclut pas le temps de l'administrateur : mise à jour du système d'exploitation, rotation des sauvegardes de base de données, renouvellement des certificats TLS et surveillance des temps d'arrêt. Cloud SQL géré par RAD, Secret Manager et la surveillance le font pour vous, ce qui est le véritable compromis, et non le prix affiché.
- RAD ne prétend pas être moins cher qu'un VPS nu en termes monétaires — ce n'est généralement pas le cas. L'intérêt de RAD est ce qui est géré pour vous.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si FreeScout est exécuté dans un **projet géré par RAD**, vous pouvez arrêter de le payer entièrement sans le détruire. La suppression de ce projet délie d'abord sa facturation, puis demande à Google de supprimer purement et simplement le projet — la suppression logicielle récupérable de 30 jours de Google. Contrairement à la suppression du module FreeScout seul, cela ne supprime pas Cloud SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la facturation est déjà déliée.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet, demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter une mise à jour sur chaque déploiement pour confirmer que tout est revenu. Parce que rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais à nouveau les frais de module. Cela ne coûte qu'une poignée de crédits de temps de build au total — environ 5 à 10 crédits, moins de 1 $ US, pour une chaîne de déploiement typique de 2 à 3. Les frais de module de 99 crédits ne sont pas facturés à nouveau.

Ce que cela nécessite : vous devez être propriétaire du projet (pas un projet dont RAD ne gère que la facturation), vous devez le restaurer vous-même dans les 30 jours — après cela, Google le supprime définitivement — et la restauration est admise comme la création d'un nouveau projet, de sorte que votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.

Un véritable manque : les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé FreeScout et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Si FreeScout se trouve dans votre propre projet (ou si plus de 30 jours se sont écoulés sur un projet géré par RAD), la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer plus tard lorsque vous en aurez à nouveau besoin.

Un redéploiement coûte à nouveau les frais de module, plus les builds : environ **110 + ~3–6 crédits** (~11,45 $ US) dans votre propre projet, ou **99 + ~3–6 crédits** sur un projet géré par RAD.

La suppression ne permet d'économiser de l'argent que si FreeScout devait rester inutilisé assez longtemps pour compenser le coût de ce redéploiement par rapport à son propre coût d'exécution : environ **5 jours ou plus** d'inactivité dans votre propre projet (par rapport à sa facture Google Cloud d'environ 83,61 $ US/mois), ou **environ 4 jours ou plus** d'inactivité dans un projet géré par RAD (par rapport à ses ~32 crédits/jour).

La majeure partie du coût d'exécution de FreeScout est la base de données et la VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la part de calcul de cette application sur le total ci-dessus.

Gardez les données en premier : les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil :** un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les propres frais de RAD et les estimations de crédits quotidiens ; [documentation de Google sur la suppression/restauration de projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration.

## 1. Vue d'ensemble {#1-overview}

FreeScout s'exécute comme un conteneur PHP unique (nginx + php-fpm) sur Cloud Run v2, construit comme une image personnalisée légère `FROM tiredofit/freescout`. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur PHP sur le port 80, 1 vCPU / 2 Gio par défaut, mise à l'échelle automatique sans serveur ; prise en charge de la mise à l'échelle à zéro |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — FreeScout ne prend pas en charge PostgreSQL ou d'autres moteurs |
| Fichiers persistants | Cloud Filestore (NFS) | Activé par défaut ; monté à `/var/lib/freescout` pour les pièces jointes et les données d'exécution |
| Stockage d'objets | Cloud Storage | Un bucket de téléchargement (`gcs-freescout<tenant-prefix>-freescout-uploads`) provisionné automatiquement |
| Cache (optionnel) | Redis | Cache d'objets optionnel ; désactivé par défaut |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-généré et `ADMIN_PASS` de première exécution ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître à l'avance :**

- **MySQL 8.0 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée (`MYSQL_8_0`) ; la sélection de tout autre moteur empêche le démarrage.
- **La `APP_KEY` Laravel est générée automatiquement** et stockée dans Secret Manager. Elle chiffre les données de session et toutes les colonnes de base de données chiffrées (informations d'identification de boîte aux lettres stockées, jetons OAuth). **Ne la faites jamais pivoter après le premier démarrage** — cela invaliderait de manière permanente toutes les données précédemment chiffrées.
- **Un administrateur de première exécution est automatiquement créé.** `ADMIN_EMAIL` (par défaut `admin@techequity.cloud`) avec le secret `ADMIN_PASS` généré crée le premier administrateur au premier démarrage. Changez le mot de passe dans l'interface utilisateur après la première connexion.
- **`APP_URL` / `SITE_URL` sont définis sur l'URL du service.** FreeScout construit des liens absolus et son flux `/` → tableau de bord/connexion à partir de `APP_URL` ; le point d'entrée du conteneur le résout à partir de l'`CLOUDRUN_SERVICE_URL` réel au moment de l'exécution.
- **Cloud SQL est accessible via TCP (IP privée), pas un socket.** `enable_cloudsql_volume` par défaut à `false` sur Cloud Run ; l'application se connecte à l'`DB_IP` injecté sur le port 3306. MySQL sur l'IP privée ne nécessite pas de SSL client.
- **NFS est activé par défaut** afin que les pièces jointes et les fichiers d'exécution survivent au recyclage des conteneurs et aux démarrages à froid de la mise à l'échelle à zéro. Nécessite l'environnement d'exécution `gen2`.
- **La mise à l'échelle à zéro est activée** (`min_instance_count = 0`, `max_instance_count = 1`). Les démarrages à froid ajoutent plusieurs secondes à la première requête après l'inactivité ; définissez `min_instance_count = 1` pour maintenir le service toujours chaud.
- **L'état de santé est signalé sur `GET /`.** Il n'y a pas de point de terminaison JSON de santé dédié ; la sonde de démarrage est TCP et la sonde de vivacité est `GET /`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service FreeScout {#a-cloud-run--the-freescout-service}

FreeScout s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre les nombres minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION" \
    --filter="metadata.name~freescout"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

FreeScout stocke toutes les données de l'application (conversations, boîtes aux lettres, utilisateurs, clients, paramètres) dans une instance Cloud SQL gérée pour MySQL 8.0. Sur Cloud Run, le service se connecte via l'**IP privée de l'instance (TCP, port 3306)** — `enable_cloudsql_volume` par défaut à `false`. Lors du premier déploiement, le Job `db-init` crée la base de données de l'application, l'utilisateur et les autorisations ; l'application exécute ensuite ses propres migrations de schéma au démarrage.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~freescout"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) {#c-cloud-filestore-nfs}

Les pièces jointes et les fichiers d'exécution de FreeScout sont persistés sur un volume NFS monté à `/var/lib/freescout` (activé par défaut). Cela garantit la durabilité des téléchargements lors des changements de révision et de la mise à l'échelle à zéro. NFS nécessite l'environnement d'exécution `gen2`.

- **Console :** Filestore → Instances (une instance gérée par Services_GCP ou une instance intégrée).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  # Confirm the mount in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.volumes)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le modèle de découverte NFS partagé.

### D. Cloud Storage {#d-cloud-storage}

Un bucket de téléchargement **Cloud Storage** dédié (`gcs-freescout<tenant-prefix>-freescout-uploads`) est provisionné automatiquement. Des buckets supplémentaires peuvent être déclarés via `storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~freescout"
  gcloud storage ls gs://<bucket-name>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Redis (cache d'objets optionnel) {#e-redis-optional-object-cache}

Redis est **désactivé par défaut**. Lorsque `enable_redis = true`, `REDIS_HOST`/`REDIS_PORT` sont injectés dans le conteneur en tant que backend de cache d'objets. Lorsque `redis_host` est laissé vide et `enable_nfs` est vrai, l'IP de la VM du serveur NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager {#f-secret-manager}

Deux secrets sont générés automatiquement et stockés dans Secret Manager : la `APP_KEY` Laravel (chiffre les données de session et les colonnes de base de données chiffrées) et `ADMIN_PASS` (le mot de passe administrateur de première exécution). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~freescout"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### G. Réseau et ingress {#g-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings = "all"`), ce qui permet un accès public à l'interface utilisateur du service d'assistance. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'égresse VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application FreeScout {#3-freescout-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un Job d'initialisation exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il se connecte à Cloud SQL (socket si monté, sinon TCP via `DB_IP`), crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges et vérifie que l'utilisateur de l'application peut se connecter. Le job s'exécute lors de l'apply et peut être réexécuté en toute sécurité.
- **Les migrations s'exécutent au démarrage du conteneur.** Il n'y a pas de job de migration séparé — l'image tiredofit exécute `php artisan migrate --force` à chaque démarrage de conteneur, donc la mise à niveau `application_version` applique les modifications de schéma au prochain démarrage.
- **L'administrateur de première exécution est créé.** Au premier démarrage, l'image crée l'administrateur défini par `ADMIN_EMAIL` / `ADMIN_FIRST_NAME` / `ADMIN_LAST_NAME` avec le secret `ADMIN_PASS`. Connectez-vous et changez le mot de passe immédiatement.
- **`APP_KEY` est immuable après le premier démarrage.** La clé Laravel est générée une fois et écrite dans Secret Manager. La modifier invalide de manière permanente toutes les données précédemment chiffrées (informations d'identification de boîte aux lettres chiffrées, jetons OAuth, cookies chiffrés). Ne la faites pivoter que lors d'une fenêtre de maintenance planifiée avec une reconfiguration complète.
- **`APP_URL` doit correspondre à l'hôte du navigateur.** FreeScout construit des liens absolus et son routage `/` à partir de `APP_URL` ; le point d'entrée le définit à partir de l'`CLOUDRUN_SERVICE_URL` injecté. Si vous mettez le service en façade avec un domaine personnalisé, définissez `APP_URL`/`SITE_URL` (via `environment_variables`) sur cet hôte afin que les liens et les redirections se résolvent correctement. Inspectez la révision en cours d'exécution :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" --format='value(status.url)'
  ```
- **Chemin de santé.** La sonde de démarrage est TCP sur le port du conteneur (délai de 30 s, 20 échecs) et la sonde de vivacité est HTTP `GET /` (délai initial de 300 s). Attendez plusieurs minutes au premier démarrage pendant que les migrations s'exécutent avant que le service ne signale son état de santé.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour FreeScout sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `freescout` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `FreeScout` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `latest` | Tag de l'image de base pour le build léger (`latest` épingle à `php8.3-1.17.159`) ; définissez un tag explicite tel que `1.8.170` en production. |
| `php_memory_limit` | `512M` | Limite de mémoire PHP ; augmentez-la pour le traitement de pièces jointes volumineuses. |
| `upload_max_filesize` / `post_max_size` | `64M` | Taille maximale de téléchargement de pièces jointes / POST. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | FreeScout se déploie comme un build personnalisé léger ; laissez comme `custom`. |
| `cpu_limit` | `1000m` | CPU par instance ; minimum 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 512 Mio (plancher gen2), 2 Gio recommandés. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Gardez à 1 sauf si le NFS partagé et la gestion de session sont confirmés comme étant sûrs pour plusieurs instances. |
| `container_port` | `80` | FreeScout (nginx/php-fpm) écoute sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `enable_cloudsql_volume` | `false` | Cloud Run se connecte à MySQL via TCP (IP privée) ; laissez `false`. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public à l'interface utilisateur du service d'assistance. |
| `enable_iap` | `false` | Exiger la connexion Google devant FreeScout (IAP natif de Cloud Run). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets (par exemple `MAIL_*`, ou un `APP_URL` personnalisé pour un domaine personnalisé). Les valeurs de base de données et d'administrateur sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. `APP_KEY` et `ADMIN_PASS` sont câblés automatiquement — ne les définissez pas ici. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | NFS est **activé** par défaut — persiste les pièces jointes/fichiers d'exécution. |
| `nfs_mount_path` | `/var/lib/freescout` | Chemin de montage à l'intérieur du conteneur. |
| `create_cloud_storage` | `true` | Crée les buckets GCS déclarés. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket de téléchargement auto-provisionné. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | MySQL 8.0 fixe ; ne pas changer de moteur. |
| `db_name` | `freescout` | Nom de la base de données MySQL (injecté comme `DB_DATABASE`). Immuable après le premier déploiement. |
| `db_user` | `freescout` | Utilisateur de la base de données de l'application (injecté comme `DB_USERNAME`). Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP `/` 30 s de délai, 20 échecs | Fenêtre généreuse pour les migrations au premier démarrage. |
| `liveness_probe` | HTTP `GET /` 300 s de délai | `GET /` renvoie 200 une fois démarré ; pas de point de terminaison de santé dédié. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Vérification de disponibilité Cloud Monitoring optionnelle. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active un cache d'objets Redis. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |

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
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un environnement d'exécution `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à l'application, un `container_port`/`backup_retention_days` hors de portée, IAP sans identités autorisées. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `APP_KEY` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide de manière permanente toutes les données précédemment chiffrées — les informations d'identification de boîte aux lettres chiffrées et les jetons OAuth ne peuvent plus être déchiffrés. |
| `database_type` | `MYSQL_8_0` | Critique | FreeScout est uniquement MySQL ; un moteur Postgres/autre empêche le démarrage. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `APP_URL` / `SITE_URL` | URL réelle du service/domaine | Élevé | Un hôte incorrect rompt les liens absolus, le routage `/` et les liens de réinitialisation de mot de passe/e-mail. |
| `enable_nfs` | `true` | Élevé | La désactivation entraîne la perte de toutes les pièces jointes et des fichiers d'exécution lors du recyclage du conteneur / de la mise à l'échelle à zéro. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Élevé | Forcer le socket sans un fichier socket réel laisse l'application sans hôte TCP — la connexion échoue. |
| `memory_limit` | `2Gi` (≥512 Mio) | Élevé | En dessous du plancher de 512 Mio de gen2 est rejeté au moment de la planification ; trop faible, cela provoque des OOM-kills sous charge. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans gestion confirmée du stockage partagé/des sessions peut entraîner un état incohérent entre les instances. |
| `enable_iap` | uniquement pour les déploiements privés | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les intégrations de type webhook d'e-mail entrant. |
| `ADMIN_PASS` (auto-généré) | Changer dans l'interface utilisateur après la première connexion | Moyen | Le mot de passe généré se trouve dans Secret Manager ; faites-le pivoter dans l'application pour une information d'identification détenue par un humain. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `application_version` | Épingler en production | Moyen | `latest` peut déplacer l'image de base sous vous entre les déploiements. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la conformité de la rétention. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à FreeScout partagée avec la variante GKE est décrite dans **[FreeScout_Common](FreeScout_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : FreeScout sur Cloud Run](../labs/FreeScout_CloudRun.md) — déployez-le étape par étape, avec les écrans de console et les commandes à chaque étape.
- [FreeScout sur GKE Autopilot](FreeScout_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [FreeScout Common — Configuration d'application partagée](FreeScout_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Fider sur Google Cloud Run](Fider_CloudRun.md), [Gotify sur Google Cloud Run](Gotify_CloudRun.md) dans la solution **Service client**.
