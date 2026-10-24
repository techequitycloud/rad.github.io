---
title: "Flarum sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Flarum sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Flarum_CloudRun.md @ e69407af sha256:6e9bb15fa431 -->

# Flarum sur Google Cloud Run {#flarum-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Flarum_CloudRun.png" alt="Flarum sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Flarum est une plateforme de forum et de discussion gratuite et open source — une alternative moderne et extensible aux logiciels de forum traditionnels, construite en PHP avec un frontend JavaScript/Mithril et une API REST. Ce module déploie Flarum sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Flarum utilise et sur la manière de les explorer et de les exploiter depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Flarum sur RAD, et comment cela se compare {#what-flarum-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, Flarum sur le module Cloud Run de RAD coûte environ 84 $ US par mois, plus 7,50 $ US une fois par déploiement et aucune licence par utilisateur.** GKE Autopilot est l'alternative pour les charges de travail qui doivent rester actives en permanence ou s'exécuter à côté d'autres applications Kubernetes ; voir le [guide GKE](Flarum_GKE.md), environ 143 $ US par mois. Flarum est une plateforme de forum de discussion et de communauté gratuite et open source avec des discussions thématiques, des tags et un système d'extensions. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé et restauré dans les 30 jours pour quelques crédits au lieu de rester en fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques dollars par mois, et non 84 $ US. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par chaque application du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 2 Gio, mise à l'échelle à zéro | 13 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache : une petite VM | 13 $ US |
| Passerelle et adresse IP Cloud NAT | 5 $ US |
| Cloud Storage pour les sauvegardes | 1 $ US |
| **Total** | **environ 84 $ US** |

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour Flarum au 8 octobre 2026, donc la comparaison honnête se fait par rapport à l'exécution par vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 $ US | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, Cloud Run, votre propre projet** | **84 $ US**, plus 7,50 $ US une fois | L'automatisation de RAD, dans votre projet |
| RAD, GKE Autopilot | environ 143 $ US ; voir le [guide GKE Autopilot](Flarum_GKE.md) | RAD |

L'empreinte propre de Flarum ici (1 vCPU / 2 Gio) est plus légère que celle de cette machine de référence, donc un niveau plus petit et moins cher des mêmes fournisseurs le ferait également fonctionner confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la différence est ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau du système d'exploitation ; le Cloud SQL géré par RAD (où cette application utilise une base de données), Secret Manager et la surveillance couvrent cela à la place.
- **Flarum est une plateforme de forum de discussion et de communauté gratuite et open source avec des discussions thématiques, des tags et un système d'extensions.** Cela détermine quelle colonne est importante : une opération prévisible et sans intervention vaut plus pour la plupart des équipes utilisant ce type d'outil que de réduire de quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Flarum s'exécute dans **un projet géré par RAD pour vous**, vous avez une option au-delà de la réduction d'échelle : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, un besoin saisonnier — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne le supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours, et comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un module, cela ne détruit pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits de temps de build au total (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non 84 $ US.** Déployez Flarum, utilisez-le pour une session, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois, les builds, et les heures où il était réellement actif.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude/démo conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud Storage explicitement désactivée, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ce déploiement et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes, de sorte que la majeure partie de son propre coût de calcul s'arrête d'elle-même lorsque personne ne l'utilise. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 $ US). La suppression permet d'économiser de l'argent si Flarum resterait inutilisé pendant environ 3 jours ou plus dans votre propre projet (environ 2,79 $ US par jour), ou environ 3 jours ou plus dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Flarum utilise.** La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie de calcul propre à cette application.
- **Conservez d'abord les données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous saisissez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Flarum dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimation quotidienne des crédits de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Flarum s'exécute comme un conteneur nginx + php-fpm unique construit à partir de l'image communautaire `mondedie/flarum`. Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur nginx/php-fpm sur le port 8888, 1 vCPU / 2 Gio par défaut ; mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour MySQL 8.0 | Obligatoire — le moteur est fixé à `MYSQL_8_0` par `Flarum_Common` |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les avatars/pièces jointes téléchargés persistent sous `/flarum/app/public/assets` |
| Stockage d'objets | Cloud Storage | Un bucket `flarum-assets` (de `Flarum_Common`) plus un bucket `data` par défaut sont provisionnés ; aucun n'est monté par défaut |
| Secrets | Secret Manager | `FLARUM_ADMIN_PASS` auto-généré ; mot de passe de la base de données géré séparément |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire.** `Flarum_Common` code en dur `database_type =
  "MYSQL_8_0"` dans sa configuration de sortie ; la variable `database_type` de la variante ne prend effet que si elle est explicitement remplacée par rapport à sa valeur par défaut `MYSQL_8_0`.
- **Cloud SQL est atteint via TCP IP privée directe par défaut, PAS le socket du proxy d'authentification.** `enable_cloudsql_volume` est par défaut `false` sur cette variante (il remplace la valeur par défaut `true` de `Flarum_Common`), de sorte que `DB_HOST` se résout en l'IP privée de l'instance Cloud SQL et le point d'entrée mondedie se connecte via TCP via l'egress VPC. C'est l'inverse de la variante [Flarum_GKE](Flarum_GKE.md), qui utilise toujours un sidecar cloud-sql-proxy sur loopback. Définissez `enable_cloudsql_volume = true` pour passer à la connexion par socket Unix à la place.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`), contrairement à la variante GKE qui est par défaut `min_instance_count = 1`. Les démarrages à froid ajoutent de la latence à la première requête après l'inactivité ; définissez `min_instance_count = 1` pour un forum toujours accessible.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/flarum/app/public/assets`) afin que les avatars et les pièces jointes des utilisateurs persistent et soient partagés entre les instances.
- **`FORUM_URL` est auto-câblé sur Cloud Run — contrairement à la variante GKE.** `main.tf` calcule l'URL de service `run.app` prédite déterministe et la transmet à `Flarum_Common` en tant que `service_url`, ce qui définit `FORUM_URL` automatiquement. Si vous placez le service derrière un domaine personnalisé ou l'équilibreur de charge HTTPS externe, remplacez `FORUM_URL` via `environment_variables` pour qu'il corresponde au nom d'hôte public réel.
- **`FLARUM_ADMIN_PASS` est généré automatiquement** et stocké dans Secret Manager. Le nom d'utilisateur et l'e-mail de l'administrateur sont **fixés par les valeurs par défaut de `Flarum_Common`** (`admin` / `admin@techequity.cloud`) — ils ne sont pas exposés en tant que variables de module d'application sur cette variante, alors récupérez le mot de passe généré avant la première connexion plutôt que de vous attendre à configurer le nom d'utilisateur/e-mail.
- **`php_memory_limit`, `upload_max_filesize` et `post_max_size` n'ont aucun effet.** Ces trois variables sont déclarées et transmises à `Flarum_Common`, mais la configuration de `Flarum_Common` ne les référence jamais — ce sont des restes inertes du modèle dérivé de WordPress à partir duquel ce module a été cloné. Les modifier ne change rien dans le conteneur déployé.
- **L'image est une construction personnalisée légère, pas une image préconstruite.** `container_image_source = "custom"` construit `FROM mondedie/flarum` via Cloud Build, en re-taguant l'image de base via l'ARG de build `FLARUM_VERSION` spécifique à l'application (car l'ARG de build `APP_VERSION` de la Fondation gagnerait autrement la fusion et forcerait un tag mobile). `application_version = "latest"` correspond au tag `stable` recommandé pour la production de l'image.
- **Pas de job de migration séparé.** Le point d'entrée s6-overlay de l'image `mondedie/flarum` exécute l'installateur Flarum au premier démarrage du conteneur, une fois que le job `db-init` a créé la base de données et l'utilisateur.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Flarum {#a-cloud-run--the-flarum-service}

Flarum s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Flarum stocke toutes les données du forum (discussions, publications, utilisateurs, tags) dans une instance Cloud SQL pour MySQL 8.0 gérée, avec des tables préfixées `flarum_`. Par défaut (`enable_cloudsql_volume = false`), le service se connecte via **TCP IP privée directe** via l'egress VPC ; la définition de `enable_cloudsql_volume = true` monte à la place le **Cloud SQL Auth Proxy** comme volume de socket Unix. Lors du premier déploiement, un job d'initialisation crée la base de données et l'utilisateur de l'application ; l'installateur Flarum crée ensuite le schéma au premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les flags, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et Filestore (NFS) {#c-cloud-storage--filestore-nfs}

Un bucket **Cloud Storage** `flarum-assets` (de `Flarum_Common`) et un bucket `data` par défaut (de la variable `storage_buckets`) sont provisionnés automatiquement, mais aucun n'est monté dans le conteneur par défaut — ajoutez une entrée à `gcs_volumes` si vous souhaitez en utiliser un comme montage de système de fichiers. Séparément, les avatars et pièces jointes téléchargés de Flarum résident sur **Cloud Filestore (NFS)** à `/flarum/app/public/assets`, monté car `enable_nfs = true` par défaut.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~flarum"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour GCS Fuse, les options CMEK et le comportement de découverte NFS.

### D. Secret Manager {#d-secret-manager}

Un secret spécifique à Flarum est généré automatiquement et stocké dans Secret Manager : `FLARUM_ADMIN_PASS` (le mot de passe administrateur de première exécution, 24 caractères). Le nom d'utilisateur et l'e-mail de l'administrateur sont fixés à `admin` / `admin@techequity.cloud` et ne sont pas stockés en tant que secrets. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~flarum AND name~admin-pass"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Redis (facultatif) {#e-redis-optional}

Redis est **désactivé par défaut** (`enable_redis = false`). Lorsqu'il est activé sans `redis_host` explicite, la Fondation injecte l'IP de la VM du serveur NFS partagé en tant que `REDIS_HOST` (nécessite `enable_nfs = true` ou un serveur NFS géré par Services_GCP découvrable) — cette injection au niveau de la Fondation l'emporte toujours sur la valeur de substitution propre à `Flarum_Common`, de sorte qu'un point de terminaison Redis fonctionnel atteint le conteneur de toute façon.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the resolved host in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings = "all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et l'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des règles d'alerte facultatifs.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Flarum {#3-flarum-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`) exécute `db-init.sh` en utilisant `mysql:8.0-debian`. Il localise le socket Unix du proxy d'authentification Cloud SQL sous `/cloudsql` (attendant jusqu'à 30 s lorsque `enable_cloudsql_volume = true`) ou revient à l'IP privée de l'instance via TCP, crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges, vérifie que l'utilisateur de l'application peut se connecter (chauffant le cache côté serveur `caching_sha2_password` de MySQL 8), et arrête gracieusement le sidecar du proxy d'authentification. Le job peut être réexécuté en toute sécurité.
- **Pas de job de migration séparé.** Le point d'entrée s6-overlay de l'image `mondedie/flarum` exécute automatiquement l'installateur Flarum au premier démarrage du conteneur, créant le schéma (avec le préfixe de table `flarum_`) une fois que `db-init` a provisionné la base de données et l'utilisateur. Le Dockerfile personnalisé est un wrapper léger non modifié sur l'image de base — il ne remplace ni `ENTRYPOINT` ni n'ajoute d'étape de migration.
- **Compte administrateur.** L'installateur crée un administrateur de première exécution dont le nom d'utilisateur est `admin` et l'e-mail est `admin@techequity.cloud` (valeurs par défaut fixes de `Flarum_Common`, non exposées en tant que variables de module) et dont le mot de passe est le secret généré `FLARUM_ADMIN_PASS`. Celui-ci est généré une fois et jamais renouvelé par le module — modifier le secret après l'installation ne **modifie pas** la connexion administrateur (modifiez-le plutôt depuis l'interface utilisateur d'administration de Flarum).
- **Câblage des variables d'environnement de la base de données.** `Flarum_CloudRun`'s `main.tf` définit `db_user_env_var_name = "DB_USER"`, `db_password_env_var_name = "DB_PASS"` et `db_name_env_var_name = "DB_NAME"` sur l'appel de la Fondation — les noms exacts des variables d'environnement que l'installateur mondedie/flarum attend — donc aucun point d'entrée d'alias n'est nécessaire. `Flarum_Common` définit en outre `DB_PORT = "3306"` et `DB_PREF = "flarum_"` directement dans `environment_variables`.
- **`FORUM_URL` est défini automatiquement** à partir de l'URL de service `run.app` prédite. Si vous ajoutez un domaine personnalisé ou un équilibreur de charge devant le service, mettez à jour `FORUM_URL` via `environment_variables` vers le nom d'hôte public réel, sinon les liens absolus, les URL d'actifs et les redirections pointeront vers le mauvais hôte.
- **Inscription/création de compte.** Le paramètre d'inscription publique de Flarum est une préférence d'administrateur intégrée à l'application (Admin → Général), et non quelque chose que ce module active/désactive — examinez-le après la première connexion si vous souhaitez restreindre qui peut créer des comptes de forum.
- **Chemin de santé.** Le `startup_probe` spécifique à l'application utilise par défaut une vérification **TCP** sur le port du conteneur (8888) avec un généreux `failure_threshold = 20` à `period_seconds = 15` (cinq minutes de grâce) pour s'adapter à l'installateur au premier démarrage. Le `liveness_probe` utilise par défaut **HTTP** `GET /` — la page d'accueil publique non authentifiée du forum Flarum — avec un `initial_delay_seconds = 300` (cinq minutes) avant la première vérification.
- **Redis (facultatif).** `enable_redis` est par défaut `false`. Lorsqu'il est activé sans `redis_host` explicite, la Fondation nécessite `enable_nfs =
  true` ou un serveur NFS découvrable (validation au moment du plan sur `App_CloudRun`) — sinon l'apply échoue avec une erreur claire plutôt que de déployer un forum qui ne peut pas atteindre Redis.
- **Inspecter l'exécution du job et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Flarum sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement et ses valeurs par défaut standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(obligatoire)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `flarum` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Flarum` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Flarum wiki on Cloud Run` | Texte de description du service. Cosmétique uniquement — malgré la formulation, Flarum est un forum, pas un wiki ; cela n'a aucun effet fonctionnel. |
| `application_version` | `latest` | Correspond au tag `mondedie/flarum` `stable` via l'ARG de build `FLARUM_VERSION` ; toute autre valeur est utilisée telle quelle. |
| `php_memory_limit` | `512M` | **Inerte** — déclarée et transmise à `Flarum_Common`, mais jamais consommée. N'a aucun effet sur le conteneur déployé. |
| `upload_max_filesize` | `64M` | **Inerte** — idem ci-dessus. |
| `post_max_size` | `64M` | **Inerte** — idem ci-dessus. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Build léger `FROM mondedie/flarum`. Garder `custom` — `prebuilt` contourne entièrement le mécanisme d'argument de build `FLARUM_VERSION`. |
| `container_image` | `""` | Laisser vide ; `Flarum_Common` fournit l'image construite. |
| `cpu_limit` | `1000m` | 1 vCPU pour nginx + php-fpm. |
| `memory_limit` | `2Gi` | Minimum ~512 Mio imposé par le seuil de l'environnement d'exécution gen2. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut — diffère de `min=1` de la variante GKE. |
| `max_instance_count` | `1` | Garder à `1` sauf si le partage NFS/DB multi-instances est vérifié. |
| `container_port` | `8888` | mondedie/flarum sert nginx + php-fpm sur 8888. |
| `execution_environment` | `gen2` | Requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Remplacement spécifique à Cloud Run** de la valeur par défaut `true` de `Flarum_Common` — Flarum se connecte via TCP IP privée directe, sauf si vous basculez cela sur `true` pour le volume de socket Unix du proxy d'authentification. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base mondedie/flarum dans Artifact Registry pour Cloud Build. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `container_protocol` | `http1` | `h2c` disponible si l'application prend en charge HTTP/2 en clair. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accès public au forum. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC — suffisant pour la connexion DB TCP IP privée par défaut. |
| `enable_iap` | `false` | Exiger la connexion Google. Bloque l'accès anonyme/public au forum. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, par exemple un `FORUM_URL` remplacé. Ne pas définir `DB_HOST`/`DB_PORT`/`DB_PREF`/`FLARUM_ADMIN_*` ici — ils sont gérés par le module. |
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

### Groupe 9 — Scripts SQL personnalisés et ciblage d'instances NFS {#group-9--custom-sql-scripts--nfs-instance-targeting}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. `nfs_instance_name` / `nfs_instance_base_name` vous permettent de cibler ou de nommer une VM GCE NFS existante au lieu de vous fier à la découverte automatique. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire — créé à côté (et non à la place) du bucket `flarum-assets` de `Flarum_Common`. |
| `enable_nfs` | `true` | NFS est activé par défaut afin que les avatars/pièces jointes téléchargés persistent et soient partagés. |
| `nfs_mount_path` | `/flarum/app/public/assets` | Où Flarum stocke les actifs téléchargés par les utilisateurs. |
| `gcs_volumes` | `[]` | Aucun bucket n'est monté dans le conteneur par défaut ; ajoutez une entrée pour utiliser réellement `flarum-assets` ou `data` comme montage de système de fichiers. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `Flarum_Common` ; n'a d'importance que s'il est explicitement remplacé. |
| `db_name` | `flarum` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `flarum` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé / `90` | Rotation du mot de passe de la base de données. |

Plusieurs variables miroir de la Fondation dans ce groupe (`application_database_name`, `application_database_user`, `db_password_env_var_name`, `db_host_env_var_name`, `db_user_env_var_name`, `db_name_env_var_name`, `db_port_env_var_name`, `service_url_env_var_name`, `sql_instance_name`, `sql_instance_base_name`, `enable_mysql_plugins`, `mysql_plugins`, `enable_postgres_extensions`, `postgres_extensions`) sont déclarées pour la parité de convention mais non transmises par `main.tf` — les noms réels des variables d'environnement `DB_USER` / `DB_NAME` / `DB_PASS` que l'image mondedie attend sont codés en dur directement, et non tirés de ces variables.

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Transmis à la Fondation — définissez ici les jobs récurrents déclenchés par Cloud Scheduler si nécessaire. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP sur le port 8888, délai initial de 30 s, fenêtre de 20×15 s | Sonde de démarrage. Fenêtre de grâce généreuse pour l'installateur au premier démarrage. |
| `liveness_probe` | HTTP `/` , délai initial de 300 s | Sonde de vivacité — délai de cinq minutes pour éviter de tuer le conteneur en cours d'installation. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Règles d'alerte métrique. |

### Groupe 15 — Réseau {#group-15--networking}

`network_name` est déclaré pour la parité de convention mais non transmis par `main.tf` — le réseau VPC est toujours auto-découvert.

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Backend de cache d'objets Redis facultatif. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS partagé (nécessite `enable_nfs = true` ou un serveur NFS découvrable). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL `run.app` par défaut du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (`flarum-assets` et `data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration. |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants du projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | Statut et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | Statut VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et statut CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, `enable_redis = true` avec un `redis_host` vide et aucun serveur NFS détectable, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` | Critique | La sélection d'un moteur non-MySQL interrompt l'installateur et toutes les requêtes. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `container_image_source` | `custom` | Critique | Le passage à `prebuilt` contourne le mécanisme d'argument de build `FLARUM_VERSION` sur lequel ce module s'appuie pour épingler le tag de l'image de base mondedie. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `FORUM_URL` (auto-injecté) | URL publique réelle | Élevé | Si vous ajoutez un domaine personnalisé ou un équilibreur de charge, un `FORUM_URL` non concordant rompt les liens absolus, les URL d'actifs et les redirections. |
| `enable_cloudsql_volume` | `false` (TCP) ou `true` (socket) — choisir délibérément | Élevé | Laissé à sa valeur par défaut avec des modifications restrictives `vpc_egress_setting`/pare-feu, le TCP direct IP privée vers Cloud SQL peut être bloqué ; le passage à `true` nécessite que le chemin du socket soit réellement monté. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les avatars/pièces jointes téléchargés éphémères — perdus lors du redémarrage du conteneur ou de la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Élevé | La mise à l'échelle au-delà de 1 sans comportement de stockage partagé/verrouillage vérifié risque des sessions fractionnées et des conflits de verrouillage NFS/DB. |
| `enable_iap` | uniquement lorsque l'accès public n'est pas nécessaire | Élevé | IAP bloque toutes les requêtes non authentifiées, y compris les visiteurs anonymes du forum. |
| `FLARUM_ADMIN_PASS` (auto-généré) | Récupérer avant la première connexion | Moyen | Ne pas le connaître vous bloque l'accès au premier compte administrateur jusqu'à la réinitialisation via la base de données. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N/A | Moyen | Ces variables sont inertes — les modifier ne change pas le comportement de PHP ou les limites de téléchargement dans le conteneur déployé. |
| `gcs_volumes` (vide par défaut) | Ajouter une entrée pour réellement utiliser un bucket | Moyen | Les buckets `flarum-assets` et `data` sont facturés et créés mais ne font rien à moins d'être explicitement montés. |
| `min_instance_count` | `1` pour un forum toujours accessible | Moyen | La mise à l'échelle à zéro (`0`, la valeur par défaut) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `memory_limit` | `2Gi` | Moyen | Le sous-dimensionnement de PHP-FPM sous charge risque des arrêts OOM. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Flarum
partagée avec la variante GKE — les identifiants administrateur, le bootstrap de la base de données, la construction de l'image de conteneur, les paramètres de base et les valeurs par défaut de la sonde de santé — est décrite dans
**[Flarum_Common](Flarum_Common.md)**.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : Flarum sur Cloud Run](../labs/Flarum_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Flarum sur GKE Autopilot](Flarum_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Flarum Common — Configuration d'application partagée](Flarum_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [Fider sur Google Cloud Run](Fider_CloudRun.md), [Formbricks sur Google Cloud Run](Formbricks_CloudRun.md), [LimeSurvey sur Google Cloud Run](LimeSurvey_CloudRun.md), [Rallly sur Google Cloud Run](Rallly_CloudRun.md) dans la solution **Communauté et Voix du client**.
