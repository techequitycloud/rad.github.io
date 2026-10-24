---
title: "Matomo sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Matomo sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Matomo_CloudRun.md @ e69407af sha256:3d302a5a9c7a -->

# Matomo sur Google Cloud Run {#matomo-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Matomo_CloudRun.png" alt="Matomo sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Matomo est la principale plateforme d'analyse web open source — une alternative auto-hébergée à Google Analytics, axée sur la confidentialité, utilisée par plus d'un million de sites web. Ce module déploie Matomo sur **Cloud Run v2** en s'appuyant sur la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Matomo et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Matomo sur RAD, et comment cela se compare {#what-matomo-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Matomo sur RAD coûte environ 84 $ US par mois dans votre propre projet, sans frais par page vue.** RAD facture 75 crédits une fois par déploiement dans votre propre projet (67,5 crédits, soit 10 % de moins, dans un projet géré par RAD), plus le temps de build. Matomo se déploie également sur GKE Autopilot pour environ 110 $ US par mois — consultez le [guide GKE](Matomo_GKE.md) si vous avez besoin qu'il y soit exécuté à la place. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ce chiffre mensuel devient quelques dollars à la place — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96,00 $ US au prix de la recharge, moins avec un abonnement) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un abonnement mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 84 $ US** |

### Comment cela se compare {#how-it-compares}

- Le "Matomo Cloud" hébergé par Matomo propose des plans payants, mais son prix dépend d'un
  sélecteur de niveau de trafic sans chiffre fixe publié, de sorte qu'aucun chiffre unique ne peut être cité
  de manière fiable ici — consultez [matomo.org/pricing](https://matomo.org/pricing) pour votre propre volume de trafic
  avant de comparer.
- **Google Analytics est gratuit**, ce qui est la véritable alternative par laquelle la plupart des sites commencent. Le module
  Matomo de RAD coûte environ 84 $ US par mois dans votre propre projet, et l'argument en faveur
  de son paiement n'est pas le prix — c'est la possession à 100 % de vos données visiteurs, sans échantillonnage et sans
  partage de données avec Google, ce qui est important pour les sites sensibles au RGPD/CCPA.
- Comparaison auto-gérée : avec 1 vCPU / 2 Gio et une base de données MySQL,
  un droplet Hetzner CPX22 ou DigitalOcean 2 vCPU/4 Go (~24 $ US/mois) est dans la fourchette, plus vous exécutez
  MySQL, les sauvegardes et les mises à niveau vous-même.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Matomo s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va
bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour
presque rien.** Cela convient bien mieux à Matomo dont vous n'avez besoin qu'occasionnellement — évaluation, environnement de démonstration, charge de travail saisonnière ou intermittente — que de l'exécuter en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google
  de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve,
  récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il
  attend. Contrairement à la suppression d'un module, cela ne supprime pas la base de données, aucune VM ou la
  ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut
  le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis
  vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Parce que
  rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est
  une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Pour Matomo derrière Services_GCP (une petite VM NFS/cache, une base de données Mysql) et Project_GCP, c'est environ **une poignée de crédits (moins de 1 $ US)** au total, contre les environ 80 crédits (8,00 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 84 $ US.**
  Déployez Matomo, utilisez-le un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin,
  confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module
  une seule fois, les builds, et le temps réel où il était actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet dont RAD gère uniquement la facturation), et
  vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours
  dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des évaluations utilisent). Google
  indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont
  écrits dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud
  Storage, il est donc très probablement supprimé dès que vous supprimez le projet — même
  si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Matomo et
  que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet)
  avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la
fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le
déployer à nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau, plus les builds — environ
  80 crédits (8,00 $ US) au total. La suppression permet d'économiser de l'argent
  seulement si Matomo resterait inutilisé assez longtemps pour compenser ce coût de redéploiement
  par rapport à son propre coût d'exécution — environ **3 jours ou plus**, à la fois dans votre propre projet
  (environ 2,79 $ US par jour) et dans un projet géré par RAD (32 crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour Matomo, il s'agit de la base de données et de la VM de fichier/cache partagée. Elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont stockées dans un bucket à l'intérieur du déploiement et sont
  supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose
  de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne.
  Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le
  partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Matomo s'exécute en tant que conteneur PHP/Apache (l'image officielle `matomo:5-apache`) sur Cloud Run v2. Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache, 1 vCPU / 2 Gio par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — Matomo ne prend en charge que MySQL/MariaDB |
| Fichiers partagés | Filestore (NFS) | Persiste la racine de document Matomo `/var/www/html` (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `matomo-data` dédié provisionné automatiquement |
| Cache | Redis | Activé par défaut ; revient à l'adresse IP de l'hôte NFS si aucun hôte Redis n'est donné |
| Secrets | Secret Manager | Mot de passe de la base de données géré automatiquement |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut, équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** Matomo nécessite MySQL/MariaDB ; PostgreSQL n'est pas pris en charge.
- **L'image officielle pré-construite est déployée directement.** `container_image_source = "prebuilt"` signifie pas d'étape Cloud Build — l'image `matomo:<application_version>` est mise en miroir dans Artifact Registry (pour éviter les limites de débit de Docker Hub) et déployée telle quelle.
- **La connexion à la base de données est TCP sur le VPC, pas un socket.** `enable_cloudsql_volume = false` par défaut : la Fondation injecte l'IP privée de l'instance Cloud SQL en tant que `MATOMO_DATABASE_HOST`, et le client PHP de Matomo se connecte directement sur le réseau privé. Il n'y a pas de sidecar de socket Auth Proxy.
- **Les variables d'environnement `MATOMO_DATABASE_*` pré-remplissent l'installateur.** L'hôte, le nom d'utilisateur, le nom de la base de données et le mot de passe sont injectés par la Fondation ; `MATOMO_DATABASE_ADAPTER=mysql` et `MATOMO_DATABASE_TABLES_PREFIX=matomo_` sont définis par `Matomo_Common`.
- **NFS persiste la racine de document.** `nfs_mount_path` par défaut à `/var/www/html`, où Matomo conserve `config.ini.php`, les plugins installés et les actifs générés. Le point d'entrée de l'image peuple un volume vide à partir de `/usr/src/matomo` au premier démarrage.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et l'utilisateur MySQL de Matomo.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0` et `max_instance_count = 1` ; les démarrages à froid prennent 10 à 30 secondes. Définissez `min_instance_count = 1` pour une production toujours active.
- Le **mot de passe de la base de données** est généré automatiquement et stocké dans Secret Manager. Matomo n'a pas d'autres secrets d'application.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Matomo {#a-cloud-run--the-matomo-service}

Matomo s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Matomo stocke toutes les données d'analyse (visites, rapports, utilisateurs, configuration du site) dans une instance Cloud SQL pour MySQL 8.0 gérée. Le service se connecte via l'**IP privée** de l'instance à travers le VPC (pas d'IP publique, pas de socket proxy) : la Fondation injecte l'IP privée comme `MATOMO_DATABASE_HOST`. Lors du premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

La racine de document de Matomo `/var/www/html` — configuration (`config.ini.php`), plugins installés et ressources générées — est écrite dans un partage **Filestore (NFS)** monté dans le service afin qu'elle survive aux redémarrages et à la mise à l'échelle à partir de zéro. Un bucket **Cloud Storage** dédié (`matomo-data`) est également provisionné automatiquement. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<data-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Cache Redis {#d-redis-cache}

Redis prend en charge le cache d'objets de Matomo, réduisant la charge de la base de données et améliorant les temps de chargement des pages. Lorsqu'aucun hôte Redis externe n'est configuré et que NFS est activé, l'adresse IP de l'hôte NFS est utilisée comme point de terminaison Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe de la base de données est stocké dans Secret Manager et injecté dans le service au moment de l'exécution en tant que `MATOMO_DATABASE_PASSWORD` ; le texte en clair n'apparaît jamais dans la configuration. Matomo ne nécessite aucun autre secret d'application.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et de contrôle d'égression VPC contrôlent la connectivité. L'extrait de suivi que vous intégrez dans vos sites web pointe vers cette URL (ou votre domaine personnalisé).

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Matomo {#3-matomo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (image `mysql:8.0-debian`) se connecte à Cloud SQL — préférant le socket Unix Auth Proxy lorsqu'il est monté, revenant à une connexion TCP via l'IP privée — et crée de manière idempotente la base de données Matomo, crée l'utilisateur de l'application et accorde tous les privilèges. Il vérifie également que l'utilisateur de l'application peut se connecter, ce qui permet de détecter rapidement les problèmes d'authentification et de préchauffer le cache d'authentification `caching_sha2_password` de MySQL 8 afin que les connexions TCP ultérieures du client PHP utilisent le chemin d'authentification rapide. Le job s'exécute à chaque apply et peut être réexécuté en toute sécurité.
- **L'installateur web complète la configuration.** Le job `db-init` ne crée que la base de données *vide* ; la navigation vers l'URL du service pour la première fois lance l'installateur web de Matomo, dont l'écran de base de données est pré-rempli à partir des variables d'environnement `MATOMO_DATABASE_*` injectées. Vous y créez le compte superutilisateur et enregistrez votre premier site web suivi.
- **Persistance de la racine de document.** Au premier démarrage, le point d'entrée de l'image officielle copie l'application Matomo de `/usr/src/matomo` dans le volume NFS (vide) à `/var/www/html`. Tout état ultérieur — `config.ini.php`, plugins, actifs générés — persiste là-bas à travers les redémarrages et les mises à niveau de version.
- **La connexion à la base de données est en TCP simple.** Avec `enable_cloudsql_volume = false`, le client PHP MySQL de Matomo se connecte à l'IP privée de Cloud SQL via le VPC. Les variables d'environnement `MATOMO_DATABASE_ADAPTER=mysql` et `MATOMO_DATABASE_TABLES_PREFIX=matomo_` sont définies par `Matomo_Common`.
- **Archivage des rapports.** Par défaut, Matomo traite les rapports lors de la consultation de la page (archivage déclenché par le navigateur), ce qui convient aux trafics faibles à moyens et à la mise à l'échelle à zéro par défaut du module. Pour les sites à fort trafic, planifiez `console core:archive` via l'entrée `cron_jobs` afin que le traitement des rapports s'exécute en tant que job Cloud Run au lieu d'être intégré aux requêtes des visiteurs.
- **Chemin de santé.** Le démarrage utilise une sonde TCP (écoute de port) avec un seuil généreux de 20 échecs pour couvrir la copie de la racine de document au premier démarrage à partir de `/usr/src/matomo` ; la vivacité cible `/` sur HTTP, qui renvoie 200 — ou 302 à l'installateur lors d'un nouveau déploiement — une fois qu'Apache et PHP sont opérationnels.
- **Les variables de réglage PHP sont des arguments de build.** `php_memory_limit`, `upload_max_filesize` et `post_max_size` ne s'appliquent que lorsque `container_image_source = "custom"` (ce sont des arguments de build Docker) ; avec l'image pré-construite par défaut, ils n'ont aucun effet.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Matomo sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails autorisés à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `matomo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Matomo` | Nom convivial affiché dans la console. |
| `application_version` | `5-apache` | Tag de l'image Matomo — utilisez un tag de variante Apache ; incrémentez pour déployer une nouvelle révision. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | `512M` / `64M` / `64M` | Arguments de build de réglage PHP — efficaces uniquement avec `container_image_source = "custom"`. |

Toutes les autres entrées de ce groupe suivent le comportement standard de App_CloudRun.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image Matomo officielle ; `custom` construit via Cloud Build. |
| `container_image` | `""` | Laissez vide pour utiliser `matomo:<application_version>`. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU minimum pour Matomo. |
| `memory_limit` | `2Gi` | Mémoire par instance ; 2 Gio recommandés pour la génération de rapports. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro ; définissez `1` pour une production toujours active. |
| `max_instance_count` | `1` | Gardez à 1 sauf si NFS partagé + affinité de session sont confirmés comme étant sûrs pour plusieurs instances. |
| `container_port` | `80` | Matomo s'exécute sur Apache, qui écoute sur le port 80. |
| `enable_cloudsql_volume` | `false` | Matomo se connecte via IP privée TCP (`MATOMO_DATABASE_HOST`) — pas de socket proxy. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `enable_image_mirroring` | `true` | Mettez l'image en miroir dans Artifact Registry pour éviter les limites de débit de Docker Hub. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Remarque : IAP devant Matomo bloque également le point de terminaison de suivi public. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service. Les traqueurs sur les sites web publics nécessitent `all` (ou devant un équilibreur de charge). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Le trafic IP privée (y compris Cloud SQL) est acheminé via le VPC. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement supplémentaires en clair. `MATOMO_DATABASE_ADAPTER` et `MATOMO_DATABASE_TABLES_PREFIX` sont injectées automatiquement ; l'ensemble `MATOMO_DATABASE_HOST/USERNAME/DBNAME/PASSWORD` provient de la Fondation. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupes 8-10 — CI/CD, SQL personnalisé, Domaine et Cloud Armor {#groups-810--cicd-custom-sql-domain--cloud-armor}

Comportement standard de App_CloudRun — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `enable_cloud_deploy`, `enable_binary_authorization`, `enable_custom_sql_scripts`, `application_domains`, `enable_cdn`, `enable_cloud_armor`.

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour la racine de document Matomo. Nécessite gen2. |
| `nfs_mount_path` | `/var/www/html` | Racine de document de Matomo — la configuration, les plugins et les actifs persistent ici. |
| `create_cloud_storage` / `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets supplémentaires ; le bucket `matomo-data` est toujours provisionné automatiquement. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Matomo nécessite MySQL — ne pas changer pour PostgreSQL. |
| `db_name` | `matomo` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `matomo` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` | `false` | Rotation automatique du mot de passe de la base de données. |

Toutes les autres entrées suivent le comportement standard de App_CloudRun.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré (`mysql:8.0-debian`). |
| `cron_jobs` | `[]` | Jobs récurrents — l'emplacement naturel pour un `console core:archive` planifié sur les sites à fort trafic. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai initial de 30 s, période de 15 s, 20 échecs | Seuil généreux pour la copie de la racine de document au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai initial de 300 s, période de 60 s, 3 échecs | Matomo renvoie 200/302 sur `/` une fois que PHP et Apache sont opérationnels. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité de Cloud Monitoring — désactivée par défaut ; activez pour la production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis comme backend de cache d'objets de Matomo. |
| `redis_host` | `""` | Point de terminaison Redis. Laissez vide pour utiliser l'IP de l'hôte NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis optionnel (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Renvoyé lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

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
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `matomo-data`). |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence si erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | Matomo ne prend en charge que MySQL/MariaDB ; tout autre moteur bloque l'installateur. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données d'analyse. |
| `enable_nfs` | `true` | Critique | Sans la racine de document persistante, `config.ini.php` et les plugins sont perdus à chaque redémarrage — Matomo réentre dans l'installateur. |
| `nfs_mount_path` | `/var/www/html` | Critique | Le montage ailleurs laisse la racine de document sur un disque éphémère. |
| `container_port` | `80` | Critique | Apache écoute sur le port 80 ; une non-concordance échoue toutes les sondes de santé. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent gen2 ; gen1 ne peut pas monter Filestore. |
| `enable_cloudsql_volume` | `false` | Élevé | Matomo est câblé pour TCP via `MATOMO_DATABASE_HOST` (IP privée) — le passage au socket sans recâbler l'environnement hôte laisse l'installateur pointer vers un hôte inaccessible. |
| `application_version` | Tag de variante Apache (par exemple `5-apache`) | Élevé | Les variantes fpm/alpine n'ont pas Apache et ne servent pas HTTP sur le port 80. |
| `max_instance_count` | `1` | Élevé | Plusieurs instances sur la même racine de document NFS ne sont pas validées pour la sécurité de la session/configuration Matomo. |
| `memory_limit` | `2Gi` | Élevé | Trop peu de mémoire échoue la génération de rapports PHP et le traitement des archives. |
| `enable_redis` | `true` | Moyen | Sans cache d'objets, toutes les lectures de cache frappent MySQL, augmentant la charge. |
| `min_instance_count` | `0` (dev) / `1` (prod) | Moyen | `0` ajoute un démarrage à froid de 10 à 30 s pour la première page vue suivie après l'inactivité. |
| `cron_jobs` (core:archive) | défini pour le trafic élevé | Moyen | L'archivage déclenché par le navigateur ralentit les requêtes des visiteurs sur les sites occupés. |
| `enable_iap` | `false` pour les traqueurs publics | Moyen | IAP devant le service bloque le point de terminaison de suivi que vos sites web appellent. |
| `uptime_check_config.enabled` | `true` pour la production | Faible | Pas de signal de disponibilité externe ; les échecs ne remontent que via les rapports d'utilisateurs. |
| `php_memory_limit` etc. | valeurs par défaut | Faible | Arguments de build uniquement — silencieusement inertes avec l'image pré-construite par défaut. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Matomo partagée avec la variante GKE est décrite dans **[Matomo_Common](Matomo_Common.md)**.

<!-- related-guides -->

## Guides associées {#related-guides}

- [Lab pratique : Matomo sur Cloud Run](../labs/Matomo_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Matomo sur GKE Autopilot](Matomo_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Matomo Common — Configuration d'application partagée](Matomo_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Mautic sur Google Cloud Run](Mautic_CloudRun.md), [Listmonk sur Google Cloud Run](Listmonk_CloudRun.md), [Shlink sur Google Cloud Run](Shlink_CloudRun.md), [Mixpost sur Google Cloud Run](Mixpost_CloudRun.md) dans la solution **Marketing Automation Suite**.
