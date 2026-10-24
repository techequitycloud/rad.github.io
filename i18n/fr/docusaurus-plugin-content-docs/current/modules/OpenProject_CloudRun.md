---
title: "OpenProject sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'OpenProject sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenProject_CloudRun.md @ e69407af sha256:7dc509ac860f -->

# OpenProject sur Google Cloud Run {#openproject-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenProject_CloudRun.png" alt="OpenProject sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenProject est une suite de gestion de projet et de collaboration d'équipe open source, sous licence GPLv3, qui comprend des lots de travaux, des diagrammes de Gantt, des tableaux agiles, des wikis, le suivi du temps et des budgets. Ce module déploie OpenProject sur **Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'OpenProject utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à toutes les applications Cloud Run — identité de service, entrée et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte OpenProject sur RAD, et comment cela se compare {#what-openproject-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, OpenProject sur le module Cloud Run de RAD coûte environ 181 $ US par mois, sans licence par utilisateur.** L'édition Cloud hébergée d'OpenProject n'a pas de plan adapté à une équipe de dix personnes (voir ci-dessous) ; un serveur auto-géré est moins cher en espèces, mais vous devez alors gérer la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau vous-même. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 181 $ US deviennent quelques dollars par mois. Voir **Mettre en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **83 crédits par jour**, soit environ 2 490 crédits par mois (environ 249 $ US au prix de la recharge, 199 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 Gio (alwaysOn) | 110,42 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 181 $ US** |

- Cloud SQL et Cloud Run coûtent le même prix à africa-south1 (Johannesburg) ; la VM coûte environ 10 % de plus.
- **Ce module maintient au moins une instance en cours d'exécution par défaut** (`min_instance_count` est au moins 1), de sorte que la ligne Cloud Run ci-dessus ne se réduit pas entre les requêtes.
- **Évitez Filestore pour un petit déploiement.** Le module utilise une petite VM NFS/cache par défaut. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- **L'édition Cloud hébergée d'OpenProject n'a pas de prix clair pour dix utilisateurs.** Chaque plan payant (à partir de 5,95 €/utilisateur/mois) exige un minimum de 25 utilisateurs (openproject.org/pricing, 8 octobre 2026) ; le seul plan qui convient réellement à une équipe de dix personnes est le plan communautaire gratuit — la même édition que RAD déploie.
- Un VPS nu dimensionné près de l'empreinte 2 vCPU / 4 Gio d'OpenProject — Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go Droplet, tous deux à environ 24 $ US/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $ US/mois — est moins cher en espèces que les chiffres RAD ci-dessus.
- La différence est le temps d'administration : les sauvegardes Cloud SQL et la récupération ponctuelle, Secret Manager et la surveillance Google Cloud sont inclus sur RAD. Sur un VPS nu, PostgreSQL, les sauvegardes, les correctifs et les mises à niveau sont votre travail.
- Si OpenProject doit rester opérationnel sans mise à l'échelle à zéro, ou fonctionner à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](OpenProject_GKE.md) — environ 150 $ US par mois dans votre propre projet, ou 3 330 crédits (environ 266 à 333 $ US) par mois dans un projet géré par RAD.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenProject s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer l'ensemble du projet et le restaurer dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation d'une certification, environnement de démonstration, activité saisonnière — que l'exécution continue d'OpenProject.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les 305 crédits (30,50 $ US) que coûte un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 181 $ US.** Déployez OpenProject, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds et le temps pendant lequel OpenProject était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes d'OpenProject sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à OpenProject que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 305 crédits (30,50 $ US), car RAD recrée le projet et les services partagés avant OpenProject. La suppression ne permet d'économiser de l'argent que si OpenProject resterait inutilisé pendant environ 6 jours ou plus, à la fois dans votre propre projet (environ 6,03 $ US par jour) et dans un projet géré par RAD (83 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichiers/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, de sorte que la suppression d'OpenProject pendant que quelque chose d'autre partage le projet n'économise que la partie calcul d'OpenProject.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; [Tarification OpenProject](https://www.openproject.org/pricing/).

---

## 1. Vue d'ensemble {#1-overview}

OpenProject s'exécute en tant que conteneur Ruby on Rails (Puma) sur Cloud Run v2. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Rails/Puma, 2 vCPU / 4 Gio par défaut, CPU toujours alloué |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — OpenProject ne prend pas en charge MySQL ou d'autres moteurs |
| Stockage des pièces jointes | Cloud Filestore (NFS) | Stockage durable des pièces jointes des lots de travaux, monté à `/opt/openproject/storage` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Tâches en arrière-plan | good_job (intégré, sur PostgreSQL) | Pas de Redis — la file d'attente des tâches réside dans PostgreSQL |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la couche d'application partagée ; la sélection de tout autre moteur interrompt le démarrage.
- **Connexion TCP à la base de données par IP privée.** `enable_cloudsql_volume = false` sur Cloud Run. OpenProject (Rails) lit une seule URL sous forme `DATABASE_URL`, et l'analyseur `URI` de Ruby ne peut pas contenir le répertoire de socket Unix de Cloud SQL (ses deux-points interrompent l'analyse de l'URL), de sorte que le point d'entrée se connecte via l'IP privée de l'instance avec `sslmode=require`.
- **Pas de Redis.** Les tâches en arrière-plan s'exécutent via `good_job` avec la file d'attente dans PostgreSQL (`GOOD_JOB_EXECUTION_MODE = async`) ; `enable_redis` est transféré en tant que `false`.
- **`SECRET_KEY_BASE` est généré automatiquement** et stocké dans Secret Manager. Il ne doit jamais être renouvelé après le premier démarrage — le renouveler rend toutes les sessions existantes et toutes les colonnes de base de données chiffrées illisibles.
- **Le CPU est toujours alloué** (`cpu_always_allocated = true`, `min_instance_count = 1`) car le worker `good_job` intégré et le planificateur cron doivent continuer à fonctionner sans requête entrante. Cela annule la mise à l'échelle à zéro par conception ; voir le tableau des pièges pour le retour en arrière axé sur les coûts.
- **Les migrations s'exécutent dans un job `db-migrate`, pas au démarrage.** Le service s'exécute en mode web uniquement (`./docker/prod/web`) ; un job dédié au moment de l'application exécute `rake db:migrate db:seed` en premier, de sorte que le conteneur web démarre rapidement avec un schéma migré.
- **Les sondes de santé sont TCP / désactivées.** L'autorisation d'hôte Rails 8 `400` toute sonde HTTP dont l'en-tête `Host` est l'IP du pod, de sorte que la sonde de démarrage est TCP et la sonde de vivacité est désactivée.
- **La première connexion est `admin` / `admin`.** OpenProject force un changement de mot de passe lors de la première connexion — faites-le immédiatement.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenProject {#a-cloud-run--the-openproject-service}

OpenProject s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la charge des requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

OpenProject stocke toutes les données d'application (projets, lots de travaux, wikis, utilisateurs, métadonnées des pièces jointes) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Sur Cloud Run, le service se connecte via l'**IP privée de l'instance avec `sslmode=require`** (pas le socket du proxy d'authentification — l'analyseur DSN d'URL de Ruby ne peut pas contenir le répertoire du socket). Lors du premier déploiement, le job `db-init` crée la base de données et l'utilisateur, et le job `db-migrate` exécute `rake db:migrate db:seed` pour construire le schéma et initialiser le compte administrateur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (stockage NFS des pièces jointes) {#c-cloud-filestore-nfs-attachment-storage}

Les pièces jointes des lots de travaux sont stockées sur un partage NFS **Cloud Filestore** monté à `/opt/openproject/storage` (`enable_nfs = true` par défaut) ; le module pointe OpenProject vers celui-ci en définissant `OPENPROJECT_ATTACHMENTS__STORAGE__PATH` sur `nfs_mount_path` chaque fois que NFS est activé. Sans cela, les pièces jointes atterrissent sur le disque éphémère du conteneur et sont perdues à chaque révision/redéploiement.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Pour utiliser un stockage d'objets compatible GCS à la place, définissez les variables d'environnement `OPENPROJECT_FOG_*`. Voir [App_CloudRun](App_CloudRun.md) pour le modèle de serveur NFS.

### D. Secret Manager {#d-secret-manager}

Un secret cryptographique est généré automatiquement et stocké dans Secret Manager : `SECRET_KEY_BASE` (signature de session/cookie Rails et dérivation de clé de colonne chiffrée). Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~secret-key-base"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et entrée {#e-networking--ingress}

Le service est accessible à son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'entrée et le contrôle de sortie VPC contrôlent la connectivité. OpenProject construit des URL absolues à partir de `OPENPROJECT_HOST__NAME` (défini par le point d'entrée) et `OPENPROJECT_HTTPS = true`.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenProject {#3-openproject-application-behaviour}

- **Configuration de la base de données en deux phases lors du premier déploiement.** Le job `db-init` (`postgres:15-alpine`) crée le rôle et la base de données ; le job `db-migrate` exécute ensuite l'image de l'application avec `rake db:migrate db:seed`. Le job de migration supprime toutes les tables partielles d'une tentative précédente interrompue (`DROP OWNED BY CURRENT_USER CASCADE`) avant la migration, et crée l'extension `pg_trgm` nécessaire aux index trigrammes d'OpenProject. Les deux jobs s'exécutent au moment de l'application.
- **Les migrations ne s'exécutent pas au démarrage.** Le service s'exécute en mode web uniquement (`./docker/prod/web`), ce qui ignore le seeder tout-en-un. Rails (production) refuse de démarrer Puma tant que des migrations sont en attente, donc si `db-migrate` échoue, la création du service échoue bruyamment — il n'y a pas de livraison silencieuse de base de données vide.
- **`SECRET_KEY_BASE` est immuable après le premier démarrage.** Il est généré une fois et stocké dans Secret Manager. Le modifier rend les sessions existantes et toutes les colonnes chiffrées illisibles. Ne le faites pivoter que pendant une fenêtre de maintenance planifiée avec un plan de rechiffrement complet des données.
- **Les tâches en arrière-plan s'exécutent en interne.** `good_job` exécute son worker et son cron à l'intérieur du conteneur web (`GOOD_JOB_EXECUTION_MODE = async`) avec la file d'attente sur PostgreSQL — pas de Redis. C'est pourquoi le CPU est toujours alloué par défaut.
- **L'autorisation d'hôte gère les sondes de santé.** Rails 8 renvoie `400 Invalid host_name` à toute requête dont l'en-tête `Host` n'est pas `OPENPROJECT_HOST__NAME`, y compris les sondes de santé HTTP (qui utilisent l'IP du pod). La sonde de démarrage est donc TCP et la sonde de vivacité est désactivée ; la sonde de disponibilité atteint `/health_checks/default` où la plateforme définit correctement `Host`.
- **La première connexion est `admin` / `admin`.** Initialisée par `rake db:seed`. OpenProject force un changement de mot de passe lors de la première connexion.
- **Inspecter l'exécution des tâches :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour OpenProject sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail autorisées à accéder au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openproject` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenProject` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Tag d'image OpenProject (`OPENPROJECT_VERSION`). `latest` est épinglé à la version majeure stable `16` ; OpenProject ne publie que des tags majeurs numériques. |
| `db_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openproject` | Utilisateur de la base de données de l'application. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Rails a besoin de marge pour les migrations et les workers. |
| `cpu_always_allocated` | `true` | Maintient le CPU alloué afin que le worker `good_job` intégré + cron s'exécutent sans requêtes entrantes. |
| `min_instance_count` | `1` | Maintient une instance chaude pour les tâches en arrière-plan. |
| `max_instance_count` | `5` | Limite supérieure de l'autoscaling. |
| `container_port` | `8080` | Port de liaison par défaut de Puma ; le module exécute `./docker/prod/web` (Puma directement), contournant le proxy Apache de l'image tout-en-un sur le port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Désactivé sur Cloud Run** — OpenProject se connecte via TCP IP privée. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image OpenProject dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Entrée publique pour l'accès au navigateur et à l'API. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant OpenProject. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires (par exemple, les remplacements `OPENPROJECT_*`). Ne définissez pas `SECRET_KEY_BASE` ou `DATABASE_URL` ici — ils sont gérés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS provisionnés par défaut ; en ajouter d'autres pour des besoins personnalisés. |
| `enable_nfs` | `true` | Cloud Filestore pour le stockage durable des pièces jointes. |
| `nfs_mount_path` | `/opt/openproject/storage` | Chemin des pièces jointes OpenProject à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `openproject` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `openproject` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Tâches et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser les tâches `db-init` + `db-migrate` intégrées. |
| `cron_jobs` | `[]` | Cloud Scheduler + Cloud Run Jobs facultatifs (par exemple, un point de terminaison cron externe si vous passez au démarrage à froid). |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP**, délai de 30s, fenêtre de 30 × 15s | TCP car l'autorisation d'hôte Rails `400` les sondes HTTP ; vérifie que Puma écoute. |
| `liveness_probe` | **désactivé** | Cloud Run n'a pas de sonde de vivacité TCP ; une sonde HTTP redémarrerait en boucle un conteneur sain. |
| `startup_probe_config` | HTTP `/`, activé, délai de 60s, failure_threshold 30 | Sonde structurée au niveau App_CloudRun (parallèle à `startup_probe`, qui est ce qui gère réellement le conteneur). |
| `health_check_config` | HTTP `/`, activé, délai de 60s, failure_threshold 3 | Sonde de vivacité structurée au niveau App_CloudRun (parallèle à `liveness_probe`, qui est désactivée sur le conteneur). |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring ; activer pour la surveillance de production. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `initialization_jobs` | Noms des tâches de configuration (`db-init`, `db-migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de fondation [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `database_type` qui ne correspond pas à une extension activée, un `backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'application ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter rend toutes les sessions existantes et toutes les colonnes de base de données chiffrées illisibles. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_nfs` | `true` | Critique | Le désactiver place les pièces jointes sur un disque éphémère — elles sont perdues à chaque révision/redéploiement. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer la tâche d'importation. |
| `enable_cloudsql_volume` | `false` sur Cloud Run | Élevé | L'activation du socket rend le DSN d'URL Rails impossible à analyser (les deux-points du socket rompent l'URL) ; l'application ne parvient pas à se connecter. |
| `startup_probe.type` | `TCP` | Élevé | Une sonde de démarrage HTTP atteint l'autorisation d'hôte Rails (`400 Invalid host_name`) et ne passe jamais — la révision ne devient jamais prête même si Puma est sain. |
| `liveness_probe.enabled` | `false` | Élevé | Une sonde de vivacité HTTP `400` sur l'autorisation d'hôte et redémarre en boucle un conteneur sain. |
| `memory_limit` | `4Gi` | Élevé | Les migrations et les workers intégrés OOM en dessous de ~2 Gio. |
| `cpu_always_allocated` | `true` | Moyen | La définition de `false` limite le worker/cron `good_job` à ~0 entre les requêtes — les e-mails/notifications en arrière-plan stagnent. Retour en arrière uniquement avec un point de terminaison cron Cloud Scheduler externe. |
| `application_version` | Épingler une version majeure (`16`) | Moyen | `latest` n'a pas de tag d'image sur Docker Hub ; le module l'épingle à `16`. Épingler explicitement pour contrôler les mises à niveau. |
| `min_instance_count` | `1` | Moyen | Définir `0` uniquement avec `cpu_always_allocated = false` et un cron externe — sinon les tâches en arrière-plan s'arrêtent entre les requêtes. |
| `enable_iap` | selon les besoins | Moyen | IAP bloque tout accès non authentifié, y compris l'API ; activer uniquement lorsque cela est prévu. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de la fondation référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à OpenProject partagée avec la variante GKE est décrite dans **[OpenProject_Common](OpenProject_Common.md)**.

<!-- related-guides -->

## Guides connexes {#related-guides}

- [Lab pratique : OpenProject sur Cloud Run](../labs/OpenProject_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenProject sur GKE Autopilot](OpenProject_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [OpenProject Common — Configuration d'application partagée](OpenProject_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Documenso sur Google Cloud Run](Documenso_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
