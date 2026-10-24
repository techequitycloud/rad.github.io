---
title: "OpenEMR sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'OpenEMR sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/OpenEMR_CloudRun.md @ e69407af sha256:5ceefb3269d7 -->

# OpenEMR sur Google Cloud Run {#openemr-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/OpenEMR_CloudRun.png" alt="OpenEMR sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

OpenEMR est le système de dossiers de santé électroniques (DSE) et de gestion de cabinet
open source le plus largement adopté au monde, utilisé par plus de 100 000
professionnels de la santé dans plus de 100 pays. Ce module déploie OpenEMR sur
**Cloud Run v2** sur la base de la fondation [App_CloudRun](App_CloudRun.md),
qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'OpenEMR utilise et sur la façon de les
explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour
les mécanismes communs à toutes les applications Cloud Run — identité de service,
ingestion et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du
déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md)
plutôt que de les répéter ici.

---

## Ce que coûte OpenEMR sur RAD, et comment cela se compare {#what-openemr-costs-on-rad-and-how-that-compares}

**Pour un petit cabinet, OpenEMR sur le module Cloud Run de RAD coûte environ 181 $ US par mois, sans licence par utilisateur.** Un fournisseur commercial de DSE facture généralement les mêmes fonctionnalités par prestataire par mois, avec l'implémentation et l'hébergement en sus. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 181 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 300 crédits (30 $ US au prix de la recharge) | 270 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Facturé à l'heure en crédits ; RAD publie **83 crédits par jour**, soit environ 2 490 crédits par mois (environ 249 $ US au prix de la recharge, 199 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum de crédits achetés est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2 vCPU / 4 GiB (alwaysOn) | 110,42 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 181 $ US** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ; la VM coûte environ 10 % de plus.
- **Ce module maintient au moins une instance en cours d'exécution par défaut** (`min_instance_count` est au moins 1), de sorte que la ligne Cloud Run ci-dessus ne se réduit pas entre les requêtes.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- **Aucun fournisseur SaaS OpenEMR commercial vérifié n'est nommé ici.** La plupart des offres OpenEMR hébergées sont de petits revendeurs régionaux sans liste de prix publique et actuelle, donc cette comparaison se fait par rapport à un serveur nu.
- Un VPS nu dimensionné près de l'empreinte propre d'OpenEMR de 2 vCPU / 4 GiB — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois — semble moins cher en espèces que les chiffres RAD ci-dessus.
- La différence réside dans ce qui est géré pour vous. Les données des patients se trouvent dans Cloud SQL avec des sauvegardes quotidiennes et sept jours de récupération ponctuelle ; les secrets vivent dans Secret Manager ; les journaux et la surveillance proviennent de Google Cloud. Sur un VPS nu, les sauvegardes, les correctifs du système d'exploitation, les mises à niveau de la base de données et la journalisation des accès sont votre propre travail.
- RAD n'est pas l'option la moins chère en termes d'argent — un VPS nu l'est généralement — mais pour un système de dossiers de santé, qui corrige le serveur et qui peut voir les sauvegardes n'est pas un détail à négliger.
- Si OpenEMR doit rester actif sans mise à l'échelle à zéro, ou fonctionner à côté d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](OpenEMR_GKE.md) — environ 150 $ US par mois dans votre propre projet, ou 3 360 crédits (environ 269 à 336 $ US) par mois dans un projet géré par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si OpenEMR s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième
option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du
projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux
à une utilisation occasionnelle — préparation d'une certification, environnement de
démonstration, activité saisonnière — qu'à l'exécution continue d'OpenEMR.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le
  projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la
  facturation est déjà déliée, rien n'est facturé pendant cette période d'attente.
  Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM
  ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête
  simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30
  jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  récupérer le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est
  revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les
  mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et
  une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une
  poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements,
  contre les 305 crédits (30,50 $ US) qu'un redéploiement complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 181 $
  US.** Déployez OpenEMR, utilisez-le pendant un certain temps, supprimez le projet.
  Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour,
  et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module
  qu'une seule fois, les builds, et le temps réel où OpenEMR était actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même
  dans les 30 jours — après cela, Google le supprime définitivement. La restauration
  est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit
  toujours dépasser le seuil du palier (100 crédits pour le palier sandbox qui convient
  à la plupart des utilisations d'étude et de démonstration). Google indique que la
  plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant
  une restauration.
- **Une lacune réelle : le bucket de sauvegarde ne survit pas.** Les sauvegardes
  d'OpenEMR sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est
  **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très
  probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
  lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à
  OpenEMR que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un
  bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de
  redéploiement ci-dessous. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne
s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la
fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 305 crédits (30,50 $ US), car RAD recrée le projet et les services partagés
  avant OpenEMR. La suppression ne permet d'économiser de l'argent que si OpenEMR
  devait rester inutilisé pendant environ 6 jours ou plus, à la fois dans votre propre
  projet (environ 6,03 $ US par jour) et dans un projet géré par RAD (83 crédits par
  jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et
  la VM de fichiers/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans
  le projet ne les utilise, donc la suppression d'OpenEMR alors que quelque chose
  d'autre partage le projet n'économise que la partie calcul propre à OpenEMR.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à
  l'intérieur du déploiement et sont supprimées avec celui-ci, donc copiez la dernière
  sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau
  les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google Cloud
  pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le
  formateur. Soit le formateur finance toutes les places, soit chaque participant paie
  la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés
  retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et
  règle directement avec le client. Si le portefeuille est faible, la facturation est
  suspendue et les données sont conservées, de sorte que personne ne reçoit de frais
  inattendus. À la fin, le partenaire transfère le projet et les déploiements
  deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS,
KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

OpenEMR s'exécute en tant que conteneur Apache/PHP 8.3 FPM sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Apache/PHP, 2 vCPU / 4 GiB par défaut, autoscaling basé sur les requêtes |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — OpenEMR ne prend pas en charge PostgreSQL |
| Documents patient | Filestore (NFS) | Répertoire `sites/` avec les documents patient, le cache de session et l'état de l'application partagés entre toutes les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket de données à usage général |
| Stockage de session | Redis | Activé par défaut ; revient à l'adresse IP du serveur NFS si aucun hôte Redis n'est spécifié |
| Secrets | Secret Manager | Mot de passe administrateur (`OE_PASS`) et mot de passe de base de données (`MYSQL_PASS`) générés automatiquement |
| Ingestion | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** La sélection de PostgreSQL ou `NONE` empêche le
  démarrage.
- **NFS est obligatoire et nécessite `gen2`.** Le répertoire `sites/` d'OpenEMR —
  contenant `sqlconf.php`, les documents patient, les caches Twig/Smarty et les fichiers
  téléchargés — doit se trouver sur un volume NFS partagé monté via l'environnement
  d'exécution Cloud Run gen2.
- **La sonde de démarrage est TCP, pas HTTP.** Le trafic de santé de Cloud Run arrive
  via HTTP simple. La pile Apache/PHP d'OpenEMR peut ne pas encore servir HTTP pendant
  la phase d'installation du premier démarrage, de sorte qu'une sonde HTTP expirerait.
  Une sonde TCP vérifie uniquement que le port est ouvert et permet à l'installateur de
  terminer.
- **L'installation au premier démarrage est automatisée et lente.** Lors du premier
  déploiement, deux jobs d'initialisation s'exécutent — `nfs-init` (configuration du
  répertoire NFS et restauration de sauvegarde facultative) et `db-init` (création
  d'utilisateur et de base de données MySQL) — après quoi le conteneur lui-même exécute
  `auto_configure.php` pour installer le schéma de la base de données. Cela peut prendre 5 à 20
  minutes.
- Le **mot de passe administrateur** d'OpenEMR est généré automatiquement et stocké
  dans Secret Manager ; vous ne le définissez jamais en texte clair.
- **`min_instance_count` est par défaut à 1.** La mise à l'échelle à zéro n'est pas recommandée pour
  les systèmes DSE cliniques — les démarrages à froid ajoutent une latence que les
  cliniciens peuvent interpréter comme une défaillance du système.
- **`max_instance_count` est par défaut à 1.** N'augmentez qu'après avoir confirmé que le partage de
  session Redis est opérationnel ; plusieurs instances sans Redis entraînent une perte
  de session PHP.
- **`cpu_always_allocated` est par défaut à `true`.** La configuration du premier démarrage d'OpenEMR
  (effacement du cache Twig, vérification de la base de données de la mise en page de
  la page de connexion et un passage de renforcement récursif des permissions de
  fichiers) est un travail de fond non lié à une seule requête entrante. Sous la
  facturation basée sur les requêtes (`false`), Cloud Run limite le CPU à près de zéro
  entre les requêtes, de sorte que cette configuration unique peut prendre de nombreuses
  minutes ou ne jamais se terminer — confirmé en direct : la séquence de démarrage
  identique est passée de bloquée à une page de connexion entièrement rendue en moins de
  15 secondes une fois que cela a été défini `true`. Ne passez à `false` qu'une fois
  que vous avez vérifié que l'instance a passé le premier démarrage.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont signalés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service OpenEMR {#a-cloud-run--the-openemr-service}

OpenEMR s'exécute en tant que service Cloud Run v2. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des
déploiements échelonnés. Le service nécessite l'**environnement d'exécution gen2**
pour la prise en charge des volumes NFS.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les
  journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

OpenEMR stocke toutes les données cliniques dans une instance Cloud SQL pour MySQL 8.0
gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket
Unix (pas d'IP publique). Lors du premier déploiement, le job Cloud Run `db-init` crée
la base de données et l'utilisateur de l'application ; le job `nfs-init` prépare le
répertoire NFS `sites/`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les
  flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se
trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour
le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Le répertoire `sites/` d'OpenEMR est écrit sur un partage **Filestore (NFS)** monté
dans le service à `/var/www/localhost/htdocs/openemr/sites`. Ce répertoire contient `sqlconf.php` (qui signale la fin de
l'installation), les documents téléchargés par les patients et les caches de modèles
Twig/Smarty. Toutes les instances doivent partager le même montage NFS. Un bucket
**Cloud Storage** à usage général est également provisionné.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  # Inspect the nfs-init job execution logs:
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Stockage de session Redis {#d-redis-session-store}

Redis prend en charge le stockage de session PHP d'OpenEMR. Lorsque `redis_host` est laissé
vide et que NFS est activé, l'instance Redis colocalisée du serveur NFS est utilisée
automatiquement. Dans les déploiements multi-instances, un stockage de session partagé
est requis pour éviter la perte de session.

- **Console :** Memorystore → Redis (si vous utilisez une instance Memorystore gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Le mot de passe administrateur d'OpenEMR (`OE_PASS`) et le mot de passe de la base de
données MySQL (`MYSQL_PASS`) sont stockés dans Secret Manager et injectés dans le service
au moment de l'exécution. Le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  # Retrieve the admin password to log in for the first time:
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```

L'ID secret du mot de passe administrateur est exposé en tant que sortie `admin_password_secret_id`. Voir
[App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingestion {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge
HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être
superposés. Les paramètres d'ingestion et de sortie VPC contrôlent le trafic vers/depuis
le service.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord /
  Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> \
    --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application OpenEMR {#3-openemr-application-behaviour}

- **Deux jobs d'initialisation s'exécutent à chaque déploiement.**

  | Job | Objectif | Image |
  |---|---|---|
  | `nfs-init` | Prépare la structure du répertoire NFS `sites/`, définit la propriété à l'UID 1000 (Apache) et restaure éventuellement une sauvegarde lorsque `backup_uri` est défini | `google-cloud-cli:alpine` |
  | `db-init` | Crée la base de données MySQL et l'utilisateur de l'application | `mysql:8.0-debian` |

  Inspectez les jobs et leurs exécutions :
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job nfs-init --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job db-init --project "$PROJECT" --region "$REGION"
  ```

- **L'installation du schéma au premier démarrage prend 5 à 20 minutes.** Une fois les
  jobs d'initialisation terminés, le conteneur de service exécute `auto_configure.php` pour
  installer le schéma de la base de données OpenEMR et créer le compte
  administrateur. Pendant cette phase, un serveur web PHP intégré temporaire sert HTTP
  200 sur le chemin de la sonde de démarrage, empêchant l'instance d'être tuée pendant
  l'exécution de l'installateur.

- **La sonde de démarrage est TCP.** La sonde de démarrage Cloud Run est par défaut TCP
  sur le port 80 pour éviter les fausses défaillances pendant la phase d'installation du
  premier démarrage lorsque Apache/PHP peut ne pas encore servir de réponses HTTP.

- **Mises à niveau tenant compte des versions.** Lors des déploiements ultérieurs, le
  script de démarrage compare la version de l'image à la version stockée sur NFS et
  exécute automatiquement les scripts de mise à niveau appropriés (`fsupgrade-N.sh`).

- **Connexion administrateur.** Le nom d'utilisateur administrateur initial est
  `admin`. Le mot de passe est généré automatiquement et stocké dans Secret Manager
  — récupérez-le avec :
  ```bash
  gcloud secrets versions access latest \
    --secret=<admin_password_secret_id> --project "$PROJECT"
  ```
  Si le compte administrateur est verrouillé après des tentatives de connexion
  échouées, utilisez l'utilitaire `/root/unlock_admin.sh <new_password>` depuis le conteneur en cours
  d'exécution.

- **Considérations HIPAA.** OpenEMR stocke des informations de santé protégées (PHI).
  Pour les déploiements réglementés par la HIPAA, activez `enable_iap` ou `enable_cloud_armor` pour
  restreindre l'accès, définissez `enable_audit_logging = true` et augmentez `backup_retention_days` à au moins 90.

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de
déploiement. Seuls les paramètres spécifiques ou notables pour OpenEMR sont listés ;
toute autre entrée est héritée de [App_CloudRun](App_CloudRun.md) avec son
comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `openemr` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `OpenEMR` | Nom convivial affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `7.0.4` | Tag de version de l'image OpenEMR ; incrémenter pour déployer une nouvelle version. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure sans déployer le conteneur. |
| `cpu_limit` | `2000m` | CPU par instance ; 2 vCPU recommandés pour les charges de travail cliniques concurrentes. |
| `memory_limit` | `4Gi` | Mémoire par instance ; 4 GiB recommandés. Moins de 2 GiB provoque des OOM kills sous charge clinique. |
| `cpu_always_allocated` | `true` | Allouer le CPU en permanence (facturation basée sur l'instance), pas seulement pendant les requêtes. La configuration de fond du premier démarrage d'OpenEMR (effacement du cache Twig, vérification de la disposition de la base de données, passage de renforcement des permissions) nécessite un CPU continu ; sous la facturation basée sur les requêtes (`false`), il se limite à près de zéro et peut rester bloqué pendant de nombreuses minutes ou ne jamais se terminer. |
| `min_instance_count` | `1` | Instances minimales. Garder ≥ 1 pour éviter les retards de démarrage à froid pour les utilisateurs cliniques. |
| `max_instance_count` | `1` | Augmenter uniquement après avoir confirmé que le partage de session Redis est opérationnel. |
| `container_port` | `80` | OpenEMR/Apache écoute sur le port 80. |
| `execution_environment` | `gen2` | **Doit rester `gen2`** pour la prise en charge du volume NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête. Augmenter pour la génération de rapports ou les téléchargements de fichiers volumineux. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Nombre d'anciennes révisions à conserver. |

### Groupe 5 — Contrôle d'accès et d'ingestion {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Réseaux pouvant atteindre le service. Utiliser `internal-and-cloud-load-balancing` pour les déploiements HIPAA avec un équilibreur de charge. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. Recommandé pour l'accès réservé au personnel clinique. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `MYSQL_*` et `OE_*` sont définies automatiquement. Ajouts courants : `PHP_MEMORY_LIMIT`, `SMTP_HOST`, `SMTP_PORT`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. Utiliser pour les valeurs sensibles telles que les identifiants SMTP. |
| `secret_propagation_delay` / `secret_rotation_period` | _(défini)_ | Attente de réplication / cadence de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). **Ne pas désactiver pour les déploiements réglementés par la HIPAA.** |
| `backup_retention_days` | `7` | Rétention ; augmenter à 30–90 pour la production/conformité. |
| `enable_backup_import` | `false` | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_source` | `gcs` | Source d'importation : `gcs` ou `gdrive`. |
| `backup_uri` | `""` | URI GCS (`gs://bucket/path`) ou ID de fichier Google Drive. Si défini, injecté dans `nfs-init` comme `BACKUP_FILEID`. |
| `backup_format` | `sql` | Format du fichier de sauvegarde : `sql`, `tar`, `gz`, `tgz`, `tar.gz` ou `zip`. |

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
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + Cloud Armor WAF. |
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge. |
| `admin_ip_ranges` | `[]` | CIDR autorisés à un accès privilégié. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | **Doit rester `true`.** OpenEMR nécessite NFS pour le répertoire `sites/`. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Chemin de montage. Doit correspondre au répertoire des sites OpenEMR. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Bucket de données / buckets supplémentaires / montages GCS Fuse. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixe — ne pas modifier. OpenEMR nécessite MySQL. |
| `db_name` | `openemr` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `openemr` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_name_env_var_name` / `db_user_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Noms de variables d'environnement supplémentaires sous lesquels les détails de connexion sont injectés. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la séquence intégrée `nfs-init` / `db-init`. |
| `cron_jobs` | `[]` | Jobs Cloud Run récurrents invoqués selon un calendrier. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | **TCP** sur le port 80, 12 échecs × 10s | Sonde de démarrage TCP. Évite les échecs de sonde HTTP pendant la phase d'installation du premier démarrage. |
| `liveness_probe` | HTTP `GET /interface/login/login.php`, 10 échecs × 30s | La page de connexion renvoie HTTP 200 uniquement lorsque la pile complète est opérationnelle. |
| `uptime_check_config` | désactivé | Vérification de disponibilité Cloud Monitoring. Activer explicitement une fois le service accessible. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Stockage de session Redis {#group-21--redis-session-store}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Utiliser Redis pour le stockage de session PHP. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS ; définir explicitement pour une instance Memorystore dédiée. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC. Nécessite que `organization_id` soit défini explicitement. Recommandé pour les environnements HIPAA. |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés (DATA_READ, DATA_WRITE). Recommandé pour la conformité HIPAA. |

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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `admin_password_secret_id` | ID secret Secret Manager pour le mot de passe administrateur OpenEMR (`OE_PASS`). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données (`MYSQL_PASS`). |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `nfs_server_ip` | IP interne du serveur NFS (sensible). |
| `nfs_instance_tags` | Tags réseau de l'instance NFS. |
| `nfs_mount_path` | Chemin de montage NFS à l'intérieur du conteneur. |
| `nfs_share_path` | Chemin de partage NFS sur le serveur. |
| `nfs_setup_job` | Nom du job de configuration NFS. |
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

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` | `true` | Critique | OpenEMR ne peut pas fonctionner sans NFS. Le répertoire `sites/`, `sqlconf.php`, et les documents des patients résident tous sur NFS. La désactivation entraîne un échec immédiat au démarrage. |
| `nfs_mount_path` | `/var/www/localhost/htdocs/openemr/sites` | Critique | Doit correspondre au chemin du répertoire des sites OpenEMR. Une non-concordance signifie que `nfs-init` prépare le mauvais emplacement et que le conteneur ne trouve jamais un `sqlconf.php` configuré. |
| `execution_environment` | `gen2` | Critique | `gen1` ne prend pas en charge les montages NFS ; le service ne démarre pas. |
| `database_type` | `MYSQL_8_0` | Critique | OpenEMR nécessite MySQL ; PostgreSQL ou `NONE` interrompt l'installateur et tous les appels de base de données PHP. |
| `db_name` / `db_user` | défini une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données des patients. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide échoue le job d'importation et peut corrompre le répertoire des sites NFS. |
| `backup_schedule` | `0 2 * * *` | Critique | La désactivation des sauvegardes pour un DSE contenant des informations de santé protégées (PHI) est une violation de la conformité HIPAA. |
| `startup_probe` | TCP (par défaut) | Élevé | Une sonde HTTP échoue pendant la phase d'installation du premier démarrage lorsque Apache n'a pas encore complètement démarré, ce qui entraîne le redémarrage du conteneur par Cloud Run avant la fin de la configuration. |
| `enable_redis` | `true` | Élevé | Plusieurs instances avec des stockages de sessions PHP isolés entraînent une perte de session et des échecs de connexion pour les utilisateurs cliniques. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Un hôte Redis inaccessible provoque des échecs de session PHP et empêche toutes les connexions. |
| `memory_limit` | ≥ `4Gi` | Élevé | La génération de PDF et les rapports de facturation d'OpenEMR sont gourmands en mémoire. Moins de 2 Gio entraîne des arrêts OOM en cours de requête. |
| `min_instance_count` | `1` | Élevé | La mise à l'échelle à zéro ajoute une latence de démarrage à froid et risque de manquer l'accès clinique. |
| `cpu_always_allocated` | `true` | Élevé | La configuration du premier démarrage d'OpenEMR (effacement du cache Twig, vérification de la disposition de la base de données, passage de durcissement des permissions) est un travail de fond, non lié à une requête. Avec la facturation basée sur les requêtes (`false`), le CPU est étranglé à presque zéro entre les requêtes, de sorte que le premier démarrage peut prendre de nombreuses minutes ou ne jamais se terminer — confirmé en direct : un démarrage identique est passé de bloqué à une page de connexion rendue en moins de 15 secondes une fois `true`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Les environnements réglementés par la HIPAA devraient conserver au moins 90 jours. |
| `enable_iap` / `enable_cloud_armor` | activer pour les soins de santé | Moyen | L'interface d'administration d'OpenEMR et les dossiers des patients sont accessibles publiquement sans ces contrôles. |
| `enable_audit_logging` | `true` pour HIPAA | Moyen | La HIPAA exige la journalisation d'audit de l'accès aux PHI. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization,
VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**.
La configuration d'application spécifique à OpenEMR partagée avec la variante GKE est décrite dans
**[OpenEMR_Common](OpenEMR_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : OpenEMR sur Cloud Run](../labs/OpenEMR_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [OpenEMR sur GKE Autopilot](OpenEMR_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [OpenEMR Common — Configuration d'application partagée](OpenEMR_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Docuseal sur Google Cloud Run](Docuseal_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Chatwoot sur Google Cloud Run](Chatwoot_CloudRun.md) dans la solution **Gestion de clinique et de cabinet**.
