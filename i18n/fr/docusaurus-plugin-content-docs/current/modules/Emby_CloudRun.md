---
title: "Emby sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Emby sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Emby_CloudRun.md @ e69407af sha256:aa0df7345fea -->

# Emby sur Google Cloud Run {#emby-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Emby_CloudRun.png" alt="Emby sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Emby est un serveur multimédia auto-hébergé pour organiser et diffuser vos
propres films, émissions de télévision, musique et photos, avec des
applications clientes pour la plupart des téléviseurs, téléphones et
navigateurs. La lecture de base, la diffusion sans transcodage et l'assistant
de configuration sont gratuits — aucune clé de licence ou compte emby.media
n'est requis pour démarrer ou naviguer. Emby Premiere, un module complémentaire
payant acheté séparément dans l'application, permet le transcodage
accéléré par le matériel, les applications mobiles/TV complètes, le DVR/TV en
direct et la synchronisation hors ligne ; cela diffère de Jellyfin (également
dans ce catalogue), un fork communautaire du code source original d'Emby Server
qui est entièrement open source sans niveau payant équivalent. Ce module
déploie Emby sur **Cloud Run v2** sur la base de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Emby utilise et sur la façon
de les explorer et de les exploiter depuis la Google Cloud Console et la ligne
de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Emby sur RAD, et comparaison {#what-emby-costs-on-rad-and-how-that-compares}

**Le module Cloud Run d'Emby sur RAD coûte environ 19,14 $ US par mois.** Un
serveur autogéré est moins cher en espèces, mais vous devez alors gérer le
système d'exploitation, les correctifs de sécurité et les mises à niveau
vous-même. GKE Autopilot convient à Emby qui doit rester opérationnel en
continu ou s'adapter à plusieurs pods ; pour le coût le plus bas, ce module
Cloud Run vous offre déjà l'option la moins chère — consultez le
[guide GKE](Emby_GKE.md) si vous avez besoin de l'autre. Les chiffres sont
ceux du 8 octobre 2026 ; les sources sont énumérées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — études, démo, entreprise
saisonnière — un projet géré par RAD peut être supprimé et restauré dans les
30 jours pour une poignée de crédits, de sorte que 19,14 $ US deviennent
quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Le même |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **19,14 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **9 crédits par jour**, environ 270 par mois (environ 27 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par toutes les applications du projet, de
sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix
catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 Gio (chaud) | 13,14 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 19,14 $ US** |

### Comparaison {#how-it-compares}

- Emby ne vend pas d'hébergement — il n'y a pas de "Emby Cloud" à comparer —
  donc la comparaison d'hébergement honnête est un VPS nu : la propre valeur
  par défaut d'Emby est plus légère que la classe de 2 vCPU à ~24 $/mois que
  ces fournisseurs citent, donc un niveau plus petit et moins cher des mêmes
  fournisseurs est suffisant.
- Séparément, et sur **tout** hôte, y compris RAD : la lecture de base d'Emby
  est gratuite, mais **Emby Premiere** — transcodage accéléré par le
  matériel, applications mobiles/TV complètes, DVR/TV en direct,
  synchronisation hors ligne — est un module complémentaire payant à 4,99 $ US
  par mois, 54 $ US par an, ou 119 $ US une fois pour une licence à vie. Ce
  coût est le même, qu'Emby fonctionne sur RAD, un VPS ou une machine de
  rechange à la maison.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Emby fonctionne dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro :
**supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour
presque rien.** Cela convient bien à Emby dont vous n'avez besoin
qu'occasionnellement — études, démo, entreprise saisonnière — bien mieux que
de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne
  supprime pas le projet immédiatement : il le conserve, récupérable, pendant
  30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant
  qu'il attend. Contrairement à la suppression d'un module, cela ne supprime
  pas Cloud Run ou son réseau un par un — l'ensemble du projet, et tout ce
  qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande
  à Google de restaurer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour
  confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes — c'est une vérification, pas une reconstruction, et une mise à
  jour ne facture jamais les frais de module à nouveau. Cela coûte **une
  poignée de crédits (moins de 1 $ US)** au total pour une chaîne de
  déploiement typique de la taille d'Emby, contre les 40 crédits (4,05 $ US)
  que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 19,14 $ US.** Déployez Emby, utilisez-le pendant un certain temps,
  supprimez le projet. Restaurez-le la prochaine fois que vous en avez
  besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez
  terminé. Vous ne payez les frais de module qu'une seule fois, les builds,
  et les heures pendant lesquelles Emby était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que
  vous apportez et dont RAD ne gère que la facturation), et vous le restaurez
  vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre
  solde de crédits achetés doit toujours dépasser le seuil du niveau (100
  crédits pour le niveau sandbox que la plupart des utilisations d'étude et de
  démo conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable écart à vérifier.** Tout ce que vous avez pointé Emby pour
  votre bibliothèque multimédia — si elle se trouve dans le propre stockage de
  ce déploiement plutôt que dans une bibliothèque externe — suivez la même
  règle qu'ailleurs : copiez tout ce qui est irremplaçable avant de
  supprimer, car les objets Cloud Storage sans suppression logicielle activée
  ne survivent pas de manière fiable à une suppression de projet, même si le
  projet lui-même le fait.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

La valeur par défaut de Cloud Run d'Emby maintient une instance chaude plutôt
que de la mettre à l'échelle à zéro, afin d'éviter les délais de démarrage à
froid lorsque vous ouvrez l'application. L'option ci-dessus ne s'applique
qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la
fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le
déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 44 crédits (4,45 $ US), et environ une heure, car RAD
  recrée le projet et les services partagés avant Emby. La suppression
  permet d'économiser de l'argent une fois qu'Emby resterait inutilisé
  pendant environ **7 jours ou plus** dans votre propre projet (environ
  0,64 $ US par jour), ou environ **5 jours ou plus** dans un projet géré
  par RAD (9 crédits par jour).
- **Supprimez tout ce qu'Emby utilise.** La configuration par défaut d'Emby
  ne contient pas de base de données ou de VM séparée, donc sa suppression
  arrête immédiatement la quasi-totalité de ses propres coûts
  d'exécution.
- **Conservez d'abord vos données.** Vérifiez tout stockage que vous avez
  attaché pour votre bibliothèque multimédia et la propre configuration
  d'Emby avant de supprimer — le module lui-même ne contient aucune base de
  données nécessitant une exportation séparée.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour
  vous ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient Emby dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation fixée
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute Emby pour un client à partir d'un portefeuille cloisonné qu'il
  finance, et règle directement avec le client. Si le portefeuille est faible,
  la facturation est suspendue et les données sont conservées, de sorte que
  personne ne reçoit de frais inattendus. À la fin, le partenaire remet le
  projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ;
[Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour les mécanismes et la fenêtre de pause/restauration.
[Tarification Emby Premiere](https://emby.media/premiere.html) pour les
chiffres de licence du module complémentaire ;

## 1. Vue d'ensemble {#1-overview}

Emby s'exécute comme un conteneur unique sur Cloud Run v2. Le déploiement
relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur multimédia, 1 vCPU / 1 Gio par défaut, épinglé à une seule instance chaude |
| Persistance | Cloud Storage + GCS FUSE | Le répertoire `/config` (bases de données SQLite, métadonnées, plugins) est sauvegardé par un bucket GCS |
| Base de données | SQLite interne (embarquée) | Pas de Cloud SQL — Emby conserve tout l'état dans des fichiers SQLite sous `/config` |
| Secrets | Secret Manager | Clé API facultative auto-générée ; pas de secrets cryptographiques obligatoires |
| Entrée | URL Cloud Run / Cloud Load Balancing | `internal` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |
| Livraison d'images | Artifact Registry | L'image `emby/embyserver` est mise en miroir avant le déploiement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Emby stocke l'intégralité de sa
  bibliothèque — les bases de données SQLite, la configuration, les
  métadonnées, les illustrations, les plugins, le cache de transcodage et les
  journaux — sous un seul répertoire `/config`. Aucune instance Cloud SQL,
  aucun job `db-init` et aucun Redis ne sont provisionnés (`database_type = NONE`).
- **`/config` doit persister entre les révisions.** Sur Cloud Run, le chemin
  `/config` est sauvegardé par un bucket Cloud Storage monté via **GCS
  FUSE** (`enable_gcs_storage_volume = true`). Sans `/config` persistant, chaque nouvelle
  révision démarre avec une bibliothèque vide et réexécute l'assistant de
  première exécution.
- **Le conteneur écoute sur le port 8096.** Cloud Run achemine le trafic HTTP
  vers le port web/API par défaut d'Emby. L'interface utilisateur web et
  l'assistant de configuration de première exécution sont servis à
  `/web` (et `/`). Contrairement à Jellyfin, Emby n'a **pas de
  point de terminaison de santé HTTP non authentifié confirmé et documenté**
  — un test de conteneur en direct a révélé que `/health` renvoie
  `404` tandis que `/` répond `302` à l'assistant de
  configuration — de sorte que les deux sondes utilisent par défaut une
  vérification **TCP** sur le port 8096 au lieu d'un chemin HTTP supposé.
- **Il n'y a pas d'identifiants par défaut.** Lors du premier accès,
  l'assistant de configuration vous guide pour créer le compte
  administrateur et ajouter des bibliothèques multimédias. Rien n'est
  utilisable tant que ce compte n'existe pas.
- **Une seule instance chaude est la valeur par défaut.** `min_instance_count = 1` maintient
  le serveur multimédia chaud (évitant les latences de démarrage à froid en
  milieu de flux) et `max_instance_count = 1` maintient une seule bibliothèque SQLite
  partagée sur un seul volume. **Ne pas exécuter plusieurs réplicas** — des
  écritures concurrentes sur un seul fichier SQLite corrompent la
  bibliothèque.
- **Cloud Run est idéal pour une utilisation légère/de démonstration.** La
  latence de GCS FUSE et le modèle d'exécution sans état de Cloud Run avec
  délai d'expiration des requêtes rendent cette variante bien adaptée à
  l'évaluation et à une utilisation personnelle légère — mais **pas** au
  transcodage lourd ou à de nombreux flux simultanés. Pour une véritable
  bibliothèque multimédia, déployez [Emby_GKE](Emby_GKE.md) avec un PVC de
  bloc.
- **L'authentification par clé API est facultative et désactivée par
  défaut.** `enable_api_key = false`. L'authentification principale est le compte
  administrateur créé par l'assistant ; les clés API par application sont
  créées dans l'application sous **Dashboard → API Keys**. La valeur
  Secret Manager générée est injectée en tant que `EMBY_API_KEY` — pour les
  opérateurs qui souhaitent un identifiant stable à transmettre aux clients
  API externes, pas quelque chose qu'Emby lui-même lit au démarrage.
- **Emby Premiere est un niveau payant séparé et facultatif.** Cela n'a
  aucune incidence sur le succès du déploiement de ce module ou sur le
  fonctionnement de la diffusion en continu de base — cela ne fait que
  restreindre les fonctionnalités facultatives du client/DVR/transcodage
  matériel que l'opérateur peut déverrouiller plus tard.

> **Cloud Run vs GKE — choisissez le bon emplacement pour votre
> bibliothèque.**
> **Cloud Run (ce module)** monte `/config` à partir d'un bucket GCS via FUSE.
> C'est simple, cela s'adapte à une seule instance chaude, et c'est idéal
> pour une démo ou une petite bibliothèque personnelle avec une diffusion en
> lecture directe occasionnelle. La latence d'E/S de FUSE et le modèle de
> délai d'expiration par requête le rendent peu adapté au transcodage en
> direct ou à la diffusion multi-utilisateur intense.
> **[Emby_GKE](Emby_GKE.md)** s'exécute en tant que StatefulSet avec un
> véritable **PVC de bloc** à `/config`, offrant une sémantique de système de
> fichiers correcte pour SQLite et le cache de transcodage — le choix
> recommandé pour un serveur multimédia de production, avec NFS facultatif
> pour les grandes bibliothèques multimédias.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms
de services et de ressources sont signalés dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Emby {#a-cloud-run--the-emby-service}

Emby s'exécute en tant que service Cloud Run v2. Comme la bibliothèque est un
stockage SQLite unique sur un seul volume, le service est épinglé à une
instance plutôt que d'être mis à l'échelle automatiquement. Chaque
déploiement crée une révision immuable ; le trafic peut être réparti entre
les révisions pour des déploiements sûrs.

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

### B. Stockage de configuration persistant (SQLite sur `/config`) {#b-persistent-configuration-store-sqlite-on-config}

Emby n'a **pas de base de données externe**. Son état complet — la
bibliothèque SQLite et les bases de données de lecture, la configuration, les
métadonnées et les illustrations mises en cache, les plugins installés, le
cache de transcodage et les journaux — se trouve sous `/config`
(`EMBY_CONFIG_DIR = /config`). Il n'y a pas d'instance Cloud SQL, pas de proxy
d'authentification et pas de job d'initialisation pour créer un schéma ; Emby
crée et migre ses propres bases de données SQLite au premier démarrage.

Parce que tout ce qui est important est un fichier sous `/config`, la
persistance de ce répertoire **est** la persistance de l'ensemble du
serveur. Sur Cloud Run, il est sauvegardé par un bucket Cloud Storage (voir
ci-dessous).

- **Inspecter la configuration montée sur la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — le bucket `/config` {#c-cloud-storage--the-config-bucket}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est
provisionné automatiquement et monté à `/config` via **GCS FUSE**
(`enable_gcs_storage_volume = true`, environnement d'exécution gen2). Le bucket est de classe
`STANDARD`, `force_destroy = true`, la gestion de versions est désactivée, avec
`public_access_prevention = enforced`. Des buckets supplémentaires peuvent être déclarés via
`storage_buckets`.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS FUSE et
CMEK.

### D. Configuration initiale et bibliothèque multimédia {#d-first-run-setup--the-media-library}

Lors du premier accès, Emby sert un **assistant de configuration** interactif
à `/web` (et `/`) qui crée le compte administrateur, définit la
langue préférée et vous permet d'ajouter des bibliothèques multimédias
(films, télévision, musique, photos). Rien n'est authentifié ou utilisable
tant que vous n'avez pas terminé l'assistant — il n'y a pas d'identifiants par
défaut.

Les bibliothèques multimédias pointent vers des chemins à l'intérieur du
conteneur. Sur Cloud Run, les médias sont servis à partir du volume
`/config` monté ou de montages GCS FUSE supplémentaires ; pour les grandes
bibliothèques multimédias, préférez la variante GKE avec stockage de bloc ou
NFS.

- **Accéder à l'assistant / à l'interface web :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(status.url)'
  # open <url>/web in a browser (requires ingress=all or an LB/IAP path)
  ```

### E. Secret Manager et la clé API facultative {#e-secret-manager--the-optional-api-key}

Emby ne nécessite **aucun secret cryptographique obligatoire** — il n'y a pas
de clé de chiffrement, de JWT ou de mot de passe maître à gérer. Lorsque
`enable_api_key = true`, le module génère une valeur aléatoire de 32 caractères et la
stocke dans Secret Manager en tant que `secret-<prefix>-<app>-api-key`, injectée dans le
conteneur en tant que `EMBY_API_KEY`. Emby lui-même n'a pas de variable
d'environnement qui consomme cela au démarrage — la seule façon d'obtenir une
clé API utilisable dans Emby est dans l'application sous **Dashboard → API
Keys** ; ce secret existe en tant qu'identifiant stable, sauvegardé par Secret
Manager, que les opérateurs peuvent référencer en externe. L'authentification
principale reste le compte administrateur de l'assistant.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### F. Réseau et entrée {#f-networking--ingress}

Par défaut `ingress_settings = "internal"`, le service n'est donc accessible que depuis le VPC
— ce qui convient à un serveur multimédia privé. Définissez `ingress_settings = "all"`
pour une URL publique `run.app`, ou ajoutez un équilibreur de charge HTTPS
externe avec un domaine personnalisé, Cloud CDN et Cloud Armor. Le contrôle
d'égression du VPC régit la connectivité sortante.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run sont acheminées vers Cloud Monitoring, avec des vérifications de
disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Emby {#3-emby-application-behaviour}

- **Pas de job d'initialisation.** Emby n'a pas besoin d'étape `db-init` — il
  crée et migre ses propres bases de données SQLite sous `/config` la
  première fois qu'il démarre. Laissez `initialization_jobs` vide, sauf si vous avez
  des tâches de chargement de données personnalisées.
- **L'assistant de première exécution crée l'administrateur.** L'assistant de
  configuration `/web` vous guide pour créer le compte administrateur et
  ajouter des bibliothèques. Tant qu'il n'est pas terminé, le serveur n'a pas
  d'utilisateurs ni de contenu.
- **`/config` est la seule source de vérité — persistez-la.** Tout l'état de
  la bibliothèque se trouve sur le volume `/config` sauvegardé par GCS. La
  suppression ou la redirection de ce bucket efface la bibliothèque, les
  plugins et les utilisateurs. Comme GCS FUSE n'est pas un véritable système
  de fichiers POSIX, limitez Cloud Run à une utilisation légère/de
  démonstration et déplacez une vraie bibliothèque vers la variante GKE avec
  PVC de bloc.
- **L'image personnalisée est un wrapper léger.** Le Dockerfile est
  `ARG EMBY_VERSION=4.10.0.15` / `FROM emby/embyserver:${EMBY_VERSION}`, donc `image_source = "custom"` et la fondation le
  met en miroir dans Artifact Registry (`enable_image_mirroring = true`). `application_version = "latest"` se
  résout en `4.10.0.15` épinglé via l'argument de build
  `EMBY_VERSION` spécifique à l'application — il n'est **pas** écrasé par
  l'injection générique `APP_VERSION` de la fondation. Une vérification
  locale `docker build` + `docker run` a confirmé que l'image démarre
  proprement avec seulement `EMBY_CONFIG_DIR` et atteint la logique de démarrage
  réelle d'Emby Server.
- **Pas de chemin de santé dédié — sondes TCP.** Les sondes de démarrage et
  de vivacité utilisent toutes deux une vérification **TCP** sur le port
  8096, qui passe dès que l'écouteur d'Emby se lie. Un test en direct a
  confirmé que `/health` renvoie `404` (pas de tel point de
  terminaison) tandis que `/` répond `302` à l'assistant de
  configuration — excluant un chemin HTTP comme cible de la sonde,
  contrairement à Jellyfin qui documente un `/health` fonctionnel.
- **Le transcodage est gourmand en CPU et sans GPU.** Cloud Run n'a pas de
  GPU, alors préférez les clients de lecture directe. Augmentez la taille de
  `cpu_limit` pour le transcodage en direct et de `memory_limit` pour les
  grandes bibliothèques.
- **Inspecter l'image et les montages de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Emby sont listés ; toutes les autres entrées sont héritées de
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
| `application_name` | `emby` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Emby Media Server` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service, y compris la note de licence Premiere. |
| `application_version` | `latest` | Tag d'image Emby ; `latest` épingle à `4.10.0.15` via l'argument de build `EMBY_VERSION` spécifique à l'application. |
| `enable_api_key` | `false` | Générer une clé API aléatoire dans Secret Manager (`EMBY_API_KEY`). Recommandé pour tout déploiement accessible en dehors du VPC. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmenter pour le transcodage en direct. |
| `memory_limit` | `1Gi` | Mémoire par instance ; augmenter pour les grandes bibliothèques. |
| `min_instance_count` | `1` | Garder 1 pour rester chaud et éviter les démarrages à froid en milieu de flux. |
| `max_instance_count` | `1` | **Garder à 1.** Une seule bibliothèque SQLite partagée sur un seul volume — ne jamais exécuter plusieurs réplicas. |
| `container_port` | `8096` | Port web/API d'Emby. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE et NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0-3600 secondes). |
| `enable_cloudsql_volume` | `false` | Emby n'a pas de Cloud SQL — laisser `false`. |
| `container_protocol` | `http1` | HTTP/1.1 ; `h2c` uniquement pour HTTP/2 en clair. |
| `enable_image_mirroring` | `true` | Mettre en miroir `emby/embyserver` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Inerte dans ce module ; la fondation gère la rétention des révisions. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `internal` | `internal` maintient le serveur privé au VPC ; définir `all` pour une URL publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Emby. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires injectés dans la révision. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC) du bucket `/config`. |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané `/config` lors du déploiement (valeur par défaut `tar`). |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`,
`custom_sql_scripts_use_root` — **non applicable à Emby** (pas de base de données SQL) ;
conservé pour la compatibilité de la fondation. Héberge également
`nfs_instance_name` / `nfs_instance_base_name` pour la découverte NFS.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket Emby `/config` (créé automatiquement) et tout supplément. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `false` | Provisionner Cloud Filestore (NFS) ; activer pour les grandes bibliothèques multimédias partagées. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages de volume GCS FUSE supplémentaires (le bucket `/config` est ajouté automatiquement). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Emby_Common — Emby utilise SQLite embarqué, pas Cloud SQL. |
| `database_password_length` | `32` | Inerte ; transmis pour la compatibilité de la fondation. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Non applicable — pas de base de données SQL. |
| `db_*_env_var_name` / `service_url_env_var_name` | `""` | Alias de variables d'environnement supplémentaires facultatifs ; laisser vide pour Emby. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Emby n'a pas besoin de job d'initialisation ; fournir uniquement pour les tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run facultatifs pour les tâches de maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP 8096, délai de 15s | Sonde de démarrage ; TCP car Emby n'a pas de chemin de santé confirmé. |
| `liveness_probe` | TCP 8096, délai de 30s | Sonde de vivacité. |
| `startup_probe_config` | `{ enabled = true }` | Sonde de démarrage structurée alternative. |
| `health_check_config` | `{ enabled = true }` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false }` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 23 — VPC Service Controls et journalisation d'audit {#group-23--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retourné lors d'un déploiement réussi — le moyen le plus rapide de localiser et
d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `emby_url` | URL du service pour l'interface web / API Emby (interne au VPC lorsque `ingress_settings = internal`). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/config`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, vérifications de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour un déploiement Emby par défaut). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un `gen1` runtime avec des montages NFS/GCS, IAP sans identités autorisées, un `container_port`/`backup_retention_days`/`timeout_seconds` hors limites. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant qu'aucune ressource ne soit créée, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'application ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `/config` bucket GCS | Ne jamais supprimer/repointer | Critique | Le bucket `/config` contient la bibliothèque SQLite, les utilisateurs et les métadonnées ; le supprimer efface l'intégralité du serveur. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans un seul fichier SQLite via FUSE et corrompent la bibliothèque. |
| `enable_backup_import` | `false` sauf restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `execution_environment` | `gen2` | Élevé | La Gen1 ne peut pas monter GCS FUSE, donc `/config` ne persiste jamais. |
| `min_instance_count` | `1` | Élevé | Les démarrages à froid (cold-starts) de la mise à l'échelle à zéro interrompent les flux en cours et rechargent la bibliothèque. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Élevé | Trop peu de mémoire provoque des OOM-kills du serveur lors de la numérisation ou du transcodage d'une grande bibliothèque. |
| `cpu_limit` | `1000m` (augmenter pour le transcodage) | Élevé | Le transcodage en direct sur Cloud Run (pas de GPU) sature le CPU ; préférer la lecture directe. |
| Transcodage lourd / nombreux flux | Utiliser [Emby_GKE](Emby_GKE.md) | Élevé | La latence de GCS FUSE et les délais d'attente des requêtes Cloud Run rendent Cloud Run peu adapté au streaming intensif. |
| Type `startup_probe`/`liveness_probe` | `TCP` (par défaut) | Élevé | Un chemin HTTP `/health` supposé renvoie une erreur 404 sur Emby (vérifié en direct) — une sonde HTTP ici ne passerait jamais. |
| `ingress_settings` | `internal` sauf public | Moyen | `all` expose le serveur multimédia à Internet — coupler avec IAP ou Cloud Armor. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer un instantané de bibliothèque plus ancien. |
| Assistant de première exécution | Compléter immédiatement | Moyen | Un serveur non configuré n'a pas d'administrateur ; quiconque y accède peut revendiquer le compte administrateur. |
| `enable_api_key` | Comprendre qu'il est réservé à l'opérateur | Faible | Emby lui-même ne lit jamais `EMBY_API_KEY` au démarrage — créer des clés API in-app sous Tableau de bord → Clés API pour une authentification REST Emby réelle. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Emby
partagée avec la variante GKE est décrite dans
**[Emby_Common](Emby_Common.md)**. Pour une présentation guidée, voir le
[lab Emby_CloudRun](../labs/Emby_CloudRun.md).

## Guides associés {#related-guides}

- [Lab pratique : Emby sur Cloud Run](../labs/Emby_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Emby sur GKE Autopilot](Emby_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Emby Common — Configuration d'application partagée](Emby_Common.md) — la configuration partagée par les deux cibles de déploiement.
