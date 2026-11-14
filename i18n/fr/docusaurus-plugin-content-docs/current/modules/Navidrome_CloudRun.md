---
title: "Navidrome sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Navidrome sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Navidrome_CloudRun.md @ 40c83c3f sha256:a349d5f7d509 -->

# Navidrome sur Google Cloud Run {#navidrome-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Navidrome_CloudRun.png" alt="Navidrome sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Navidrome est un serveur de streaming musical auto-hébergé, gratuit, open source
(GPLv3) et compatible Subsonic, écrit en Go. Il scanne une bibliothèque musicale,
la diffuse via une interface web rapide et utilise l'API Subsonic/OpenSubsonic
afin que tout client mobile ou de bureau compatible puisse en diffuser le
contenu. Ce module déploie Navidrome sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Navidrome et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run —
identité de service, entrée et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Navidrome sur RAD, et comparaison {#what-navidrome-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Navidrome sur RAD coûte environ 33 $ US par mois, les frais de module étant facturés une seule fois en crédits RAD.** Si vous avez besoin que Navidrome reste opérationnel en continu, qu'il s'adapte à plusieurs pods ou qu'il fonctionne avec d'autres charges de travail Kubernetes, consultez le [guide GKE](Navidrome_GKE.md) pour cette option. Si vous n'en avez besoin qu'occasionnellement — une démo, un projet saisonnier, quelque chose que vous évaluez — un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires au lieu de payer pour qu'il reste inactif. Voir **Mettre en pause gratuitement**, ci-dessous. Les chiffres sont ceux du 8 octobre 2026 ; les sources sont listées à la fin de cette section.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

RAD déploie **Navidrome**, qui est open source, il n'y a donc pas de frais de
licence par utilisateur. Vous payez pour trois choses :

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 40 crédits (4 $ US au prix de la recharge) | 36 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites, puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **33 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **23 crédits par jour**, soit environ 690 par mois (environ 69 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde acheté minimum est conservé en réserve |

Votre premier déploiement réussi sur RAD est exempt de frais de module, quel que soit le montant des frais : une fois par compte, pour un module que vous déployez et payez vous-même (dans une solution, les frais d'une application : la première à réussir ; jamais une session de lab ou un projet client).

10 crédits coûtent 1 $ US pour une recharge unique, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas un deuxième ensemble de ces éléments.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (chaud) | 13,14 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 33 $ US** |

### Comparaison {#how-it-compares}

- **Aucun SaaS géré clé en main n'a été vérifié pour Navidrome lui-même**, la comparaison honnête est donc un serveur auto-géré : un Hetzner CPX22 (2 vCPU/4 Go) coûte environ 24 $/mois, un DigitalOcean 2 vCPU/4 Go Droplet environ 24 $/mois, et un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) environ 49 $/mois.
- Il s'agit d'une charge de travail légère — une classe de VPS moins chère et plus petite que les boîtiers de référence ci-dessous ferait également l'affaire ; les chiffres sont présentés pour une comparaison équivalente.
- Il s'agit d'un serveur de musique personnel, pas d'un produit d'équipe avec un concurrent SaaS sous licence — la comparaison qui compte est l'auto-hébergement par vous-même par rapport à la gestion du projet par RAD, et non RAD par rapport à un abonnement de streaming (un service de streaming n'héberge pas *votre propre* bibliothèque).
- **Le prix du VPS n'est pas le coût total.** Sur un VPS nu, c'est vous qui appliquez les correctifs au système d'exploitation, faites tourner les sauvegardes et maintenez la base de données (le cas échéant) en bonne santé. Cloud SQL géré par RAD, Secret Manager et la surveillance s'en chargent pour vous, ce qui est le véritable argument en faveur de RAD par rapport à un boîtier moins cher — pas le prix affiché.

### Mettre en pause gratuitement : supprimer un projet géré par RAD, le restaurer quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Navidrome fonctionne dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimer
tout le projet et le restaurer dans les 30 jours pour presque rien.** Cela
convient bien mieux à Navidrome dont vous n'avez besoin qu'occasionnellement —
une démo, une évaluation, un projet saisonnier — que de le faire fonctionner en
continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration. Par conséquent, la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD dissocie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà dissociée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un seul module, cela ne détruit pas la VM ou la ressource de calcul une par une — tout le projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de restaurer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 69 $ US par mois pour le maintenir en fonctionnement.** Déployez Navidrome, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois et le temps pendant lequel Navidrome était réellement en ligne.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox, adapté à la plupart des utilisations d'étude et de démonstration). Google indique que la plupart des services sont de nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé Navidrome et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payer uniquement pendant l'utilisation, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre
propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de
payer est de supprimer le déploiement et de le redéployer lorsque vous en avez
besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) : 40 crédits (4,00 $ US) dans votre propre projet, ou 36 crédits dans un projet géré par RAD. La suppression permet d'économiser de l'argent une fois que Navidrome resterait inutilisé pendant environ 4 jours ou plus dans votre propre projet (environ 1,09 $ US par jour), ou environ 2 jours ou plus dans un projet géré par RAD (23 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et toute VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de Navidrome alors que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de la supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de Navidrome dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Navidrome pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, afin que personne ne reçoive de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.
- Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de récupération de 30 jours et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; frais RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Navidrome s'exécute comme un conteneur Go unique sur Cloud Run v2. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur de musique Go, 1 vCPU / 1 GiB par défaut, épinglé à une seule instance chaude |
| Persistance | Cloud Filestore (NFS) | Le répertoire `/data` (base de données SQLite, cache de métadonnées, index de recherche) est un partage NFS |
| Base de données | SQLite interne (embarquée) | Pas de Cloud SQL — Navidrome conserve tout l'état dans un fichier SQLite sous `/data` |
| Secrets | Secret Manager | Mot de passe `admin` généré (`ND_DEVAUTOCREATEADMINPASSWORD`) lorsque `enable_admin_password = true` |
| Entrée | URL Cloud Run / Cloud Load Balancing | `internal` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |
| Livraison d'images | Artifact Registry | L'image `deluan/navidrome` est mise en miroir avant le déploiement |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Il n'y a pas de base de données externe.** Navidrome stocke tout son état — la base de données SQLite, le cache de métadonnées et l'index de recherche — sous un seul répertoire `/data`. Aucune instance Cloud SQL, aucun job `db-init` et aucun Redis ne sont provisionnés (`database_type = NONE` ; `enable_redis = false`).
- **`/data` doit persister entre les révisions, sur NFS.** Cloud Run n'a pas de périphérique de bloc, et GCS FUSE ne peut pas héberger une base de données SQLite (pas de verrouillage POSIX ; il rejette les écritures désordonnées de SQLite). Ainsi, `enable_nfs = true` (par défaut) monte le volume NFS partagé à `/data` (`nfs_mount_path`), et le montage GCS FUSE du bucket `storage` y est désactivé chaque fois que NFS est activé. Sans `/data` persistant, chaque nouvelle révision démarre avec une bibliothèque vide et réexécute le scan et la configuration du premier démarrage.
- **Le conteneur écoute sur le port 4533.** Cloud Run achemine le trafic HTTP vers le port web/API par défaut de Navidrome. `GET /ping` renvoie `{"status":"ok"}` (200, non authentifié) une fois le serveur démarré.
- **Un compte administrateur généré par défaut.** `enable_admin_password = true` génère un mot de passe aléatoire de 24 caractères, le stocke dans Secret Manager et l'injecte en tant que `ND_DEVAUTOCREATEADMINPASSWORD` afin que l'utilisateur `admin` soit créé automatiquement au premier démarrage. Récupérez-le depuis Secret Manager et modifiez-le après la première connexion. Définissez `enable_admin_password = false` pour créer le premier administrateur via l'assistant web à la place.
- **Une seule instance chaude est la valeur par défaut.** `min_instance_count = 1` maintient le serveur chaud (évitant la latence de démarrage à froid en cours de diffusion) et `max_instance_count = 1` maintient une seule bibliothèque SQLite partagée sur un seul volume. **Ne pas exécuter plusieurs réplicas** — Navidrome est un serveur à écrivain unique ; des écrivains concurrents sur un seul fichier SQLite corrompent la bibliothèque.
- **La bibliothèque musicale n'est pas montée automatiquement.** `ND_MUSICFOLDER = /music` est défini, mais le module ne monte rien à cet endroit — fournissez la collection musicale via un montage `gcs_volumes` (ou NFS) à `/music`.
- **L'entrée publique nécessite le mot de passe administrateur généré.** Une protection au moment de la planification rejette `ingress_settings = "all"` à moins que `enable_admin_password = true` — sinon l'assistant de première exécution est ouvert à quiconque atteint l'URL en premier.

> **Cloud Run vs GKE — choisissez le bon emplacement pour votre bibliothèque.**
> **Cloud Run (ce module)** monte `/data` à partir du volume NFS partagé. C'est
> simple, exécute une seule instance chaude et convient à une démo ou à une petite
> bibliothèque personnelle ; le stockage réseau est plus lent qu'un périphérique de
> bloc pour le répertoire `/data`, très dépendant de SQLite. **[Navidrome_GKE](Navidrome_GKE.md)**
> s'exécute en tant que StatefulSet avec un véritable **PVC de bloc** à `/data`,
> offrant la sémantique de système de fichiers correcte dont la base de données
> SQLite embarquée a besoin — le choix recommandé pour une bibliothèque plus grande
> ou plus active, avec NFS optionnel pour une grande collection musicale.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de
services et de ressources sont indiqués dans les [Sorties](#5-outputs) du
déploiement.

### A. Cloud Run — le service Navidrome {#a-cloud-run--the-navidrome-service}

Navidrome s'exécute en tant que service Cloud Run v2. Comme la bibliothèque est
un seul magasin SQLite sur un seul volume, le service est épinglé à une seule
instance plutôt que d'être mis à l'échelle automatiquement. Chaque déploiement
crée une révision immuable ; le trafic peut être réparti entre les révisions
pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Stockage de données persistant (SQLite sur `/data`) {#b-persistent-data-store-sqlite-on-data}

Navidrome n'a **pas de base de données externe**. Tout son état — la base de
données SQLite, le cache de métadonnées et l'index de recherche — se trouve sous
`/data` (`ND_DATAFOLDER = /data`). Il n'y a pas d'instance Cloud SQL, pas de proxy
d'authentification et pas de job d'initialisation pour créer un schéma ;
Navidrome crée et migre sa propre base de données SQLite au premier démarrage.

Parce que tout ce qui est important est un fichier sous `/data`, la persistance
de ce répertoire **est** la persistance de l'ensemble du serveur. Sur Cloud Run,
il s'agit du partage NFS monté à `/data` (`enable_nfs = true`, `nfs_mount_path = "/data"`).

- **Inspecter le volume monté sur la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].volumeMounts)'
  ```

### C. Cloud Storage — le bucket `/data` (et la bibliothèque musicale) {#c-cloud-storage--the-data-bucket-and-music-library}

Un bucket **Cloud Storage** dédié (suffixe de nom `storage`) est provisionné
automatiquement. Il est monté à `/data` via **GCS FUSE** uniquement lorsque NFS
est désactivé (`enable_gcs_storage_volume = !enable_nfs`) — ce qui n'est pas recommandé, car SQLite ne peut pas
s'exécuter en toute sécurité sur GCS FUSE. Le bucket est de classe `STANDARD`,
`force_destroy = true`, sans versioning, avec `public_access_prevention = enforced`. La **bibliothèque musicale** à `/music`
n'est pas montée automatiquement — déclarez un volume GCS FUSE supplémentaire via
`gcs_volumes` (ou activez NFS) pointant vers votre collection musicale.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options de montage GCS FUSE et
CMEK.

### D. Secret Manager et le mot de passe administrateur {#d-secret-manager--the-admin-password}

Lorsque `enable_admin_password = true` (la valeur par défaut), la couche commune génère un mot de passe
aléatoire de 24 caractères, le stocke dans Secret Manager sous `secret-<prefix>-navidrome-admin-password`, et
l'injecte en tant que `ND_DEVAUTOCREATEADMINPASSWORD` afin que Navidrome crée automatiquement
l'utilisateur `admin` au premier démarrage. Il n'y a pas de clé de chiffrement ou
de secret JWT à gérer.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~navidrome-admin-password"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### E. Réseau et entrée {#e-networking--ingress}

Par défaut `ingress_settings = "internal"`, le service n'est donc accessible que depuis le VPC — ce qui
convient à un serveur de musique privé. Définissez `ingress_settings = "all"` pour une URL `run.app`
publique (nécessite `enable_admin_password = true`, appliquée au moment de la planification), ou ajoutez
un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor. Le contrôle d'égression VPC régit la connectivité sortante.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les journaux de conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run
sont envoyées à Cloud Monitoring, avec des tests de disponibilité et des
politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Navidrome {#3-navidrome-application-behaviour}

- **Pas de job d'initialisation.** Navidrome n'a pas besoin d'étape `db-init` — il
  crée et migre sa propre base de données SQLite sous `/data` la première fois
  qu'il démarre. Laissez `initialization_jobs` vide, sauf si vous avez des tâches de chargement
  de données personnalisées.
- **Création automatique de l'administrateur au premier démarrage.** Avec `enable_admin_password = true`,
  `ND_DEVAUTOCREATEADMINPASSWORD` est injecté et Navidrome crée l'utilisateur `admin` avec le mot de
  passe généré au premier démarrage. Connectez-vous en tant que `admin`,
  récupérez le mot de passe de Secret Manager et modifiez-le. Avec `enable_admin_password = false`, le
  premier accès affiche un **assistant de création d'administrateur** à la place —
  complétez-le immédiatement afin que personne d'autre ne puisse revendiquer le
  compte administrateur.
- **Le scan de la bibliothèque s'exécute au démarrage.** Navidrome scanne `ND_MUSICFOLDER`
  (`/music`) au démarrage et périodiquement ; une grande collection prend du temps
  à indexer dans la base de données SQLite et l'index de recherche sous `/data`.
- **`/data` est la seule source de vérité — persistez-la.** Tout l'état de la
  bibliothèque se trouve sur le volume `/data` sauvegardé par NFS. Changer `nfs_mount_path`
  ou désactiver NFS orpheline la base de données, les utilisateurs, les listes de
  lecture et les comptes de lecture. Limitez Cloud Run à une utilisation légère/personnelle
  et déplacez une bibliothèque plus grande vers la variante GKE block-PVC.
- **L'image personnalisée est un wrapper fin.** Le Dockerfile est `ARG NAVIDROME_VERSION=0.54.3` /
  `FROM deluan/navidrome:${NAVIDROME_VERSION}`, donc `image_source = "custom"` et la Fondation le met en miroir dans Artifact Registry
  (`enable_image_mirroring = true`). `application_version = "latest"` se résout à `0.54.3` épinglé via l'argument de build
  spécifique à l'application `NAVIDROME_VERSION` — il n'est **pas** écrasé par l'injection
  générique `APP_VERSION` de la Fondation.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `GET /ping`, qui
  renvoie `{"status":"ok"}` (200) sans authentification une fois le serveur prêt. La sonde
  de démarrage permet un délai initial de 15 secondes avec une fenêtre de
  nouvelle tentative généreuse ; la sonde de vivacité interroge toutes les 30
  secondes.
- **Inspecter l'image et l'environnement de la révision en cours d'exécution :**
  ```bash
  gcloud run services describe <service-name> \
    --region "$REGION" --project "$PROJECT" \
    --format='value(spec.template.spec.containers[0].image)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Navidrome sont listés ; toute autre entrée est héritée de
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
| `support_users` | `[]` | Adresses e-mail ayant accès au projet et aux alertes de surveillance. |
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `navidrome` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `application_display_name` | `Navidrome Music Server` | Nom lisible par l'homme affiché dans la console. |
| `description` | `Navidrome — self-hosted, Subsonic-compatible music streaming server` | Description du service. |
| `application_version` | `latest` | Tag de l'image Navidrome ; `latest` épingle à `0.54.3` via l'argument de build `NAVIDROME_VERSION`. |
| `enable_admin_password` | `true` | Génère un mot de passe `admin` aléatoire dans Secret Manager et injecte `ND_DEVAUTOCREATEADMINPASSWORD`. Requis pour l'entrée publique. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; augmentez pour le scan de grandes bibliothèques. |
| `memory_limit` | `1Gi` | Mémoire par instance ; Navidrome conserve son index de recherche en mémoire — dimensionnez-le en fonction de la bibliothèque. |
| `min_instance_count` | `1` | Gardez 1 pour rester chaud et éviter les démarrages à froid en cours de diffusion. |
| `max_instance_count` | `1` | **Gardez à 1.** Une seule bibliothèque SQLite partagée sur un seul volume — ne jamais exécuter plusieurs réplicas. |
| `container_port` | `4533` | Port web/API de Navidrome. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages GCS FUSE et NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | Navidrome n'a pas de Cloud SQL — laissez `false`. |
| `enable_image_mirroring` | `true` | Mettre en miroir `deluan/navidrome` dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |

### Groupe 5 — Contrôle d'accès et d'entrée {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `internal` maintient le serveur privé au sein du VPC ; `all` (public) nécessite `enable_admin_password = true`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via le VPC. |
| `enable_iap` | `false` | Exiger la connexion Google devant Navidrome. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres `ND_*` supplémentaires ; remplacez `ND_MUSICFOLDER` / `ND_DATAFOLDER` ici si vous remappez les volumes. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC) du bucket `/data`. |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer un instantané `/data` lors du déploiement (`tar` par défaut). |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`,
`enable_cloud_deploy`, `enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — **non applicable à Navidrome** (pas de base
de données SQL) ; conservé pour la compatibilité de la fondation. Héberge
également `nfs_instance_name` / `nfs_instance_base_name` pour la découverte NFS.

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | `7` / `true` / `30` | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Provisionner le bucket `/data` de Navidrome (créé automatiquement) et tout autre extra. |
| `storage_buckets` | `[]` | Buckets GCS supplémentaires au-delà du bucket `storage` provisionné automatiquement. |
| `enable_nfs` | `true` | Monte le volume NFS partagé à `/data` pour la base de données SQLite. Gardez-le activé — GCS FUSE ne peut pas héberger SQLite. |
| `nfs_mount_path` | `/data` | Chemin de montage à l'intérieur du conteneur. |
| `gcs_volumes` | `[]` | Montages GCS FUSE supplémentaires — utilisez-les pour monter la bibliothèque musicale à `/music`. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `NONE` | Fixé à `NONE` par Navidrome_Common — Navidrome utilise SQLite embarqué, pas de Cloud SQL. |
| `database_password_length` | `32` | Inerte ; transféré pour la compatibilité de la fondation. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | off | Non applicable — pas de base de données SQL. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Navidrome n'a pas besoin de job d'initialisation ; ne le fournissez que pour des tâches de chargement de données personnalisées. |
| `cron_jobs` | `[]` | Jobs Cloud Run optionnels pour les tâches de maintenance. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/ping` 15s de délai | Sonde de démarrage ; `/ping` renvoie `{"status":"ok"}` (200) une fois prêt. |
| `liveness_probe` | HTTP `/ping` 30s de délai | Sonde de vivacité. |
| `startup_probe_config` | HTTP `/ping` | Sonde de démarrage structurée alternative. |
| `health_check_config` | HTTP `/ping` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ path="/ping" }` | Test de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis (transmis pour la compatibilité de la fondation) {#group-21--redis-forwarded-for-foundation-compatibility}

`enable_redis` est défini sur `false` par ce module et Navidrome n'utilise pas de cache
ou de file d'attente ; `redis_host` / `redis_port` / `redis_auth` sont inertes. Laissez les
valeurs par défaut.

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | `[]` / `true` | CIDR de niveau d'accès / mode simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `navidrome_url` | URL du service pour l'interface web Navidrome / API Subsonic (interne au VPC lorsque `ingress_settings = internal`). |
| `service_location` | Région dans laquelle le service s'exécute. |
| `stage_services` | URL de service spécifiques à l'étape (Cloud Deploy). |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `storage_buckets` | Buckets Cloud Storage créés (y compris le bucket `/data`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (vide pour un déploiement Navidrome par défaut). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` / `project_number` | Identifiants de projet. |
| `cicd_enabled` / `github_repository_url` / `github_repository_owner` / `github_repository_name` / `cicd_configuration` | État et détails CI/CD. |
| `artifact_registry_repository` / `cloudbuild_trigger_name` / `cloudbuild_trigger_id` | Registre et déclencheur de build. |
| `vpc_sc_enabled` / `vpc_sc_perimeter_name` / `vpc_sc_dry_run_mode` | État VPC-SC. |
| `audit_logging_enabled` / `artifact_registry_cmek_enabled` | Journalisation d'audit et état CMEK. |

Le mot de passe administrateur généré n'est pas renvoyé en sortie ; récupérez-le
depuis Secret Manager (`secret-<prefix>-navidrome-admin-password`, voir §2 / §4.D).

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un runtime `gen1` avec des montages NFS/GCS, IAP sans identités autorisées, un `container_port`/`backup_retention_days`/`timeout_seconds` hors limites. Une protection spécifique à Navidrome rejette en outre `ingress_settings = "all"` sauf si `enable_admin_password = true`, et `min_instance_count > max_instance_count`. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `enable_nfs` / `nfs_mount_path` | `true` / `/data` | Critique | Le partage NFS à `/data` contient la base de données SQLite, les utilisateurs et les listes de lecture ; désactiver NFS place la base de données sur GCS FUSE, ce qui corrompt les écritures SQLite. |
| `max_instance_count` | `1` | Critique | Plusieurs réplicas écrivent dans un seul fichier SQLite et corrompent la bibliothèque. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `ingress_settings = "all"` sans `enable_admin_password` | garder le mot de passe admin activé | Critique | Bloqué au moment de la planification — une URL publique avec un assistant de première exécution ouvert permet à un inconnu de revendiquer le compte `admin`. |
| `execution_environment` | `gen2` | Élevé | La Gen1 ne peut pas monter NFS, donc `/data` ne persiste jamais. |
| `min_instance_count` | `1` | Élevé | Les démarrages à froid (scale-to-zero) interrompent les flux en cours et rouvrent la bibliothèque. |
| `memory_limit` | `1Gi` (augmenter pour les grandes bibliothèques) | Élevé | Navidrome conserve son index de recherche en mémoire ; trop peu de mémoire provoque des OOM-kills du serveur pendant le scan. |
| Montage `ND_MUSICFOLDER` | Fournir de la musique à `/music` | Élevé | Sans montage `gcs_volumes`/NFS à `/music`, la bibliothèque est vide — rien à diffuser. |
| `enable_admin_password` | `true` | Moyen | Désactivé, laisse un assistant de création d'administrateur ouvert lors du premier accès ; le compléter immédiatement ou restreindre l'ingestion. |
| `ingress_settings` | `internal` sauf si public | Moyen | `all` expose le serveur de musique à Internet — à coupler avec IAP ou Cloud Armor. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour récupérer un instantané de bibliothèque plus ancien. |
| Mot de passe admin généré | Changer après la première connexion | Moyen | Le mot de passe de démarrage se trouve dans Secret Manager ; le faire pivoter dans l'application pour les utilisateurs réels. |

---

Pour le comportement de base référencé partout — identité de service, mise à l'échelle et
concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Navidrome
partagée avec la variante GKE est décrite dans
**[Navidrome_Common](Navidrome_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Navidrome sur Cloud Run](../labs/Navidrome_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Navidrome sur GKE Autopilot](Navidrome_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Navidrome Common — Configuration d'application partagée](Navidrome_Common.md) — la configuration partagée par les deux cibles de déploiement.
