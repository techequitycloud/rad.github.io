---
title: "Snipe-IT sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Snipe-IT sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/SnipeIT_CloudRun.md @ 40c83c3f sha256:b7e498014846 -->

# Snipe-IT sur Google Cloud Run {#snipe-it-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/SnipeIT_CloudRun.png" alt="Snipe-IT sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Snipe-IT est un système de gestion des actifs informatiques et des stocks,
gratuit et open source, utilisé pour suivre le matériel, les licences
logicielles, les accessoires et les consommables, avec des fonctions
d'enregistrement/de sortie des actifs, de journalisation des audits,
d'amortissement et une API REST complète. Il est basé sur Laravel/PHP et
s'exécute derrière Apache. Ce module déploie Snipe-IT sur **Cloud Run v2**
au-dessus du socle [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud que Snipe-IT utilise et sur la
manière de les explorer et de les exploiter depuis la console Google Cloud et
la ligne de commande. Pour les mécanismes communs à chaque application Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide du socle App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Snipe-IT sur RAD, et comparaison {#what-snipe-it-costs-on-rad-and-how-that-compares}

**L'exécution de Snipe-IT dans votre propre projet GCP coûte environ 83,61 $/mois en frais Google Cloud ; les frais de module de RAD sont de 110 crédits uniques (ou 99 crédits dans un projet géré par RAD), couvrant la configuration et le support — pas la facture cloud continue, que Google vous facture directement dans votre propre projet ou que RAD mesure à l'heure en crédits dans un projet géré par RAD.**
Ou consultez le guide GKE pour la cible de déploiement alternative ; dans tous les cas, si vous déployez dans un projet géré par RAD, vous pouvez tout mettre en pause gratuitement lorsque vous ne l'utilisez pas — voir [Mettez-le en pause gratuitement](#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it) ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Votre propre projet | Projet géré par RAD |
|---|---|---|
| Frais de module | 110 crédits, une fois | 99 crédits, une fois (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés à la minute pour le temps de build | Idem |
| Coût d'exécution Google Cloud | ~83,61 $/mois, facturé à votre propre compte de facturation au prix catalogue de Google | ~67 crédits/jour, mesuré à l'heure par RAD au prix catalogue plus marge |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

**Coût d'exécution par défaut dans votre propre projet**

| Ressource | US$/mois (prix catalogue Google, us-central1) |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ |
| Cloud SQL pour MySQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ |
| Cloud NAT et réseau | 5,00 $ |
| Cloud Storage (modules complémentaires, sauvegardes) | 1,00 $ |
| **Total** | **83,61 $** |

### Comparaison {#how-it-compares}

- Les plans d'hébergement officiels de Snipe-IT commencent à **39,99 $/mois** (Hébergement basique, utilisateurs et actifs illimités ; source : https://snipeitapp.com/pricing) — une alternative proche et directement comparable à l'exécution par vous-même.
- L'exécuter vous-même sur un VPS nu reste l'option la moins chère en espèces — Hetzner CPX22 (2 vCPU/4 Go) coûte environ **24 $/mois**, un Droplet DigitalOcean 2 vCPU/4 Go coûte également **24 $/mois**, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) coûte environ **49 $/mois** — plus le temps de l'administrateur pour les sauvegardes, les correctifs de sécurité et les mises à niveau, que Cloud SQL, Secret Manager et la surveillance gérés par RAD couvrent pour vous — mais le prix de RAD n'est jamais destiné à battre un VPS, seulement à remplacer le temps d'administration qu'un VPS nécessite encore.
- Un registre d'actifs est consulté occasionnellement pendant la journée de travail, et non interrogé en continu, de sorte que le coût d'exécution ci-dessous est principalement dû à la base de données et au serveur de fichiers partagé, et non au volume de requêtes.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

**C'est le titre pour un projet géré par RAD.** La suppression d'un projet géré par RAD
délie d'abord sa facturation, puis demande à Google de supprimer le projet
purement et simplement — la suppression logicielle récupérable de 30 jours de
Google. Contrairement à la suppression d'un module, cela ne supprime pas Cloud
SQL, aucune VM ou la ressource de calcul une par une : l'ensemble du projet
s'arrête simplement, et rien n'est facturé pendant qu'il attend, car la
facturation est déjà déliée.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration, de sorte que la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

La restauration, dans les 30 jours et uniquement par le propriétaire du projet,
demande à Google de récupérer le projet et de rattacher son compte de
facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour
confirmer que tout est revenu. Comme rien n'a été détruit
individuellement, cette mise à jour trouve les mêmes ressources déjà présentes
— c'est une vérification, pas une reconstruction, et une mise à jour ne facture
jamais les frais de module à nouveau. Les mises à jour sont incluses dans le
prix (5 par mois pour chaque déploiement), donc une restauration ne coûte
normalement aucun crédit.

Ce que cela nécessite : vous devez être propriétaire du projet (pas un projet
dont RAD gère uniquement la facturation), vous devez le restaurer vous-même
dans les 30 jours — après cela, Google le supprime définitivement — et la
restauration est admise comme la création d'un nouveau projet, de sorte que
votre solde de crédits achetés doit toujours dépasser le seuil du palier (100
crédits pour le palier sandbox qui convient à la plupart des utilisations
d'étude/démo). Google indique que la plupart des services sont de nouveau
pleinement fonctionnels dans les 36 heures suivant une restauration.

**Un véritable manque :** les sauvegardes nocturnes sont écrites dans un bucket
à l'intérieur du projet, et ce bucket a la suppression logicielle de Cloud
Storage explicitement désactivée, il est donc très probable qu'il disparaisse
dès que vous supprimez le projet — même si le projet lui-même est récupérable
pendant 30 jours. Si vous avez personnalisé l'application et que vous
souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou
un bucket en dehors du projet) avant de supprimer. Pour une installation par
défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Dans votre propre projet (ou une fois que vous avez dépassé la fenêtre de restauration de 30 jours ci-dessus), l'alternative est de supprimer Snipe-IT purement et simplement et de le redéployer plus tard. Un redéploiement coûte à nouveau les frais de module (les builds sont inclus) — 110 crédits.

La suppression ne permet d'économiser de l'argent que si Snipe-IT reste inutilisé assez longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution quotidien — par rapport au total du projet ci-dessus, cela représente environ 4 jours ou plus. La majeure partie du coût d'exécution ici est généralement la base de données et la VM NFS/cache ; elles ne s'arrêtent que si rien d'autre dans le projet ne les utilise, donc la suppression de cette application alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.

**Conservez d'abord les données :** les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation :** un formateur anime une session pour
  une classe. Chaque participant dispose de l'application dans son propre
  projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une
  allocation définie par le formateur. Soit le formateur finance toutes les
  places, soit chaque participant paie la sienne. Tout est supprimé à la fin
  de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil :** un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  devient faible, la facturation est suspendue et les données sont conservées,
  afin que personne ne reçoive de frais inattendus. À la fin, le partenaire
  transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF,
  XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue de l'API Google Cloud Billing Catalog ; radmodules.dev/pricing pour les frais propres à RAD et les estimations de crédits quotidiens ; https://cloud.google.com/resource-manager/docs/delete-restore-projects pour les mécanismes de pause/restauration ; https://snipeitapp.com/pricing pour le prix du concurrent nommé.

## 1. Vue d'ensemble {#1-overview}

Snipe-IT s'exécute en tant que conteneur PHP/Apache officiel `snipe/snipe-it`
tiré directement de Docker Hub — il n'y a pas d'étape de build personnalisée.
Le déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Image PHP/Apache `snipe/snipe-it` préconstruite, port 80, 1 vCPU / 2 Gio par défaut ; autoscaling sans serveur avec mise à l'échelle à zéro |
| Base de données | Cloud SQL pour MySQL 8.0 | Requis — fixé par `SnipeIT_Common` ; les autres moteurs ne sont pas pris en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les images d'actifs téléchargées, les signatures et les codes-barres persistent sous `/var/lib/snipeit` |
| Stockage d'objets | Cloud Storage | Un bucket `snipeit-uploads` provisionné automatiquement |
| Cache | Redis (facultatif) | Activé par défaut pour le cache/session Laravel |
| Secrets | Secret Manager | `APP_KEY` Laravel auto-générée ; mot de passe de la base de données géré par le socle |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Image officielle préconstruite uniquement.** `container_image_source = "prebuilt"` est la valeur par
  défaut — le module déploie `snipe/snipe-it:<application_version>` (tag par défaut `v8-latest`)
  directement, mis en miroir dans Artifact Registry lorsque `enable_image_mirroring = true`. Il n'y
  a pas d'étape Cloud Build/Dockerfile.
- **MySQL 8.0 est obligatoire.** `SnipeIT_Common` fixe `database_type` à `MYSQL_8_0`
  quelle que soit la valeur de la variable ; les autres moteurs ne sont pas
  pris en charge.
- **Cloud SQL est atteint via TCP par défaut, pas via un socket Unix.**
  `enable_cloudsql_volume` est défini par défaut sur `false` ici — contrairement à la
  plupart des modules App_CloudRun. C'est délibéré : Snipe-IT est un client
  Laravel/MySQL, et selon la convention de ce dépôt, les applications
  Laravel-mysql (Snipe-IT, Matomo) se connectent via l'IP privée de Cloud SQL
  plutôt que via le socket Auth Proxy. `db-init.sh` prend toujours en charge le
  chemin du socket si vous activez `enable_cloudsql_volume = true`, mais la valeur par défaut
  éprouvée et testée est TCP.
- **Les variables d'environnement de la base de données sont mappées en dur aux
  noms natifs de Laravel.** `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name =
  "DB_DATABASE"` et
  `db_password_env_var_name = "DB_PASSWORD"` — les noms exacts que la configuration `env()` de Laravel lit —
  plus `DB_CONNECTION = "mysql"` et `DB_PORT = "3306"` définis par `SnipeIT_Common`. Il s'agit d'une
  convention déjà fixée et éprouvée (reflétée par la même correction appliquée
  à BookStack/Matomo), et non de quelque chose que vous devez configurer.
- **NFS est activé par défaut** (`enable_nfs = true`, monté à `/var/lib/snipeit`) afin que les
  images d'actifs téléchargées, les signatures et les codes-barres persistent
  et survivent aux mises à l'échelle à zéro/démarrages à froid — contrairement
  aux applications telles qu'Activepieces où NFS est désactivé par défaut.
- **Une `APP_KEY` Laravel est générée automatiquement** et stockée dans Secret
  Manager (`secret-<prefix>-snipeit-app-key`), injectée en tant que variable d'environnement secrète
  `APP_KEY`. La régénération après le premier démarrage invalide toutes les
  sessions actives et toutes les données d'application chiffrées avec l'ancienne
  clé.
- **Plafond d'instance unique par défaut.** `max_instance_count = 1` — le comportement
  multi-instance avec stockage NFS partagé et le pilote de session basé sur la
  base de données de Laravel n'a pas été vérifié pour Snipe-IT.
- **La mise à l'échelle à zéro est activée par défaut** (`min_instance_count = 0`). Les
  démarrages à froid ajoutent de la latence à la première requête après une
  période d'inactivité.
- **Redis est activé par défaut** (`enable_redis = true`) pour le déchargement du cache/de la
  session Laravel ; laisser `redis_host` vide revient à la résolution standard du
  point de terminaison Redis de la plateforme.
- **Deux jobs d'initialisation ordonnés s'exécutent à chaque apply.**
  `db-init` (crée la base de données/l'utilisateur via `mysql:8.0-debian`) s'exécute
  en premier, puis `migrate` (`php
  artisan migrate --force` contre l'image `snipe/snipe-it`) — les
  deux sont `execute_on_apply = true` et peuvent être réexécutés en toute sécurité.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
des services et des ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Snipe-IT {#a-cloud-run--the-snipe-it-service}

Snipe-IT s'exécute en tant que service Cloud Run v2 qui s'adapte
automatiquement en fonction de la charge des requêtes entre le nombre
minimum et maximum d'instances. Chaque déploiement crée une révision
immuable ; le trafic peut être réparti entre les révisions pour des
déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la
concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour MySQL 8.0 {#b-cloud-sql-for-mysql-80}

Snipe-IT stocke toutes les données de l'application (actifs, licences,
accessoires, consommables, utilisateurs, piste d'audit) dans une instance
Cloud SQL pour MySQL 8.0 gérée. Par défaut, le service y accède via l'**IP
privée via TCP** (`enable_cloudsql_volume = false`), et non via le socket Unix du proxy
d'authentification Cloud SQL utilisé par la plupart des autres modules
App_CloudRun. Lors du premier déploiement, le job d'initialisation `db-init`
crée la base de données et l'utilisateur de l'application (en réessayant
d'abord le chemin du socket, puis en revenant à TCP contre `DB_IP`), suivi
du job `migrate` qui exécute `artisan migrate --force` de Laravel.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot
de passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes
et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers NFS {#c-cloud-storage--nfs-file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `snipeit-uploads`) est provisionné
automatiquement. Séparément, l'arborescence de téléchargement d'exécution de
Snipe-IT (images d'actifs, signatures, codes-barres) réside sur **NFS (Cloud
Filestore)** à `/var/lib/snipeit`, partagée entre les instances et survivant aux
redémarrages/démarrages à froid des conteneurs — requis car le système de
fichiers du conteneur local de Cloud Run est éphémère.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~snipeit-uploads"
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les volumes GCS Fuse et les
options CMEK.

### D. Redis (backend de cache) {#d-redis-cache-backend}

Redis est **activé par défaut** (`enable_redis = true`) pour la couche de cache de
Laravel. Lorsque `redis_host` est laissé vide, la résolution Redis standard de la
plateforme s'applique (le Redis colocalisé du serveur NFS, lorsque NFS est
activé).

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the injected value in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### E. Secret Manager {#e-secret-manager}

Un secret Snipe-IT est généré automatiquement et stocké dans Secret Manager :
la `APP_KEY` Laravel (`base64:<...>`, 32 octets aléatoires encodés en base64). Le
mot de passe de la base de données est géré séparément par le socle.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~snipeit"
  gcloud secrets versions access latest --secret=<app-key-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut (`ingress_settings =
"all"`). Un
équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN
et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le
contrôle d'egress VPC contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage
  de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux des conteneurs sont envoyés à Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des tests de
disponibilité et des stratégies d'alerte facultatifs (désactivés par
défaut).

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Snipe-IT {#3-snipe-it-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job
  d'initialisation `db-init` s'exécute sur `mysql:8.0-debian`. Il vérifie d'abord la
  présence d'un socket Unix Cloud SQL monté (présent uniquement si
  `enable_cloudsql_volume = true`) et, en son absence, revient à TCP contre `DB_IP` (l'IP
  privée de l'instance) — le chemin par défaut du module. Il crée de manière
  idempotente la base de données et l'utilisateur de l'application, accorde
  les privilèges et vérifie que l'utilisateur de l'application peut
  effectivement se connecter (ce qui réchauffe également le cache
  d'authentification côté serveur `caching_sha2_password` de MySQL 8). Peut être réexécuté
  en toute sécurité.
- **Job de migration explicite, pas d'auto-migration uniquement au démarrage.**
  Un job `migrate` distinct exécute `php /var/www/html/artisan migrate --force` (`depends_on_jobs = ["db-init"]`, `max_retries = 2`)
  afin que le schéma existe avant que la première révision ne serve le trafic.
  L'auto-migration au démarrage de l'image officielle, le cas échéant, est un
  filet de sécurité secondaire.
- **Mappage des variables d'environnement de la base de données aux noms Laravel
  (déjà corrigé, pas un piège).** `main.tf` code en dur `db_user_env_var_name = "DB_USERNAME"`, `db_name_env_var_name = "DB_DATABASE"` et
  `db_password_env_var_name =
  "DB_PASSWORD"`, et `SnipeIT_Common` définit `DB_CONNECTION = "mysql"` et `DB_PORT = "3306"`. Le socle injecte les
  informations d'identification de la base de données spécifiques au locataire
  directement sous ces noms natifs de Laravel — aucun alias de point d'entrée
  n'est nécessaire. Les variables `db_user_env_var_name`/`db_name_env_var_name`/`db_password_env_var_name` déclarées dans
  `variables.tf` sont inertes pour ce module (leurs valeurs sont ignorées
  silencieusement ; les littéraux ci-dessus l'emportent toujours).
- **`APP_KEY` est immuable après le premier démarrage.** Généré une fois
  (`random_password` + encodage base64 avec le préfixe `base64:` attendu par Laravel)
  et écrit dans Secret Manager. Sa régénération invalide toutes les sessions
  actives et toutes les données chiffrées par Snipe-IT avec l'ancienne clé.
- **Persistance de la session/cache/file d'attente.** `SnipeIT_Common` définit
  `SESSION_DRIVER =
  "database"`, `CACHE_DRIVER = "file"` et `QUEUE_DRIVER = "database"` afin que les sessions et les jobs en
  file d'attente survivent aux redémarrages d'instance même avec `max_instance_count = 1`.
- **`APP_URL` est dérivé automatiquement.** L'URL de service Cloud Run prédite
  (construite à partir de `module.deployment_id.service_name` — le nom spécifique à l'application, et
  non le `resource_prefix` spécifique au locataire, selon un commentaire explicite dans
  `main.tf` protégeant contre une boucle 404 de mauvais hôte) est passée
  comme `service_url` et injectée comme `APP_URL` lorsqu'elle n'est pas vide.
- **Pas d'inscription en libre-service ouverte.** Contrairement aux
  applications avec un flux d'inscription public, une nouvelle installation
  Snipe-IT redirige `/` vers l'assistant d'installation `/setup`, où le
  premier compte administrateur est créé de manière interactive. Une erreur
  dans `APP_URL`/l'hôte du service interrompt cette redirection.
- **Chemin de santé.** La sonde de démarrage par défaut est **TCP** sur le port
  du conteneur (délai initial de 30 s, période de 15 s, seuil d'échec de 20 —
  généreux pour permettre la configuration de la base de données au premier
  démarrage). La sonde de vivacité par défaut est **HTTP** `GET /` (délai
  initial de 300 s, période de 60 s, seuil d'échec de 3) — Snipe-IT sert sa
  page de connexion/configuration à `/` sans authentification,
  confirmant que l'application PHP et la connexion à la base de données sont
  saines.
- **`php_memory_limit`, `upload_max_filesize`, `post_max_size` sont acceptés mais non
  appliqués.** Ces variables sont déclarées pour la parité des conventions de
  l'interface utilisateur mais ne sont jamais référencées par la configuration
  de `SnipeIT_Common` — l'image préconstruite conserve ses propres paramètres PHP
  intégrés, quelles que soient ces valeurs.
- **Inspecter l'exécution du job et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Snipe-IT sont listés ; toute autre entrée est héritée de
[App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 1 — Projet et identité {#group-1--project--identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `project_id` | _(requis)_ | Projet Google Cloud cible. |
| `region` | `us-central1` | Région pour le service et les ressources régionales. |

### Groupe 2 — Environnement de déploiement {#group-2--deployment-environment}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `tenant_id` | `demo` | Suffixe court qui rend les noms de ressources uniques par environnement. |
| `support_users` | `[]` | E-mails auxquels sont accordés l'accès au projet et les alertes de surveillance. |
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `snipeit` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Snipe-IT` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Snipe-IT IT asset management on Cloud Run` | Description du service. |
| `application_version` | `v8-latest` | Tag de l'image officielle `snipe/snipe-it` ; épingler à une version spécifique en production. |
| `php_memory_limit` | `512M` | Accepté mais **non appliqué** — l'image préconstruite conserve sa propre configuration PHP. |
| `upload_max_filesize` / `post_max_size` | `64M` / `64M` | Accepté mais **non appliqué** à l'image préconstruite. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `prebuilt` | Déploie directement l'image officielle ; `"custom"` n'est pas le chemin pris en charge pour Snipe-IT. |
| `cpu_limit` | `1000m` | 1 vCPU minimum recommandé avec MySQL. |
| `memory_limit` | `2Gi` | Minimum 512 Mio ; 2 Gio recommandés pour la production. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro ; définir `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Maintenir à `1` sauf si le comportement de session/NFS multi-instance est vérifié. |
| `container_port` | `80` | Snipe-IT (Apache) écoute sur le port 80, et non sur le port 8080 par défaut de Cloud Run. |
| `execution_environment` | `gen2` | Requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **TCP par défaut** — délibéré pour cette application Laravel-mysql ; `true` monte le socket Auth Proxy à la place. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Docker Hub dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour les déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité des conventions ; non référencé par le déploiement de ce module. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour atteindre l'assistant de configuration public et l'interface utilisateur. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google avant d'accéder à l'application. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres supplémentaires non secrets. Les valeurs principales `APP_*`/`DB_*` sont définies automatiquement. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`,
`github_token`, `enable_cloud_deploy`, `enable_binary_authorization`. Généralement non utilisé puisque
Snipe-IT déploie l'image officielle préconstruite plutôt qu'un build
personnalisé.

### Groupe 9 — Initialisation personnalisée et scripts SQL {#group-9--custom-initialization--sql-scripts}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL
à partir d'un bucket GCS sur la base de données après le provisionnement. Voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner l'équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage du miroir Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{name_suffix="data"}]` | Buckets GCS supplémentaires au-delà du bucket `snipeit-uploads` auto-provisionné. |
| `enable_nfs` | `true` | Activé par défaut afin que les images/signatures/codes-barres d'actifs téléchargés persistent et soient partagés entre les instances. Maintenir activé. |
| `nfs_mount_path` | `/var/lib/snipeit` | Où Snipe-IT stocke les téléchargements et les données d'exécution. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `MYSQL_8_0` | Fixé par `SnipeIT_Common` quelle que soit la valeur — Snipe-IT nécessite MySQL. |
| `db_name` | `snipeit` | Nom de la base de données. Immuable après le premier déploiement. |
| `db_user` | `snipeit` | Utilisateur de la base de données de l'application. Mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé / `90` | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Déclaré pour la parité des conventions ; **inerte** pour ce module — `main.tf` code en dur le mappage Laravel-natif `DB_USERNAME`/`DB_DATABASE`/`DB_PASSWORD` directement et ne transmet pas ces variables. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser la chaîne de jobs intégrée `db-init` → `migrate`. |
| `cron_jobs` | `[]` | Transmis au socle ; vide par défaut car Snipe-IT n'a pas de tâche de maintenance planifiée intégrée. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, délai de 30 s, seuil d'échec de 20 | Généreux pour permettre la configuration de la base de données au premier démarrage. |
| `liveness_probe` | HTTP `/`, délai de 300 s, seuil d'échec de 3 | Confirme que l'application PHP et la connexion à la base de données sont saines. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut. |
| `alert_policies` | `[]` | Stratégies d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Activé par défaut pour le backend de cache de Laravel. |
| `redis_host` | `""` | Laisser vide pour utiliser la résolution standard du point de terminaison Redis de la plateforme. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées suivent le comportement standard de
[App_CloudRun](App_CloudRun.md).

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

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
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `migrate`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé**
> (service dégradé) — **Moyen** (coût ou dégradation partielle) — **Faible**
> (mineur).

> **Validation héritée au moment du plan.** Ce module transmet sa configuration
> via le moteur de base [App_CloudRun](App_CloudRun.md), qui valide les
> valeurs *et les combinaisons* au moment du plan — un réplica en lecture sans
> son primaire, IAP sans identités autorisées, un runtime `gen1` avec des
> montages NFS/GCS, un `redis_port`/`backup_retention_days` hors limites.
> Une configuration invalide fait échouer le **plan** avec une erreur claire et
> nommée avant la création de toute ressource, de sorte que la plupart des
> erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à
> l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `MYSQL_8_0` (fixe) | Critique | Snipe-IT nécessite MySQL ; `SnipeIT_Common` ignore les autres valeurs. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline toutes les données. |
| `APP_KEY` (auto-généré) | Ne jamais modifier après le premier démarrage | Critique | Sa régénération invalide toutes les sessions actives et toutes les données chiffrées avec l'ancienne clé. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `enable_cloudsql_volume` | `false` (TCP) | Élevé | C'est la valeur par défaut testée pour le client Laravel/MySQL de Snipe-IT ; passer à `true` monte le chemin du socket à la place mais n'a pas été vérifié par rapport à la configuration de la base de données Laravel de Snipe-IT pour ce module. |
| `enable_nfs` | `true` | Élevé | Le désactiver rend les images/signatures/codes-barres d'actifs téléchargés éphémères — isolés par instance et perdus au démarrage à froid. |
| `max_instance_count` | `1` | Élevé | Mettre à l'échelle au-delà de 1 sans un comportement vérifié de pilote de session/NFS partagé risque des téléchargements et une gestion de session incohérents. |
| `ingress_settings` | `all` | Élevé | La restriction à `internal` bloque l'assistant public `/setup` nécessaire pour créer le premier compte administrateur. |
| `container_port` | `80` | Élevé | L'Apache de Snipe-IT écoute sur le port 80 ; modifier cela sans une image personnalisée correspondante interrompt le routage. |
| `db_user_env_var_name` / `db_name_env_var_name` / `db_password_env_var_name` | Laisser tel quel | Faible | Ces variables sont inertes pour ce module — `main.tf` code en dur les noms Laravel natifs corrects quelle que soit leur valeur. |
| `php_memory_limit` / `upload_max_filesize` / `post_max_size` | N'importe quelle valeur | Faible | Acceptées mais non appliquées à l'image pré-construite — ne vous fiez pas à celles-ci pour modifier le comportement de PHP. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid à la première requête après l'inactivité. |
| `memory_limit` | `2Gi` | Moyen | Les valeurs proches du plancher de 512 Mio risquent des arrêts OOM lors d'importations/téléchargements d'actifs concurrents. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'assistant de configuration et l'interface utilisateur d'administration sont accessibles publiquement sans protection WAF. |

---

Pour le comportement de base référencé partout — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Snipe-IT partagée avec la variante GKE (image,
secret `APP_KEY`, jobs d'initialisation) est décrite dans `modules/SnipeIT_Common/README.md` — aucun
guide `docs/modules/SnipeIT_Common.md` autonome n'existe encore.

## Guides associés {#related-guides}

- [Lab pratique : SnipeIT sur Cloud Run](../labs/SnipeIT_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Snipe-IT sur GKE Autopilot](SnipeIT_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Snipe-IT Common — Configuration d'application partagée](SnipeIT_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [NetBox sur Google Cloud Run](Netbox_CloudRun.md), [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Homepage sur Google Cloud Run](Homepage_CloudRun.md) dans la solution **IT Asset & Infrastructure Records**.
