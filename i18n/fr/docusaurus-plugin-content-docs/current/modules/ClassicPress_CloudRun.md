---
title: "ClassicPress sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de ClassicPress sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/ClassicPress_CloudRun.md @ 1665a43e sha256:0b5d09d1f829 -->

# ClassicPress sur Google Cloud Run {#classicpress-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/ClassicPress_CloudRun.png" alt="ClassicPress sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

ClassicPress est un CMS gratuit, open source et axé sur les entreprises — un fork
léger de WordPress 4.9.x qui préserve l'expérience d'édition classique (avant
Gutenberg), avec des plugins, des thèmes, une bibliothèque de médias et une API
REST. Ce module déploie ClassicPress sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par ClassicPress et sur la
manière de les explorer et de les exploiter depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls,
sauvegardes et cycle de vie du déploiement — veuillez vous référer au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter
ici.

---

## Ce que coûte ClassicPress sur RAD, et comment cela se compare {#what-classicpress-costs-on-rad-and-how-that-compares}

**ClassicPress sur le module Cloud Run de RAD coûte environ 83,61 $ US par mois dans un projet Google Cloud que vous possédez, plus des frais de module uniques de 75 crédits (7,50 $ US).** ClassicPress est un fork léger de WordPress, antérieur à Gutenberg, pour les sites professionnels. GKE Autopilot convient à ClassicPress qui doit rester opérationnel, s'adapter à plusieurs pods ou fonctionner aux côtés d'autres charges de travail Kubernetes ; pour le coût le plus bas, ce module Cloud Run est généralement le bon choix — consultez le [guide GKE](ClassicPress_GKE.md) si vous avez besoin de l'autre.

Si ClassicPress n'est nécessaire qu'occasionnellement — une démo, un essai, une charge de travail saisonnière ou d'étude — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que 83,61 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build (environ 3 à 6) | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **83,61 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, moins sur un plan. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 83,61 $ US** |

### Comment cela se compare {#how-it-compares}

- Si vous l'exécutez vous-même, un VPS exécutant PHP, MySQL et ClassicPress vous coûtera moins cher en espèces : un Hetzner CPX22 ou un DigitalOcean 2 vCPU/4 Go coûte environ 24 $ par mois, ou un GCP `e2-standard-2` environ 49 $ par mois — plus votre propre temps pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL géré, Secret Manager et la surveillance de RAD couvrent pour vous.
- RAD ne prétend jamais être moins cher que l'infrastructure nue en termes d'argent — ce n'est généralement pas le cas. La différence est ce que RAD gère pour vous : les correctifs, les sauvegardes, les secrets et la surveillance, ainsi que la possibilité de mettre ClassicPress en pause gratuitement plutôt que de payer pour une capacité inactive (voir ci-dessous).
- La majeure partie du coût d'exécution ci-dessus est la base de données MySQL gérée (et, le cas échéant, le serveur de fichiers partagé) — la partie qu'une comparaison avec un VPS nu doit exécuter et sauvegarder manuellement.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si ClassicPress s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à ClassicPress dont vous n'avez besoin qu'occasionnellement que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un module, cela ne supprime pas Cloud SQL, la VM ou les ressources Cloud Run une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. C'est une poignée de crédits (moins de 1 $ US) au total pour une chaîne ClassicPress typique, contre les 80 crédits que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 83,61 $ US.** Déployez ClassicPress, utilisez-le, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures où il était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une véritable lacune : le bucket de sauvegarde ne survit pas.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé ClassicPress et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (8 $ US) dans votre propre projet. La suppression ne permet d'économiser de l'argent que si ClassicPress devait rester inutilisé pendant environ 3 jours ou plus, que ce soit dans votre propre projet ou dans un projet géré par RAD.
- **La majeure partie du coût d'exécution est généralement la base de données et le serveur de fichiers ou de cache partagé.** Ils ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de ClassicPress alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant obtient l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle. Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

ClassicPress s'exécute comme un conteneur PHP/Apache unique construit à partir
d'une image personnalisée légère `FROM classicpress/classicpress`. Le déploiement relie un
ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service PHP/Apache sur le port 80, 1 vCPU / 2 Gio par défaut ; scale-to-zero (`min_instance_count = 0`) est la valeur par défaut |
| Base de données | Cloud SQL pour MySQL 8.0 | Fixe — `ClassicPress_Common` code en dur `database_type = "MYSQL_8_0"` |
| Persistance des fichiers | Cloud Filestore (NFS), facultatif | Monté à `/var/www/html/wp-content` par défaut (`enable_nfs = true`) — voir [Section 3](#3-classicpress-application-behaviour) pour savoir comment cela assure la persistance des téléchargements/plugins/thèmes |
| Stockage d'objets | Cloud Storage | Un bucket `data` (à partir de la valeur par défaut `storage_buckets` de la variante) et un bucket `classicpress-uploads` (à partir de `ClassicPress_Common`) sont provisionnés automatiquement ; aucun n'est monté dans le conteneur par défaut |
| Secrets | Secret Manager | `CLASSICPRESS_SALT_SEED` auto-généré (dérive les 8 clés/salts d'authentification de style WordPress) ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **MySQL 8.0 est obligatoire et codé en dur.** Le `ClassicPress_Common` de `config` définit
  `database_type = "MYSQL_8_0"` directement ; la variable `database_type` de la variante
  est largement décorative — la surcharger rompt le job `db-init` spécifique à MySQL et
  le point d'entrée. Laissez-la à la valeur par défaut.
- **Build personnalisé, pas pré-construit.** `container_image_source` par défaut à `"custom"` —
  Cloud Build produit une image légère `FROM classicpress/classicpress` qui greffe un
  shim de point d'entrée aliasant les variables `DB_*` injectées par la Fondation sur
  le `CLASSICPRESS_DB_*` de ClassicPress et dérivant des salts d'authentification stables. L'image
  stock en amont n'est jamais déployée directement.
- **Cloud SQL est atteint par TCP via IP privée par défaut**, pas par un socket Unix.
  `enable_cloudsql_volume` par défaut à `false` (la variante force explicitement cette
  valeur dans la configuration de l'application, annulant ce que `ClassicPress_Common` pourrait
  définir autrement) ; le point d'entrée construit `CLASSICPRESS_DB_HOST` à partir de `DB_IP:DB_PORT`.
  MySQL sur la plage privée de Cloud SQL n'a pas besoin de SSL. Définissez `enable_cloudsql_volume =
  true` pour utiliser le socket du proxy d'authentification à la place.
- **L'installation *principale* de ClassicPress réside sur le système de fichiers éphémère du conteneur, mais les téléchargements/plugins/thèmes persistent via NFS.** Cloud Run n'a pas de volume de bloc persistant par instance équivalent au PVC de StatefulSet de GKE, de sorte que le point d'entrée en amont recopie l'application ClassicPress principale dans `/var/www/html` au premier démarrage de *chaque* instance de conteneur — ce qui est attendu, car ces fichiers principaux sont livrés avec l'image et n'ont pas besoin de persistance. `enable_nfs = true` monte Filestore à `/var/www/html/wp-content` par défaut, et la logique de copie du point d'entrée en amont ignore explicitement un répertoire `wp-content` existant plutôt que de le remplacer, de sorte que les médias téléchargés, les plugins installés et les thèmes sous `wp-content` *sont* conservés lors des démarrages à froid, des redéploiements et du remplacement d'instance — c'est ainsi que la persistance est réellement obtenue, et non une lacune.
- **`CLASSICPRESS_SALT_SEED` est généré automatiquement** et stocké dans Secret
  Manager ; le point d'entrée en dérive les 8 valeurs `AUTH_KEY`/`SALT` de style WordPress
  de manière déterministe, de sorte que les cookies et les sessions survivent aux redémarrages et
  s'accordent sur chaque instance démarrée à froid sans persister l'état `wp-config.php`.
- **Pas d'auto-installation — la première connexion est manuelle.** `ClassicPress_Common` ne génère pas
  de secret de mot de passe administrateur et ne définit aucun drapeau d'auto-installation. ClassicPress crée son
  schéma et son compte administrateur via son propre installateur web de première exécution une fois que `db-init`
  a provisionné la base de données vide.
- **Deux buckets GCS sont créés mais inutilisés par défaut.** La valeur par défaut `storage_buckets` de la variante (`data`) et le préréglage `ClassicPress_Common` (`classicpress-uploads`) sont tous deux créés (suffixes de nom différents, pour qu'ils ne se heurtent pas) — aucun n'est câblé comme un montage `gcs_volumes` à moins que vous n'en ajoutiez un.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service ClassicPress {#a-cloud-run--the-classicpress-service}

ClassicPress s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes entre le nombre minimum et maximum d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

ClassicPress stocke toutes les données de l'application (articles, pages, utilisateurs, options, paramètres de plugins/thèmes) dans une instance Cloud SQL pour MySQL 8.0 gérée. Par défaut, le service se connecte via **TCP IP privée** (`enable_cloudsql_volume = false`) ; Cloud SQL MySQL accepte le TCP non chiffré sur la plage privée, donc aucune configuration SSL n'est nécessaire. Lors du premier déploiement, un job d'initialisation (`db-init`) crée la base de données et l'utilisateur de l'application et vérifie que l'utilisateur de l'application peut se connecter.

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

### C. Cloud Storage {#c-cloud-storage}

Deux buckets Cloud Storage sont provisionnés par défaut : un bucket `data` (déclaré par
la valeur par défaut `storage_buckets` de cette variante) et un bucket `classicpress-uploads`
(déclaré par `ClassicPress_Common`). Aucun n'est monté dans le conteneur par
défaut — la persistance des médias/plugins/thèmes est plutôt gérée par le montage NFS à
`/var/www/html/wp-content` (voir [Section D](#d-cloud-filestore-nfs)) ; un montage `gcs_volumes`
est une alternative uniquement si vous préférez le stockage basé sur GCS plutôt que Filestore.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<bucket-name>/        # bucket names are in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Cloud Filestore (NFS) {#d-cloud-filestore-nfs}

`enable_nfs = true` est la valeur par défaut, montant une instance Filestore partagée à
`/var/www/html/wp-content`. ClassicPress (un fork de WordPress) lit/écrit les médias téléchargés,
les plugins installés et les thèmes sous `wp-content`, et la logique de copie au premier
démarrage du point d'entrée en amont ignore explicitement un répertoire `wp-content`
existant, de sorte que ce montage est le chemin confirmé qui assure la persistance lors
des redémarrages, des redéploiements et des démarrages à froid. `enable_nfs = true` est également ce qui fait
que `redis_host = ""` se rabat sur l'IP Redis co-hébergée du serveur NFS (voir Groupe 21).

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la découverte NFS et les mécanismes de montage.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à ClassicPress est généré automatiquement et stocké dans Secret
Manager : `CLASSICPRESS_SALT_SEED`, une graine aléatoire de 64 caractères à partir de laquelle le
point d'entrée dérive les 8 valeurs `AUTH_KEY`/`SECURE_AUTH_KEY`/
`LOGGED_IN_KEY`/`NONCE_KEY` de style WordPress et leurs valeurs `SALT` correspondantes (SHA-256 de la graine
plus un suffixe fixe par clé). Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~classicpress"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings =
"all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de disponibilité et des stratégies d'alerte facultatifs.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application ClassicPress {#3-classicpress-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job d'initialisation (`db-init`, `mysql:8.0-debian`)
  attend la connectivité (socket Unix si `enable_cloudsql_volume = true`, sinon
  TCP via `DB_IP`), crée de manière idempotente la base de données et l'utilisateur de l'application avec
  `CREATE USER IF NOT EXISTS` / `GRANT ALL PRIVILEGES`, vérifie que l'utilisateur de l'application peut
  se connecter, et arrête gracieusement le sidecar Cloud SQL Auth Proxy si un a été
  démarré. Le job peut être relancé en toute sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration séparé — installation manuelle au premier démarrage.** Il n'y a pas
  de drapeau d'auto-installation pour ClassicPress. Une fois que `db-init` a provisionné la base de données
  vide, ClassicPress crée son propre schéma et son compte administrateur via l'installateur web
  de première exécution (`/wp-admin/install.php` dans l'image en amont). Visitez l'URL du service
  après le premier déploiement et complétez l'installateur pour définir le nom d'utilisateur, le mot de passe et l'e-mail
  de l'administrateur — il n'y a pas de secret de mot de passe administrateur généré.
- **Alias de variables d'environnement DB sur TCP.** La Fondation injecte `DB_IP` (l'IP privée Cloud SQL sur Cloud Run), `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD` ; ClassicPress lit `CLASSICPRESS_DB_*`. Le `entrypoint.sh` greffé construit `CLASSICPRESS_DB_HOST` comme `<DB_IP>:<DB_PORT>` (ou la forme `localhost:<socket>` si un répertoire de socket Cloud SQL est trouvé sous `enable_cloudsql_volume = true`) et aliasse le reste, avant de passer la main au `docker-entrypoint.sh` en amont.
- **Les clés/salts d'authentification sont dérivés, non stockés individuellement.** `CLASSICPRESS_SALT_SEED`
  est le seul secret généré ; le point d'entrée calcule les 8 valeurs
  `CLASSICPRESS_AUTH_KEY` / `..._SALT` comme `sha256(seed-<key-name>)`, de sorte que chaque
  redémarrage et chaque instance démarrée à froid s'accordent sur les mêmes valeurs sans
  persister l'état `wp-config.php` — les sessions et les cookies de connexion restent valides malgré
  le renouvellement des instances, même si le système de fichiers ne le fait pas.
- **Les fichiers *principaux* de l'installation résident sur le système de fichiers éphémère du conteneur ; `wp-content` persiste via NFS.** Le `docker-entrypoint.sh` en amont écrit `wp-config.php` et copie l'application ClassicPress dans `/var/www/html` au premier démarrage de chaque instance de conteneur. Avec `enable_nfs = true` (la valeur par défaut), Filestore est monté directement à `/var/www/html/wp-content`, et la logique de copie ignore explicitement un répertoire `wp-content` existant plutôt que de le remplacer — ainsi, les médias téléchargés, les plugins et les thèmes installés via wp-admin survivent chaque fois que l'instance est recyclée (redéploiement, mise à l'échelle à zéro et retour, remplacement d'instance). Seuls les fichiers principaux en dehors de `wp-content` sont fraîchement copiés à chaque fois, ce qui est attendu puisqu'ils sont livrés avec l'image.
- **Le chemin de montage NFS est le mécanisme de persistance confirmé.**
  `enable_nfs = true` monte Filestore à `/var/www/html/wp-content` par défaut.
  ClassicPress (un fork de WordPress) lit/écrit les médias téléchargés, les plugins et les thèmes
  sous `wp-content` par rapport à sa racine web, et la logique de copie-saut du point d'entrée en amont
  pour un répertoire `wp-content` existant est exactement ce qui rend le montage NFS
  sûr et efficace — c'est ainsi que la persistance est réellement obtenue, et non un stockage
  supplémentaire/inutilisé.
- **`php_memory_limit`, `upload_max_filesize` et `post_max_size` sont acceptés mais
  ne sont pas actuellement câblés dans un paramètre PHP.** Ces variables sont transmises à
  `ClassicPress_Common`, mais son `config.environment_variables` ne définit aucune
  variable d'environnement `PHP_*`/`UPLOAD_MAX_FILESIZE`/`POST_MAX_SIZE` correspondante pour que
  l'image en amont puisse la lire — les modifier n'a aucun effet observé sur le conteneur
  déployé aujourd'hui.
- **Redis est facultatif et désactivé par défaut.** Lorsque `enable_redis = true`, laisser
  `redis_host` vide permet à la Fondation de se rabattre sur l'IP Redis du serveur NFS co-hébergé
  (nécessite `enable_nfs = true`) ; définir `redis_host` pointe explicitement
  ClassicPress vers une instance Redis/Memorystore externe à la place.
- **Chemins de santé.** La sonde de démarrage est **TCP** sur le port 80 (généreux
  `failure_threshold = 20`, laissant le temps au point d'entrée de l'image en amont de
  remplir le `/var/www/html` vide au premier démarrage d'une nouvelle instance). La
  sonde de vivacité est **HTTP** `GET /` avec un délai initial de 300 secondes — un 200
  (site installé) ou une redirection 302 vers l'installateur (nouvelle installation) sont tous deux considérés comme
  sains.
- **Inspecter l'exécution du job et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement (par leur
balise `{{UIMeta group=N}}`, et non par les commentaires de section du fichier `.tf`, qui sont
occasionnellement désynchronisés avec les balises). Seuls les paramètres spécifiques ou notables pour
ClassicPress sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `classicpress` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `ClassicPress` | Nom lisible par l'homme affiché dans la console. |
| `description` | `ClassicPress wiki on Cloud Run` | Description du service. |
| `application_version` | `latest` | Mappe vers la balise d'image `classicpress/classicpress` via l'argument de build `CLASSICPRESS_VERSION` spécifique à l'application (`latest` se résout en `php8.3-apache` ; l'argument de build générique `APP_VERSION` injecté par la Fondation écraserait sinon silencieusement un argument de même nom). |
| `php_memory_limit` | `512M` | Accepté mais non actuellement câblé dans un paramètre PHP — voir Section 3. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Même mise en garde que ci-dessus ; validé au moment de la planification (`upload_max_filesize ≤ post_max_size`) mais non appliqué autrement. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image légère `FROM classicpress/classicpress` avec le shim de point d'entrée greffé — requis, l'image stock ne peut pas aliaser `DB_*` seule. |
| `cpu_limit` | `1000m` | CPU par instance ; ClassicPress avec MySQL nécessite au moins 1 vCPU. |
| `memory_limit` | `2Gi` | Mémoire par instance ; minimum ~512 Mio pour PHP/Apache. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro — mais voir la mise en garde sur le système de fichiers éphémère dans la Section 3 avant de s'y fier en production. |
| `max_instance_count` | `1` | Gardez à `1` — le système de fichiers du conteneur est par instance et non partagé. |
| `container_port` | `80` | ClassicPress fonctionne sur Apache, port 80. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | La valeur par défaut est TCP IP privée ; définissez `true` pour le socket Unix du proxy d'authentification Cloud SQL à la place. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image construite dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Ingress public pour le frontend CMS et l'interface d'administration. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google pour l'ensemble du service (y compris le site public). |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires, fusionnés avec les valeurs par défaut de `ClassicPress_Common` (`DB_PORT`, `CLASSICPRESS_TABLE_PREFIX=cp_`, `CLASSICPRESS_DB_CHARSET=utf8mb4`). |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. `CLASSICPRESS_SALT_SEED` est injecté automatiquement et n'a pas besoin d'être défini ici. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un dump MySQL depuis GCS ou Google Drive lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter du SQL à partir d'un bucket GCS après le provisionnement. |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry pour l'image construite. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire au-delà du propre bucket `ClassicPress_Common` de `classicpress-uploads` (les deux sont créés ; aucun n'est monté par défaut). |
| `enable_nfs` | `true` | Activé par défaut, monté à `/var/www/html/wp-content` — c'est ainsi que la persistance des téléchargements/plugins/thèmes est obtenue (voir Section 3). |
| `nfs_mount_path` | `/var/www/html/wp-content` | Chemin de montage à l'intérieur du conteneur. La logique de copie du point d'entrée en amont ignore un répertoire `wp-content` existant, donc le montage ici est sûr. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2) ; ajoutez une entrée montée à `/var/www/html/wp-content/uploads` pour une persistance réelle des médias. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Codé en dur par `ClassicPress_Common` ; la modification de la variable ne change pas le moteur de base de données déployé. |
| `db_name` | `classicpress` | Nom de la base de données MySQL. Immuable après le premier déploiement. |
| `db_user` | `classicpress` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Déclaré uniquement pour la mise en miroir de convention — `main.tf` code en dur des alias vides pour cette variante, donc la définition de ceux-ci n'a aucun effet ; le propre point d'entrée de ClassicPress gère l'aliasing `CLASSICPRESS_DB_*`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré de `ClassicPress_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | Port TCP 80, `failure_threshold = 20` | Seuil généreux pour le remplissage au premier démarrage de `/var/www/html`. |
| `liveness_probe` | HTTP `/`, délai initial de 300s | Un 200 ou une redirection 302 vers l'installateur sont tous deux considérés comme sains. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | Active le backend de cache d'objets de style WordPress de ClassicPress. |
| `redis_host` | `""` | Laissez vide pour revenir à la propre injection `REDIS_HOST` de la Fondation (l'IP Redis de la VM NFS lorsque `enable_nfs = true`) ; définissez explicitement pour une instance Redis/Memorystore externe. |
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
| `service_url` | URL par défaut `run.app` du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Manager secret contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (`data` et `classicpress-uploads`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource. ClassicPress exécute également sa propre précondition (`validations.tf`) pour `upload_max_filesize ≤ post_max_size`.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| Persistance des médias/plugins à `/var/www/html/wp-content` | Garder `enable_nfs = true` (par défaut) | Faible | Avec `enable_nfs = true`, Filestore est monté à `/var/www/html/wp-content` et la logique de copie du point d'entrée en amont l'ignore au démarrage, de sorte que les médias téléchargés et les plugins/thèmes installés via wp-admin survivent aux démarrages à froid. La désactivation de `enable_nfs` supprime cette persistance — chaque instance démarrée à froid commencerait alors à partir d'un `wp-content` vide. |
| `CLASSICPRESS_SALT_SEED` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide tous les cookies signés et les sessions connectées sur chaque instance. |
| `database_type` | Laisser par défaut (`MYSQL_8_0`) | Critique | Le job `ClassicPress_Common` `db-init` et le point d'entrée sont spécifiques à MySQL ; la valeur est codée en dur quelle que soit la variable, mais se fier à la variable pour sélectionner un moteur est une impasse. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `max_instance_count` | `1` | Moyen | `wp-content` (téléchargements/plugins/thèmes) est partagé via le montage NFS, mais les fichiers ClassicPress core en dehors de celui-ci sont copiés indépendamment par instance ; la mise à l'échelle au-delà de 1 n'a pas été validée pour la sécurité d'écriture concurrente sur `wp-content`. |
| Configuration admin au premier démarrage | Compléter `/wp-admin/install.php` rapidement après le déploiement | Élevé | Tant que l'installateur n'est pas exécuté, le site n'a pas de schéma et pas de compte admin — il n'y a pas de secret de mot de passe admin généré à récupérer. |
| `enable_nfs` | `true` | Moyen | Provisionne et paie une instance Filestore montée à `/var/www/html/wp-content` — le mécanisme confirmé pour la persistance des téléchargements/plugins/thèmes (voir Section 3). Le désactiver supprime cette persistance. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N'importe quelle valeur | Faible | Actuellement non câblé dans un paramètre PHP — ne supposez pas que leur modification affecte les limites de téléchargement ou la mémoire PHP dans le conteneur déployé. |
| `memory_limit` | `2Gi` | Moyen | En dessous de ~512 Mo, le conteneur PHP/Apache risque un OOM sous charge ou avec des plugins plus lourds. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute une latence de démarrage à froid pendant que les fichiers core sont recopiés dans `/var/www/html` ; les téléchargements/plugins/thèmes sous `wp-content` ne sont pas affectés car ils persistent via NFS. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur admin et le site public sont accessibles sans protection WAF par défaut. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé partout — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à ClassicPress
partagée avec la variante GKE se trouve dans le module `ClassicPress_Common` (aucun guide
`ClassicPress_Common.md` autonome n'existe encore dans cet ensemble de documents) ; voir aussi
[ClassicPress_GKE](ClassicPress_GKE.md) pour savoir comment la même application se comporte sur un
StatefulSet avec un PVC de bloc par pod.

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : ClassicPress sur Cloud Run](../labs/ClassicPress_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [ClassicPress sur GKE Autopilot](ClassicPress_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [ClassicPress Common — Configuration d'application partagée](ClassicPress_Common.md) — la configuration partagée par les deux cibles de déploiement.
