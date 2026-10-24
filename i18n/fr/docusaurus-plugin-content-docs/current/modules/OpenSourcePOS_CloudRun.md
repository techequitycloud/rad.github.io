---
title: "OpenSourcePOS sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Open Source POS sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenSourcePOS_CloudRun.md @ 1665a43e sha256:27704ff9969f -->

# OpenSourcePOS sur Google Cloud Run {#opensourcepos-on-google-cloud-run}

Open Source Point of Sale (OSPOS) est un système de point de vente de détail
basé sur le Web, gratuit et open source : enregistrez les ventes, gérez les
articles, les clients et les fournisseurs, imprimez les reçus et exécutez des
rapports de ventes et d'inventaire à partir d'un navigateur. Ce module déploie
OpenSourcePOS sur **Cloud Run v2** sur la base de la
[fondation App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par OpenSourcePOS et sur
la manière de les explorer et de les exploiter à partir de la console Google
Cloud et de la ligne de commande. Pour les mécanismes communs à chaque
application Cloud Run — identité de service, entrée et équilibrage de charge,
mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous
au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Coût d'OpenSourcePOS sur RAD et comparaison {#what-opensourcepos-costs-on-rad-and-how-that-compares}

**Pour un seul magasin, le module Cloud Run d'OpenSourcePOS sur RAD coûte environ 70 US$ par mois, sans licence par utilisateur.** Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 70 US$ deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 US$ au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Identique |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **26 crédits par jour**, soit environ 780 crédits par mois (environ 78 US$ au prix de la recharge, 62 US$ au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 US$ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 US$ |
| Cloud NAT et réseau | 5 US$ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 US$ |
| **Total** | **environ 70 US$** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg).
- **La mise à l'échelle à zéro est le comportement par défaut.** La ligne Cloud Run ci-dessus reflète déjà ce coût ; le réglage `min_instance_count = 1` maintient une instance chaude et augmente cette ligne, en échange de l'absence de démarrages à froid.

### Comparaison {#how-it-compares}

- Aucun fournisseur de point de vente open source ne vend une version hébergée officielle de ce projet exact avec des prix publics, donc cette comparaison se fait par rapport à un serveur nu.
- OpenSourcePOS n'a besoin que de 1 vCPU / 2 Gio — plus petit que la classe de comparaison ci-dessous, donc un niveau de VPS moins cher ferait probablement l'affaire. Les chiffres les plus petits vérifiés indépendamment sont : Hetzner CPX22 ou un Droplet DigitalOcean de 2 vCPU/4 Go, tous deux à environ 24 US$/mois, ou un GCP Compute Engine e2-standard-2 à environ 49 US$/mois.
- Une seule caisse ou un stand saisonnier est exactement le cas où **Mettez-le en pause gratuitement**, ci-dessous, est le plus important : un magasin qui ne fonctionne que quelques mois par an n'a pas besoin de payer pour une base de données inactive le reste du temps.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenSourcePOS fonctionne dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — étudier pour une certification, un environnement de démonstration, une activité saisonnière — que de faire fonctionner OpenSourcePOS en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 US$) pour une chaîne typique de 2 à 3 déploiements, contre les 80 crédits (8 US$) qu'un redéploiement complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 70 US$.** Déployez OpenSourcePOS, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps pendant lequel OpenSourcePOS a été réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes d'OpenSourcePOS sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à OpenSourcePOS que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 US$), car RAD recrée le projet et les services partagés avant OpenSourcePOS. La suppression ne permet d'économiser de l'argent que si OpenSourcePOS resterait inutilisé pendant environ 4 jours ou plus, à la fois dans votre propre projet (environ 2,34 US$ par jour) et dans un projet géré par RAD (26 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données.** Elle ne s'arrête que si rien d'autre dans le projet ne l'utilise, donc la suppression d'OpenSourcePOS alors que quelque chose d'autre partage le projet n'économise que la partie calcul d'OpenSourcePOS.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

OpenSourcePOS s'exécute comme un conteneur PHP / CodeIgniter 4 (un seul processus
Apache sur le port 80) sur Cloud Run v2. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache + PHP, 1 vCPU / 2 Gio par défaut ; mise à l'échelle à zéro par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — `OpenSourcePOS_Common` fixe le moteur. Contient toutes les données POS **et** les sessions utilisateur |
| Stockage d'objets | Cloud Storage | Un bucket `storage`, monté via GCS-Fuse à `/app/public/uploads` pour les images d'articles et le logo de l'entreprise ; plus un bucket générique `data` non utilisé par l'application |
| Secrets | Secret Manager | Mot de passe de la base de données uniquement — OpenSourcePOS n'a pas de secret de signature d'application |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Le moteur est fixé par `OpenSourcePOS_Common`.
- **`enable_cloudsql_volume = false`.** OpenSourcePOS lit un hôte TCP simple (`MYSQL_HOST_NAME`), de sorte que le service se connecte directement à l'**IP privée** de l'instance. Il n'y a pas de remplacement de port dans OpenSourcePOS — le port est toujours 3306.
- **La mise à l'échelle à zéro est la valeur par défaut livrée** (`min_instance_count = 0`, `max_instance_count = 1`). Pour une caisse en utilisation quotidienne, définissez `min_instance_count = 1` : un caissier n'attendra pas un démarrage à froid.
- **Plusieurs instances sont sûres.** Les sessions vivent dans MySQL (`DatabaseHandler`, table `ospos_sessions`) et les téléchargements vivent sur le bucket GCS partagé, donc augmenter `max_instance_count` ne déconnecte pas les caissiers et ne perd pas les images.
- **Les téléchargements persistent sur GCS.** `enable_gcs_storage_volume = true` monte le bucket `storage` à `/app/public/uploads`. L'image en amont ne déclare aucun volume à cet endroit, donc sans le montage, les images téléchargées seraient perdues à chaque démarrage à froid.
- **NFS est désactivé et non nécessaire** (`enable_nfs = false`).
- **La version est épinglée** (`application_version = "3.4.1"`). N'utilisez jamais `latest`.
- **La vérification de disponibilité est désactivée** par défaut (`uptime_check_config.enabled = false`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenSourcePOS {#a-cloud-run--the-opensourcepos-service}

OpenSourcePOS s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement à la charge de requêtes entre les nombres minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

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

OpenSourcePOS stocke tout — ventes, articles, clients, fournisseurs, réceptions,
configuration et sessions — dans une instance gérée Cloud SQL pour MySQL 8.0. Le
service se connecte via l'**IP privée** de l'instance **via TCP**. Lors du
premier déploiement, un job `db-init` crée la base de données et l'utilisateur de
l'application, suivi de `schema-load`, qui charge le schéma livré dans l'image
OpenSourcePOS.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Storage {#c-cloud-storage}

Deux buckets d'application sont provisionnés :

- **`storage`** — ajouté par `OpenSourcePOS_Common` et monté via GCS Fuse à `/app/public/uploads`, où OpenSourcePOS écrit les images d'articles et le logo de l'entreprise (uniquement lorsque `enable_gcs_storage_volume = true`).
- **`data`** — le défaut générique de la Fondation de `storage_buckets` ; non lu ou écrit par OpenSourcePOS.

La Fondation crée également un bucket de sauvegardes pour le job de sauvegarde
planifié.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket-name>/
  ```

### D. Secret Manager {#d-secret-manager}

OpenSourcePOS n'a pas de secret au niveau de l'application : `OpenSourcePOS_Common` ne renvoie aucun secret propre. La seule information d'identification est le mot de passe de la base de données, que la Fondation génère et stocke dans Secret Manager (son nom est la sortie `database_password_secret`).

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<database-password-secret> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring. La vérification de disponibilité est désactivée par défaut et les politiques d'alerte sont vides jusqu'à leur configuration.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenSourcePOS {#3-opensourcepos-application-behaviour}

- **Chaîne d'initialisation en deux étapes.** `db-init` (`mysql:8.0-debian`, `max_retries = 3`) crée l'utilisateur et la base de données de l'application et accorde les privilèges, puis vérifie que l'utilisateur de l'application peut se connecter. `schema-load` dépend de `db-init` et s'exécute sur l'**image de l'application** (`image = null`), car le fichier de schéma n'est livré qu'à l'intérieur de `jekkos/opensourcepos` à `/app/app/Database/database.sql`. Il compte d'abord les tables de la base de données : si elles existent, il se termine sans modifications, et après le chargement, il échoue si la base de données n'a toujours pas de tables. Les deux jobs s'exécutent lors de l'apply et peuvent être réexécutés en toute sécurité.
- **Pourquoi un job, pas le point d'entrée.** Cloud Run peut démarrer à froid plusieurs instances à la fois ; deux d'entre elles exécutant le même ensemble `CREATE TABLE` produiraient un schéma à moitié chargé sans erreur. Un job s'exécute une fois, avant que le service ne serve.
- **Ligne de journal de démarrage.** À chaque démarrage, le wrapper imprime `[startup] OpenSourcePOS pointed at <ip>:3306/<db> as <user>`. Si l'une des variables `DB_IP`, `DB_USER`, `DB_PASSWORD` ou `DB_NAME` est vide, il imprime un message `FATAL:` et se termine — OpenSourcePOS reviendrait sinon silencieusement aux informations d'identification intégrées dans `.env` de l'image et s'exécuterait contre la mauvaise base de données.
- **Correctifs d'image.** L'image du wrapper écrit un vrai `date.timezone` (`UTC`) dans `timezone.ini` de PHP (l'amont le livre vide), définit `CI_ENVIRONMENT =
  production` (le `development` de l'amont affiche les traces de pile et la barre d'outils de débogage dans le navigateur), et ajoute une garde `X-Forwarded-Proto` à la réécriture de suppression de `www` dans `public/.htaccess`, qui redirigerait sinon `https://www.<domain>` vers `http://` sur un domaine personnalisé.
- **Vérifications de santé.** Les sondes de démarrage et de vivacité vérifient toutes deux `GET /`, la racine du document où OpenSourcePOS sert sa page de connexion — le même chemin que celui utilisé par `HEALTHCHECK` de l'image en amont.
  ```bash
  curl -s -o /dev/null -w "%{http_code}\n" "$SERVICE_URL/"
  ```
- **Compte administrateur.** L'administrateur est créé par le schéma fourni avec le nom d'utilisateur `admin` ; le module ne le crée ni ne le modifie, et l'entrée `admin_email` n'est pas appliquée. Changez le mot de passe de l'administrateur après la première connexion.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
OpenSourcePOS sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `tenant_id` | `demo` | Suffixe court (1 à 7 caractères alphanumériques en minuscules) qui rend les noms de ressources uniques par environnement. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `ospos` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenSourcePOS` | Nom lisible par l'homme affiché dans la console. |
| `application_version` | `3.4.1` | Tag `jekkos/opensourcepos`, passé au build comme `OSPOS_VERSION`. La valeur par défaut de cette variante est celle qui prend effet. Épinglez une version exacte. |
| `php_memory_limit` | `512M` | Injecté comme variable d'environnement simple `memory_limit`. |
| `admin_email` | `admin@example.com` | Non appliqué — l'administrateur provient du schéma fourni. |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `storage` à `/app/public/uploads` (la description de la variable nomme `/opt/ospos/var/data` ; le chemin monté est `/app/public/uploads`). |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image du wrapper via Cloud Build. `prebuilt` ignore le wrapper — pas de mappage `MYSQL_*`, pas de correctifs d'image. |
| `cpu_limit` | `1000m` | CPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; utilisez `1` pour une caisse en cours d'utilisation. |
| `max_instance_count` | `1` | Limite supérieure de l'autoscaling. Le multi-instance est sûr. |
| `container_port` | `80` | Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | Requis pour le montage des téléchargements GCS Fuse. |
| `timeout_seconds` | `300` | Délai d'expiration de la requête ; augmentez-le pour les importations ou les rapports volumineux. |
| `enable_cloudsql_volume` | `false` | TCP IP privée au lieu du socket Auth Proxy. |
| `enable_image_mirroring` | `true` | Mettre l'image en miroir dans Artifact Registry. |
| `container_protocol` | `http1` | HTTP/1.1. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique par défaut. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google avant la page de connexion du POS. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Ne définissez pas les variables de connexion `MYSQL_*` ici — le wrapper les exporte depuis `DB_*` au démarrage. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `protect_sensitive_environment_variables` | `true` | Les clés nommées par les informations d'identification dans `environment_variables` sont déplacées vers Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Âge du cycle de vie appliqué au bucket de sauvegardes. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés et instance NFS {#group-9--custom-sql-scripts--nfs-instance}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Ce
groupe contient également `nfs_instance_name` / `nfs_instance_base_name`, pertinents uniquement si
`enable_nfs` est activé. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Liste blanche CIDR pour l'accès administratif. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer les buckets du module. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket générique de la Fondation ; non utilisé par OpenSourcePOS. |
| `enable_nfs` | `false` | Non nécessaire — les téléchargements persistent sur GCS. |
| `nfs_mount_path` | `/var/lib/ospos` | Utilisé uniquement si `enable_nfs = true` ; rien dans l'image n'y écrit. |
| `gcs_volumes` | `[]` | Montages GCS Fuse supplémentaires, fusionnés avec le volume de téléchargements `storage`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `OpenSourcePOS_Common`. |
| `db_name` / `db_user` | `ospos` | Préfixé par le locataire au moment du déploiement. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). Ne pas modifier sur un déploiement en cours. |
| `enable_auto_password_rotation` | `false` | Rotation automatique du mot de passe. |
| `db_host_env_var_name` | `DB_IP` | Garder comme `DB_IP` — le point d'entrée du wrapper le lit. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne intégrée `db-init` → `schema-load`. Fournir un job remplace les deux. |
| `cron_jobs` | `[]` | Pas de tâches planifiées par défaut ; OpenSourcePOS n'en a pas besoin. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `GET /`, délai de 30s, période de 15s, 20 tentatives | Attend qu'Apache serve la page de connexion. |
| `liveness_probe` | HTTP `GET /`, délai de 60s, période de 30s, 3 tentatives | Racine du document. |
| `uptime_check_config` | `{ enabled = false, path = "/" }` | Activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | OpenSourcePOS n'a pas d'intégration Redis ; laisser désactivé. |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Non utilisé par OpenSourcePOS. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
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
| `stage_services` | Services de la phase Cloud Deploy (lorsqu'activé). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (sensible) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `schema-load`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de la fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `application_version` | Une version exacte (par défaut `3.4.1`) | **Critique** | `latest` se résout en une image avec une disposition différente ; l'historique du module enregistre son échec de déploiement. Une balise flottante se reconstruit également sous une chaîne inchangée, de sorte qu'aucune nouvelle révision n'est déployée et que le conteneur en cours d'exécution conserve silencieusement l'ancienne image. |
| `container_image_source` | `custom` | **Critique** | `prebuilt` ignore le wrapper : pas de mappage `DB_*` → `MYSQL_*` (OpenSourcePOS revient alors aux informations d'identification `localhost` intégrées et ne peut pas atteindre Cloud SQL), et aucun des correctifs de fuseau horaire / `CI_ENVIRONMENT` / réécriture TLS. |
| `db_host_env_var_name` | `DB_IP` | **Critique** | Le point d'entrée du wrapper lit `DB_IP` ; il refuse de démarrer si celui-ci est vide. |
| `db_name` / `db_user` | Définir une fois | **Critique** | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et perd toutes les données de vente. |
| `database_password_length` | Laisser à `32` après le déploiement | Élevé | Le modifier sur un déploiement en cours écrit un nouveau secret de mot de passe tandis que la base de données conserve l'ancien ; les connexions échouent jusqu'à ce que le job `db-init` soit réexécuté. |
| `enable_gcs_storage_volume` | `true` | Élevé | Sans le montage, les images d'articles et le logo de l'entreprise sont écrits dans le système de fichiers éphémère du conteneur et perdus à chaque démarrage à froid ou nouvelle révision. |
| `initialization_jobs` | `[]` | Élevé | Fournir un job remplace toute la chaîne par défaut, y compris `schema-load` ; l'application démarre alors avec une base de données vide. |
| `min_instance_count` | `1` pour une caisse en cours d'utilisation | Moyen | La mise à l'échelle à zéro (`0`) fait attendre la première vente après l'inactivité pour un démarrage à froid. |
| Mot de passe administrateur (schéma fourni, utilisateur `admin`) | Changer après la première connexion | Élevé | Le compte est créé par le schéma amont, et non par ce module, et n'est pas aléatoire. |
| `enable_cloud_armor` / `enable_iap` | Activer pour la production | Moyen | La page de connexion du POS est publiquement accessible par défaut. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` / `enable_nfs` | `false` | Faible / coût | OpenSourcePOS n'utilise ni l'un ni l'autre ; leur activation provisionne des ressources que rien ne lit. |

---

Pour le comportement de la fondation référencé tout au long — identité de
service, mise à l'échelle et concurrence, entrée et équilibrage de charge,
CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en
miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à OpenSourcePOS est décrite dans
**[OpenSourcePOS_Common](OpenSourcePOS_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : OpenSourcePOS sur Cloud Run](../labs/OpenSourcePOS_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenSourcePOS Common — Configuration d'application partagée](OpenSourcePOS_Common.md) — la configuration de la couche application sur laquelle ce module s'appuie.
