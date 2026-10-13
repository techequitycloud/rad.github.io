---
title: "NetBox sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de NetBox sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Netbox_CloudRun.md @ e69407af sha256:d7e90e5673c7 -->

# NetBox sur Google Cloud Run {#netbox-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Netbox_CloudRun.png" alt="NetBox sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

NetBox est la « source de vérité » open source standard de l'industrie pour les
équipes d'ingénierie réseau — gestion des adresses IP (IPAM), inventaire des
appareils et des racks, câblage et topologie réseau, le tout modélisé sous
forme de données structurées derrière une API REST/GraphQL complète. Ce module
déploie NetBox sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par NetBox et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, entrée et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Netbox sur RAD, et comment cela se compare {#what-netbox-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Netbox sur RAD coûte environ 99 $ US par mois, les frais de module étant facturés une fois en crédits RAD.** Si vous avez besoin que Netbox reste opérationnel en continu, qu'il s'adapte à plusieurs pods ou qu'il fonctionne aux côtés d'autres charges de travail Kubernetes, consultez le [guide GKE](Netbox_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits (moins de 1 $ US) au lieu de payer pour qu'il reste inactif. Voir **Mettez-le en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Netbox**, qui est open source, il n'y a donc pas de frais de licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 3-6 crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **99 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 Gio (scaleToZero) | 28,37 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 99 $ US** |

### Comment cela se compare {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Netbox lui-même**, donc la comparaison honnête est un serveur autogéré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Aucune offre SaaS gérée pour ce projet open source exact n'a pu être vérifiée avec un prix actuel et publié, donc aucun chiffre n'est donné ici. Pour la documentation d'infrastructure et l'IPAM, le choix réaliste pour la plupart des équipes est l'auto-hébergement (NetBox est déjà gratuit et open source) contre le paiement du temps d'un ingénieur pour maintenir cette copie auto-hébergée patchée et sauvegardée, ce qui est le fossé que comblent Cloud SQL géré et l'automatisation de RAD.
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est aussi vous qui patcher l'OS, faire tourner les sauvegardes et maintenir la base de données (le cas échéant) en bonne santé. Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent cela pour vous, ce qui est le véritable argument en faveur de RAD par rapport à une boîte moins chère — pas le prix affiché.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Netbox s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien
au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque
rien.** Cela convient bien mieux à Netbox dont vous n'avez besoin qu'occasionnellement — une démo, une évaluation, un projet
saisonnier — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de
  supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable,
  pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement
  à la suppression d'un module, cela ne détruit pas la base de données, la VM ou la ressource de calcul
  une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte quelques crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer.
  RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande de
  lancer **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été
  détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une
  reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte environ une poignée de crédits (moins de 1 $ US) au
  total pour une chaîne de déploiement typique de 2-3.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 99 $ US.** Déployez Netbox, utilisez-le
  pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et
  supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez qu'une seule fois les frais de module, les builds et le temps
  pendant lequel Netbox était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation),
  et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser
  le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démo conviennent). Google indique que la plupart
  des services sont entièrement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du
  projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable
  qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30
  jours. Si vous avez personnalisé Netbox et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive,
  ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours
passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous
en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115
  crédits (11,50 $ US) dans votre propre projet, ou 104
  crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Netbox resterait inutilisé pendant
  environ 3 jours ou plus dans votre propre projet (environ 3,29 $ US par
  jour), ou environ 3 jours ou plus dans un projet géré par RAD (32 crédits par
  jour).
- **La majeure partie du coût de fonctionnement est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que
  lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Netbox alors que quelque chose d'autre partage le
  projet ne sauve que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées
  avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant
  obtient Netbox dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie
  la sienne. Tout est supprimé à la fin de la session et les crédits non utilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Netbox pour un client à partir d'un
  portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par
  carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

NetBox s'exécute en tant que conteneur Python/Django personnalisé sur Cloud Run
v2, enveloppant l'image officielle `netboxcommunity/netbox` avec un
processus `rqworker --with-scheduler` d'arrière-plan colocalisé. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Image personnalisée, 2 vCPU / 2 Gio par défaut, autoscaling sans serveur ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — NetBox ne prend pas en charge MySQL ou SQLite en production |
| Stockage d'objets | Cloud Storage (GCS Fuse) | Un bucket `media` monté à `/etc/netbox/media`, le véritable `MEDIA_ROOT` de NetBox |
| Cache et file d'attente | Redis (obligatoire) | File d'attente de tâches (`REDIS_DATABASE=0`) et cache (`REDIS_CACHE_DATABASE=1`) sur des bases de données logiques distinctes ; par défaut, l'adresse IP du serveur NFS |
| Secrets | Secret Manager | `SECRET_KEY` et `SUPERUSER_PASSWORD` générés automatiquement ; mot de passe de la base de données |
| Entrée | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Le moteur de base de données est fixé par la
  couche d'application partagée ; NetBox ne prend pas en charge MySQL ou SQLite
  pour une utilisation en production.
- **Redis est obligatoire, pas facultatif.** NetBox utilise Redis comme
  intermédiaire pour son système de tâches d'arrière-plan RQ (Redis Queue) —
  webhooks, scripts personnalisés, rapports et jobs planifiés/système — et
  comme backend de cache. Ce sont **deux bases de données Redis logiques
  distinctes** (`REDIS_DATABASE=0`, `REDIS_CACHE_DATABASE=1`) ; la
  propre documentation de NetBox avertit que le partage d'un seul numéro de
  base de données risque de perdre les tâches d'arrière-plan en file d'attente
  lors d'un vidage de cache.
- **Un worker d'arrière-plan est colocalisé dans le même conteneur.** L'image
  exécute `manage.py rqworker --with-scheduler` en tant que processus
  d'arrière-plan à côté du serveur web Granian. Sans cela, les tâches
  d'arrière-plan sont mises en file d'attente silencieusement et ne
  s'exécutent jamais — il n'y a pas d'erreur distincte.
- **Les téléchargements de médias sont montés au véritable `MEDIA_ROOT` de
  NetBox.** `/etc/netbox/media`, pas le plus évident
  `/opt/netbox/netbox/media` — confirmé en direct via
  `manage.py shell`. Une erreur de chemin ne provoque pas d'erreur ; les
  téléchargements ne persistent tout simplement jamais dans GCS (voir §4 pour
  l'histoire complète).
- **Démarrage à froid axé sur les coûts par défaut**
  (`cpu_always_allocated = false`, `min_instance_count = 0`). **Compromis :** le
  worker RQ ne s'exécute que tant qu'une requête maintient l'instance chaude —
  les tâches d'arrière-plan sont mises en file d'attente et traitées lors de
  la prochaine requête au lieu de s'exécuter immédiatement. Définissez
  `cpu_always_allocated = true` et `min_instance_count >= 1` ensemble pour
  restaurer le traitement continu.
- **Le conteneur s'exécute en tant que root** (uid 0 / gid 0) — l'image
  officielle `netboxcommunity/netbox` ne définit pas
  `USER`. C'est intentionnel et correspond à l'amont ; le
  montage GCS Fuse est épinglé à `uid=0`/`gid=0` en
  conséquence.
- **`SECRET_KEY` et `SUPERUSER_PASSWORD` sont générés
  automatiquement** et stockés dans Secret Manager. `SECRET_KEY` doit
  comporter au moins 50 caractères (NetBox l'impose) ; il est généré à 64.
- **Les vérifications de santé utilisent `/login/`, pas
  `/api/status/`.** La page de connexion est publique et non authentifiée ;
  l'API de statut nécessite une authentification et échouerait à chaque sonde.
- **`ALLOWED_HOSTS = "*"` et `CORS_ORIGIN_ALLOW_ALL = "true"` sont ouverts par
  défaut** pour un premier déploiement sans intervention — resserrez via
  `environment_variables` avant d'exposer une instance de production à
  Internet.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms des services et des ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service NetBox {#a-cloud-run--the-netbox-service}

NetBox s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et
  les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

NetBox stocke toutes les données d'inventaire et d'IPAM (appareils, racks,
adresses IP, préfixes, VLAN, circuits, utilisateurs) dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le
**proxy d'authentification Cloud SQL** sur un socket Unix ; aucune IP
publique n'est exposée. Lors du premier déploiement, un job
d'initialisation crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le
modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage (magasin de médias GCS Fuse) {#c-cloud-storage-gcs-fuse-media-store}

Un bucket `media` dédié est provisionné automatiquement et monté à
`/etc/netbox/media` — le véritable `MEDIA_ROOT` de NetBox — pour les images
d'appareils/racks téléchargées et les pièces jointes.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<media-bucket>/          # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Redis (file d'attente de tâches et cache) {#d-redis-task-queue-and-cache}

Redis est **obligatoire** (`enable_redis = true` par défaut). Lorsque
`redis_host` est laissé vide et `enable_nfs` est vrai, l'IP de la VM du
serveur NFS est utilisée comme point de terminaison Redis. NetBox répartit son
utilisation sur deux bases de données logiques — `REDIS_DATABASE=0` pour la file
d'attente de tâches RQ, `REDIS_CACHE_DATABASE=1` pour le cache.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> -n 0 llen rq:queue:default   # inspect the RQ default queue depth
  # Confirm the resolved Redis host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Deux secrets cryptographiques sont générés automatiquement et stockés dans
Secret Manager : `SECRET_KEY` (secret cryptographique Django utilisé pour
les sessions, le CSRF et les cookies signés) et `SUPERUSER_PASSWORD` (le mot de
passe du compte administrateur initial). Le mot de passe de la base de données
est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et entrée {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être superposés ; les paramètres d'entrée et de sortie VPC contrôlent
la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneur sont envoyés à Cloud Logging ; les métriques Cloud Run
et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application NetBox {#3-netbox-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job
  d'initialisation exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via le proxy d'authentification Cloud SQL
  et crée de manière idempotente la base de données et l'utilisateur de
  l'application, puis accorde les privilèges. Le job peut être réexécuté en
  toute sécurité.
- **Migrations de base de données au démarrage.** `docker-entrypoint.sh true` exécute
  la propre séquence de premier démarrage de NetBox de manière synchrone à
  chaque démarrage de conteneur — une attente de disponibilité de la base de
  données, `migrate --no-input`, un nettoyage des types de contenu obsolètes, un
  nettoyage de session et une réindexation paresseuse de l'index de recherche
  — avant le démarrage du serveur web et du worker RQ. C'est idempotent ; une
  opération nulle lorsqu'il n'y a rien de nouveau à migrer.
- **Le bootstrap du superutilisateur est idempotent.** Le compte
  administrateur initial (`admin_user`/`admin_email`, mot de passe de
  Secret Manager) est créé à partir des variables d'environnement
  `SUPERUSER_*` au premier démarrage ; la création est ignorée — ce n'est
  pas une erreur — si un utilisateur portant ce nom existe déjà, elle est donc
  sûre à chaque redémarrage.
- **Les téléchargements de médias persistent dans le véritable
  `MEDIA_ROOT`.** Le véritable `MEDIA_ROOT` de NetBox est
  `/etc/netbox/media` (confirmé en direct via `manage.py shell`),
  où le volume `media` GCS Fuse est monté. Une révision
  antérieure de ce module montait le plus évident `/opt/netbox/netbox/media` à la
  place — un chemin NetBox réel et inexistant — ce qui entraînait l'écriture
  des téléchargements dans le système de fichiers éphémère du conteneur : ils
  étaient lisibles immédiatement (même système de fichiers local, donc
  l'aller-retour « fonctionnait »), mais n'atteignaient jamais GCS et étaient
  perdus à chaque redémarrage du conteneur, sur **à la fois** Cloud Run et GKE
  identiquement. Cela a été corrigé en corrigeant le chemin de montage, vérifié
  en direct avec `gcloud storage ls` montrant le fichier de test téléchargé
  avec la taille en octets, le type de contenu et l'horodatage corrects dans
  les 5 secondes suivant le téléchargement. **Leçon :** cela ressemblait
  exactement à une limitation de stockage spécifique à Cloud Run jusqu'à ce
  qu'elle soit tracée avec un accès shell réel — c'était un bug de chemin de
  montage Terraform banal affectant les deux plateformes identiquement, pas un
  manque de plateforme.
- **`CSRF_TRUSTED_ORIGINS` reflète l'URL réelle du service.** Calculé à partir
  de `module.deployment_id.service_name` et du numéro de projet — pas le
  préfixe de ressource réservé au locataire, qui construirait une URL pour un
  service qui n'existe pas et rejetterait chaque POST authentifié (y compris
  la connexion) avec une erreur CSRF. Vérifiez la valeur déployée :
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(status.url)'
  ```
- **Le worker RQ traite les tâches d'arrière-plan.** Les webhooks, les scripts
  personnalisés, les rapports et les jobs planifiés/système sont exécutés par
  `manage.py rqworker
  --with-scheduler`, colocalisé dans le même conteneur que le serveur web.
  Avec la valeur par défaut de démarrage à froid axée sur les coûts, ce worker
  ne s'exécute que tant qu'une instance est chaude ; activez
  `cpu_always_allocated = true` + `min_instance_count >= 1` pour un traitement
  continu des tâches d'arrière-plan.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent
  `/login/` — la page de connexion publique et non authentifiée de
  NetBox. `/api/status/` nécessite une authentification et échouerait à
  chaque sonde.
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
NetBox sont listés ; toutes les autres entrées sont héritées de
[App_CloudRun](App_CloudRun.md) avec leur comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
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
| `application_name` | `netbox` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `NetBox - Network Documentation & IPAM` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `latest` | Étiquette de version de l'image du conteneur, transmise à l'ARG de build `APPLICATION_VERSION` du Dockerfile. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `2000m` | CPU par instance ; partagé par le serveur web et le worker RQ. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum 1 Gio. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; le worker RQ ne s'exécute que tant qu'une instance est chaude. |
| `max_instance_count` | `3` | Limite supérieure de l'autoscaling. |
| `cpu_always_allocated` | `false` | `true` + `min_instance_count >= 1` restaure le traitement continu des tâches d'arrière-plan. |
| `container_port` | `8080` | Le serveur Granian (WSGI) de NetBox écoute sur le port 8080. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `true` | Proxy d'authentification Cloud SQL pour les connexions socket. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Anciennes révisions à conserver. |

### Groupe 5 — Accès et contrôle d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Contrôle d'entrée Cloud Run. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Ne pas définir `SECRET_KEY`, `SUPERUSER_PASSWORD` ou `DB_*` ici — ils sont injectés automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

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
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un
bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner le LB HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket média auto-provisionné. |
| `enable_nfs` | `true` | Provisionne NFS ; utilisé comme hôte Redis lorsque `redis_host` est vide. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse. Lorsqu'il est vide, `Netbox_Common` monte automatiquement `netbox-media` à `/etc/netbox/media` (le véritable `MEDIA_ROOT` de NetBox). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Fixe ; NetBox nécessite PostgreSQL 14+. |
| `db_name` | `netbox` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `netbox` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non transféré — NetBox n'a pas de tâches récurrentes planifiées par la plateforme ; ses propres jobs planifiés s'exécutent via le worker RQ colocalisé à la place. |
| `additional_services` | `[]` | Services Cloud Run supplémentaires déployés avec NetBox. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/login/`, délai de 60s, seuil d'échec de 60 | Sonde de démarrage spécifique à NetBox (prend effet). |
| `liveness_probe` | HTTP `/login/`, fenêtre d'échec de 30s | Sonde de vivacité spécifique à NetBox. |
| `startup_probe_config` / `health_check_config` | valeurs par défaut génériques App_CloudRun | Sondes structurées alternatives ; remplacées par `startup_probe`/`liveness_probe` ci-dessus. |
| `uptime_check_config` | `{ enabled=true, path="/login/" }` | Vérification de la disponibilité de Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 15 — Paramètres de l'application NetBox {#group-15--netbox-application-settings}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `time_zone` | `UTC` | Fuseau horaire pour les horodatages et les tâches planifiées de NetBox. |
| `admin_user` | `admin` | Nom d'utilisateur du superutilisateur auto-créé. La création est idempotente — ignorée s'il existe déjà. |
| `admin_email` | `admin@example.com` | E-mail du superutilisateur auto-créé. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire.** Prend en charge la file d'attente de tâches RQ et la couche de cache de NetBox. NetBox ne peut pas fonctionner sans elle. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — Contrôles de service VPC et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL publique `run.app` de l'interface utilisateur web de NetBox. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | Détails du service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Chemin de montage `gcs_volumes` (défini automatiquement sur `/etc/netbox/media`) | Ne jamais remplacer par un chemin différent, sauf si vous avez confirmé le vrai `MEDIA_ROOT` de NetBox | Critique | Un chemin de montage erroné laisse les téléchargements sur le système de fichiers éphémère du conteneur — ils se lisent bien immédiatement, mais sont silencieusement perdus à chaque redémarrage sans erreur. Ce bogue exact a été trouvé et corrigé sur le montage `/opt/netbox/netbox/media` antérieur de ce module. |
| `SECRET_KEY` (généré automatiquement) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions actives et les cookies signés ; NetBox impose également une longueur minimale de 50 caractères. |
| `SUPERUSER_PASSWORD` (généré automatiquement) | Faire pivoter via l'interface utilisateur de NetBox, et non en régénérant le secret | Moyen | La régénération de la valeur Secret Manager ne modifie pas rétroactivement le mot de passe du compte administrateur déjà créé. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `enable_redis` | `true` (obligatoire) | Critique | Le système de tâches en arrière-plan de NetBox (webhooks, rapports, scripts, jobs planifiés) et sa couche de cache ne fonctionnent pas sans Redis — il n'y a pas de mode de secours. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais NFS est désactivé et qu'aucun hôte n'est défini, la connexion Redis est vide et le traitement en arrière-plan ne s'exécute jamais silencieusement. |
| `REDIS_DATABASE` / `REDIS_CACHE_DATABASE` | Garder séparés (`0` / `1`) | Élevé | Le partage d'une seule base de données Redis logique risque de perdre les tâches en arrière-plan en file d'attente lors d'un vidage du cache, selon la propre documentation de NetBox. |
| `memory_limit` | `2Gi` | Élevé | Les valeurs inférieures à 1 Gi risquent des arrêts OOM, en particulier avec le worker RQ colocalisé dans le même conteneur. |
| `cpu_always_allocated` / `min_instance_count` | `true` + `>=1` si les jobs en arrière-plan doivent s'exécuter en continu | Moyen | Avec la valeur par défaut axée sur les coûts (`false` / `0`), les webhooks/rapports/jobs planifiés ne s'exécutent que lorsqu'une requête maintient l'instance active — ils sont mis en file d'attente au lieu de s'exécuter immédiatement. |
| `ALLOWED_HOSTS` / `CORS_ORIGIN_ALLOW_ALL` (`"*"` / `"true"` auto-injectés) | Renforcer pour une utilisation en production face à Internet | Moyen | Laissé ouvert, tout nom d'hôte/origine est accepté — acceptable pour un premier déploiement, pas pour une instance de production renforcée. |
| `CSRF_TRUSTED_ORIGINS` (calculé automatiquement) | Vérifier qu'il correspond à l'URL réelle du service après le déploiement | Élevé | Une valeur obsolète ou incorrecte rejette chaque POST authentifié, y compris la connexion, avec une erreur CSRF. |
| `ingress_settings` | `all` pour un accès public | Moyen | `internal` bloque l'accès du navigateur au flux de connexion/configuration, sauf s'il est atteint via VPN/IAP. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur d'administration est publiquement accessible sans protection WAF par défaut. |

---

Pour le comportement de la fondation référencé partout — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à NetBox partagée avec la variante GKE est décrite
dans **[Netbox_Common](Netbox_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : NetBox sur Cloud Run](../labs/Netbox_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [NetBox sur GKE Autopilot](Netbox_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [NetBox Common — Configuration d'application partagée](Netbox_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Snipe-IT sur Google Cloud Run](SnipeIT_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **IT Asset & Infrastructure Records**.
