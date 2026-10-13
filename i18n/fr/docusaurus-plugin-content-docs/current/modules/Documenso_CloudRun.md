---
title: "Documenso sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Documenso sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Documenso_CloudRun.md @ e69407af sha256:67fa38e7679a -->

# Documenso sur Google Cloud Run {#documenso-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Documenso_CloudRun.png" alt="Documenso sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Documenso est une alternative open source à DocuSign — une application Next.js
pour l'envoi, la signature et la gestion de documents de signature
électronique sur une infrastructure que vous contrôlez. Ce module déploie
Documenso sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère
l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par Documenso et sur la
manière de les explorer et de les opérer depuis la console Google Cloud et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que Documenso coûte sur RAD, et comment cela se compare {#what-documenso-costs-on-rad-and-how-that-compares}

**Documenso sur le module Cloud Run de RAD coûte environ 83,61 $ US par mois sans licence par signataire.** Cela se compare à 25 $ US par mois pour le plan Individuel de Documenso ou 40 $ US par mois pour son plan Équipes (5 utilisateurs, 8 $ US par utilisateur supplémentaire). Un serveur autogéré est moins cher en espèces, mais vous devez alors gérer vous-même la base de données, les sauvegardes, les correctifs de sécurité et les mises à niveau. GKE Autopilot convient aux Documenso qui doivent rester opérationnels en permanence ou s'adapter à travers les pods ; pour le coût le plus bas, ce module Cloud Run vous offre déjà l'option la moins chère — consultez le [guide GKE](Documenso_GKE.md) si vous avez besoin de l'autre. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour une poignée de crédits, de sorte que ces 83,61 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 75 crédits (7,50 $ US au prix de la recharge) | 67,5 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **83,61 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 par mois (environ 96 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins sur un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 2 Gio (scaleToZero) | 13,16 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 83,61 $ US** |

### Comment cela se compare {#how-it-compares}

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Documenso, plan Individuel | 25 $ US par mois | Documenso |
| Documenso, plan Équipes (5 utilisateurs) | 40 $ US par mois | Documenso |
| **RAD, Cloud Run, votre propre projet** | **Environ 83,61 $ US** | Automatisation de RAD, dans votre projet |
| **RAD, Cloud Run, un projet géré par RAD** | **Environ 96 $ US** | RAD |

- Les plans hébergés de Documenso facturent par mois, quel que soit le nombre de documents que vous signez réellement ; le coût de RAD est celui de l'infrastructure, qui est le même que vous envoyiez une enveloppe par mois ou cent.
- Le plan gratuit de Documenso vous limite à 5 documents par mois — le module de RAD exécute le même logiciel open source sans limite de documents.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Documenso s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à Documenso dont vous n'avez besoin qu'occasionnellement — pour des études, une démo, une activité saisonnière — que de le faire fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant qu'il attend. Contrairement à la suppression d'un seul module, cela ne démolit pas Cloud SQL, la VM NFS ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture plus jamais les frais de module. Cela coûte **une poignée de crédits (moins de 1 $ US)** au total pour une chaîne de déploiement typique de la taille de Documenso, contre les 72 crédits (7,20 $ US) que coûte un redéploiement complet.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 83,61 $ US.** Déployez Documenso, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous le souhaitez, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et les heures pendant lesquelles Documenso était réellement en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet que vous apportez et dont RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier sandbox que la plupart des études et démos utilisent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé les données et souhaitez les conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le flux de travail de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 80 crédits (7,95 $ US), et environ une heure, car RAD recrée le projet et les services partagés avant Documenso. La suppression permet d'économiser de l'argent une fois que Documenso resterait inutilisé pendant environ **3 jours ou plus** dans votre propre projet (environ 2,79 $ US par jour), ou environ **2 jours ou plus** dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Documenso utilise.** La majeure partie du coût d'exécution est la base de données et la VM NFS/cache. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de Documenso.
- **Conservez d'abord vos données.** Les sauvegardes nocturnes de la base de données sont écrites dans un bucket à l'intérieur du déploiement, et ce bucket est supprimé avec lui. Avant de supprimer, copiez la dernière sauvegarde sur Google Drive, ou sur un bucket que vous conservez.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit Documenso dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute Documenso pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais propres à RAD et estimations de crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes et la fenêtre de pause/restauration. [Prix Documenso](https://documenso.com/pricing) pour les chiffres des plans Individuel et Équipes ;

## 1. Vue d'ensemble {#1-overview}

Documenso s'exécute comme un conteneur Next.js unique sur Cloud Run v2, construit à partir d'une
image personnalisée légère basée sur l'image officielle `documenso/documenso`. Le
déploiement relie un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Conteneur Next.js sur le port 3000, 1 vCPU / 2 Gio par défaut ; autoscaling sans serveur, mise à l'échelle à zéro prise en charge |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — le moteur est fixé à `POSTGRES_15` ; MySQL n'est pas pris en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut, monté à `/mnt/nfs`, mais non utilisé pour le stockage de documents (voir ci-dessous) |
| Stockage d'objets | Cloud Storage | Un bucket `uploads` + compte de service HMAC, provisionné pour le transport de téléchargement compatible S3 optionnel |
| Secrets | Secret Manager | `NEXTAUTH_SECRET`, `NEXT_PRIVATE_ENCRYPTION_KEY`, `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` auto-générés, clés HMAC, et (optionnellement) mot de passe SMTP ; mot de passe de base de données |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé via Cloud Armor |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type = "POSTGRES_15"` est la
  valeur par défaut. La pile Next.js + Prisma de Documenso ne prend pas en charge MySQL, mais —
  contrairement à certains autres modules — ce n'est **pas appliqué par une
  précondition au moment du plan** ni au niveau `Documenso_CloudRun` ni au niveau
  `App_CloudRun` ; changer `database_type` pour autre chose que Postgres
  casse silencieusement l'application à l'exécution plutôt que de faire échouer le plan.
- **Build personnalisé, pas pré-construit.** `container_image_source = "custom"` construit une
  image légère `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` qui
  ajoute `bash`, `curl`, `postgresql-client`, et `openssl`, plus un
  point d'entrée personnalisé. Le propre `sh start.sh` de l'image officielle exécute les
  migrations Prisma et démarre le serveur Next.js — il n'y a pas de job de migration séparé.
- **Cloud SQL est atteint via un socket Unix, pas un proxy TCP.** `enable_cloudsql_volume
  = true` monte le proxy d'authentification Cloud SQL comme un socket de domaine Unix à
  `/cloudsql` ; le point d'entrée assemble `NEXT_PRIVATE_DATABASE_URL` à partir des
  valeurs `DB_*` injectées, en se basant sur le chemin du socket, le proxy
  `127.0.0.1` (GKE uniquement), ou l'IP directe+SSL selon ce qui est injecté.
- **Redis n'est pas requis, et la variable `enable_redis` propre au module est
  effectivement décorative.** Documenso utilise un fournisseur de jobs locaux basé sur PostgreSQL,
  il ne lit donc jamais `REDIS_HOST`/`REDIS_PORT`. Plus important encore,
  les variables `Documenso_CloudRun` de `enable_redis`/`redis_host`/`redis_port`/`redis_auth`
  sont transmises uniquement à `Documenso_Common` (qui ne les utilise pas non plus) et ne
  sont **jamais** passées à l'appel de fondation `App_CloudRun` dans
  `main.tf`. Le propre `enable_redis` de la fondation **par défaut à `true`**, donc
  `REDIS_HOST`/`REDIS_PORT` (pointant vers l'IP du serveur NFS, puisque `enable_nfs`
  est également activé par défaut) sont injectés dans chaque déploiement Documenso
  indépendamment du paramètre `enable_redis` de ce module — inoffensif car
  Documenso les ignore, mais bon à savoir si vous auditez les variables d'environnement.
- **NFS est activé par défaut mais Documenso ne l'utilise pas pour les documents.**
  Les documents sont stockés dans PostgreSQL par défaut
  (`NEXT_PUBLIC_UPLOAD_TRANSPORT = "database"`). L'instance Filestore ainsi provisionnée est facturée
  qu'elle soit écrite ou non.
- **Un certificat de signature est requis pour la signature réelle de documents.**
  `NEXT_PRIVATE_SIGNING_TRANSPORT = "local"` attend un certificat `.p12`. Si
  aucun n'est fourni, le point d'entrée auto-génère un certificat auto-signé jetable
  afin que l'application démarre — mais la signature avec celui-ci n'est pas
  sûre pour la production.
- **`webapp_url` est vide par défaut.** Tant qu'il n'est pas défini, `NEXTAUTH_URL` et
  `NEXT_PUBLIC_WEBAPP_URL` sont par défaut à `http://localhost:3000` ; le point d'entrée
  les met à niveau automatiquement vers le `CLOUDRUN_SERVICE_URL` injecté par la plateforme
  au démarrage, mais la définition explicite de `webapp_url` est recommandée une fois qu'une URL ou un domaine stable est connu.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0`,
  `max_instance_count = 1`. Les démarrages à froid ajoutent de la latence à la première requête
  après l'inactivité.
- **La sonde de démarrage est TCP, la sonde de vivacité est désactivée.** Documenso n'expose pas de
  point de terminaison de santé dédié, donc la sonde de démarrage se base sur la liaison de port
  plutôt que sur un chemin HTTP, et la sonde de vivacité est désactivée pour éviter
  de redémarrer en boucle un conteneur sain.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de services et de ressources
sont rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Documenso {#a-cloud-run--the-documenso-service}

Documenso s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement en fonction de la charge de requêtes
entre le nombre minimal et maximal d'instances. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs,
  et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement
d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Documenso stocke toutes les données de l'application (utilisateurs, documents, destinataires, événements d'audit)
dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service
se connecte en privé via le **proxy d'authentification Cloud SQL** sur un socket Unix ; aucune
IP publique n'est exposée. Lors du premier déploiement, le job `db-init` crée le
rôle et la base de données de l'application ; l'image officielle de Documenso exécute ensuite ses propres
migrations Prisma au démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~documenso"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Storage et persistance des fichiers {#c-cloud-storage--file-persistence}

Un bucket **Cloud Storage** dédié (suffixe `uploads`, compatible CORS pour
un accès direct depuis le navigateur) et un compte de service détenant une **clé HMAC** sont
provisionnés automatiquement, accordant au compte de service de stockage `roles/storage.objectAdmin`
sur le bucket. Il s'agit d'une infrastructure optionnelle : Documenso n'y écrit que si
vous définissez `NEXT_PUBLIC_UPLOAD_TRANSPORT=s3` et connectez les variables d'environnement secrètes
`S3_ACCESS_KEY` / `S3_SECRET_KEY` — par défaut, les documents sont stockés dans
PostgreSQL. Séparément, un volume **NFS (Cloud Filestore)** est monté à
`/mnt/nfs` mais n'est pas écrit par l'application dans sa configuration
par défaut.

- **Console :** Cloud Storage → Buckets ; Filestore → Instances.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~documenso"
  gcloud storage ls gs://<uploads-bucket>/        # bucket name is in the Outputs
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### D. Secret Manager {#d-secret-manager}

Documenso nécessite trois secrets au démarrage — `NEXTAUTH_SECRET`,
`NEXT_PRIVATE_ENCRYPTION_KEY` et `NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY` —
tous validés par Zod par l'application Next.js, qui ne démarrera pas sans eux.
De plus, `S3_ACCESS_KEY` / `S3_SECRET_KEY` (informations d'identification HMAC, utilisées uniquement si
le transport de téléchargement S3 est activé) et, lorsque `smtp_host` est défini,
`NEXT_PRIVATE_SMTP_PASSWORD` sont générés. Le mot de passe de la base de données est géré
séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~documenso"
  gcloud secrets versions access latest --secret=<nextauth-secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### E. Réseau et ingress {#e-networking--ingress}

Le service est accessible par son URL `run.app` par défaut, ce qui permet un accès public.
Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et
Cloud Armor peuvent être superposés ; les paramètres d'ingress et la sortie VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### F. Cloud Logging et Monitoring {#f-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à
Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte optionnelles.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Documenso {#3-documenso-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il attend que Cloud SQL accepte les connexions, puis
  crée de manière idempotente le rôle et la base de données de l'application (privilège `CREATEDB`,
  propriété définie sur la base de données cible), accorde les privilèges de schéma,
  et enfin signale le sidecar du proxy d'authentification Cloud SQL (`POST
  /quitquitquit`) afin que le job puisse se terminer. Le job peut être réexécuté en toute sécurité
  (`execute_on_apply = true`, `max_retries = 3`).
- **Les migrations s'exécutent automatiquement, pas de job séparé.** Le propre `start.sh` de l'image officielle de Documenso exécute les migrations Prisma contre
  `NEXT_PRIVATE_DATABASE_URL` à chaque démarrage de conteneur, puis lance le
  serveur autonome Next.js.
- **`NEXT_PRIVATE_DATABASE_URL` est assemblé au démarrage.** Le point d'entrée personnalisé
  le construit à partir de `DB_USER`/`DB_PASSWORD`/`DB_HOST`/
  `DB_NAME`/`DB_PORT` injectés par la plateforme, en fonction de si `DB_HOST` est un chemin de socket Unix
  (le cas normal de Cloud Run, `enable_cloudsql_volume = true`), une boucle de proxy d'authentification
  `127.0.0.1` (GKE uniquement), ou une IP directe (auquel cas
  `sslmode=require` est forcé). `NEXT_PRIVATE_DIRECT_DATABASE_URL` le reflète.
- **Trois secrets sont immuables en pratique.** `NEXTAUTH_SECRET` et les deux
  clés de chiffrement sont validées par Zod au démarrage et générées une seule fois dans Secret
  Manager. `NEXTAUTH_SECRET` peut être tourné (invalide les sessions) ;
  `NEXT_PRIVATE_ENCRYPTION_KEY` ne doit jamais être régénéré sur place — ne tournez
  que via l'emplacement de la clé secondaire.
- **Pas de compte administrateur de démarrage.** Ce module ne crée pas d'utilisateur
  administrateur/propriétaire Documenso. La première personne à s'inscrire via l'interface
  web de l'application devient le propriétaire du compte — comportement standard de Documenso en amont,
  non provisionné par ce module.
- **Le certificat de signature est une étape post-déploiement requise pour une signature réelle.**
  Sans certificat fourni, le point d'entrée auto-génère un certificat auto-signé jetable
  `.p12` à `/opt/documenso/cert.p12` afin que l'application démarre et que
  les fonctionnalités non liées à la signature fonctionnent, en affichant un avertissement fort. Pour la signature en production,
  fournissez un vrai certificat via `secret_environment_variables` mappant
  `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (`.p12` encodé en base64) et
  `NEXT_PRIVATE_SIGNING_PASSPHRASE`.
- **Résolution d'URL de l'application web.** `NEXTAUTH_URL` / `NEXT_PUBLIC_WEBAPP_URL` par défaut
  à `http://localhost:3000`. Si toujours à cette valeur par défaut lorsque le conteneur
  démarre, le point d'entrée écrase les deux avec le
  `CLOUDRUN_SERVICE_URL` injecté par la plateforme. Définissez `webapp_url` explicitement une fois que l'URL Cloud Run
  ou un domaine personnalisé est connu afin que les rappels OAuth/e-mail restent stables entre
  les redéploiements.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 3000 (délai initial de 30s,
  période de 20s, 10 échecs autorisés) — elle réussit dès que le conteneur
  lie son port, car l'alternative HTTP nécessiterait une préparation complète de l'application+DB
  et risquerait de ne jamais passer. La sonde de vivacité est **désactivée** par
  défaut ; Documenso n'a pas de point de terminaison de santé dédié.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la plateforme de déploiement
(correspondant à la balise `{{UIMeta group=N}}` de chaque variable dans `variables.tf`). Seuls
les paramètres spécifiques ou notables pour Documenso sont listés ; toutes les autres entrées sont
héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

### Groupe 0 — Métadonnées du module {#group-0--module-metadata}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `module_description` / `module_documentation` / `module_dependency` / `module_services` | _(défini)_ | Texte de la liste du catalogue et ordre des dépendances. Lu par la plateforme, non appliqué par Terraform. |
| `requires_services` | `{ create_postgres = true, create_network_filesystem = true, ... }` | Indique à la plateforme quels commutateurs `Services_GCP` `create_*` activer lors de son auto-provisionnement pour ce module. |
| `credit_cost` / `require_credit_purchases` | `75` / `false` | Métadonnées de facturation de la plateforme. |
| `enable_purge` | `true` | Permet la suppression complète des ressources lors de la destruction. |
| `public_access` | `true` | Liste le module dans le catalogue public. |
| `require_services_gcp_module` | `true` | Une fonctionnalité `App_CloudRun` — fait échouer le plan si aucun VPC `Services_GCP` n'existe — mais cette variable n'est **pas transmise** à `App_CloudRun` ici, elle n'a donc aucun effet au niveau de ce module. |
| `shared_users` | `[]` | **Activement appliquée par la plateforme** (contrairement à la plupart des variables du Groupe 0) : les utilisateurs listés ici obtiennent l'accès quelle que soit la valeur de `public_access`. |
| `technical_support_users` | `[]` | Acheminer les demandes de support pour ce module vers ces utilisateurs. |
| `resource_creator_identity` | `rad-module-creator@YOUR_PLATFORM_PROJECT.iam.gserviceaccount.com` | Compte de service que Terraform utilise pour créer des ressources ; transmis à `App_CloudRun`. |
| `impersonation_service_account` / `job_execution_wait_timeout` / `module_writable_secret_ids` | `""` / `900` / `{}` | Déclaré pour la parité de convention ; **non transmis** nulle part dans `main.tf` — la définition de l'une de ces valeurs n'a aucun effet. |

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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `documenso` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Documenso` | Nom lisible par l'homme affiché dans la Console. |
| `description` | `Documenso - The Open Source DocuSign Alternative` | Description du service. |
| `application_version` | `latest` | Définit l'argument de build `DOCUMENSO_VERSION` pour l'image de base `FROM docker.io/documenso/documenso:${DOCUMENSO_VERSION}` de build personnalisé. |
| `webapp_url` | `""` | URL publique de l'instance. Définie après le premier déploiement (ou une fois qu'un domaine personnalisé est enregistré) afin que les rappels NextAuth et les liens e-mail soient stables. Tant qu'elle n'est pas définie, le point d'entrée met à niveau `localhost:3000` vers le `CLOUDRUN_SERVICE_URL` en direct à chaque démarrage. |
| `application_display_name` / `application_description` | (Valeurs par défaut de la fondation) | Miroirs de convention de fondation de `display_name`/`description`. **Déclaré mais non transmis** — utilisez `display_name`/`description` à la place. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit l'image wrapper légère via Cloud Build. `prebuilt` déploie directement l'image officielle (pas de point d'entrée, donc `NEXT_PRIVATE_DATABASE_URL` et le fallback du certificat de signature ne seraient pas assemblés). |
| `container_image` | `""` | Remplace l'URI de l'image ; laissez vide pour utiliser l'image Documenso intégrée. |
| `container_build_config` | `{ enabled = true }` | Configuration Cloud Build ; `Documenso_Common` fournit `dockerfile_path`/`context_path`/`build_args` (`DOCUMENSO_VERSION`). |
| `cpu_limit` | `1000m` | 1 vCPU par instance. |
| `memory_limit` | `2Gi` | Mémoire par instance ; le plancher de la génération 2 de Cloud Run est de 512 Mio quel que soit le mode de facturation. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Plafond de coût ; Documenso n'a pas de mise en garde documentée multi-instances comme Listmonk/Activepieces, mais augmentez avec prudence. |
| `container_port` | `3000` | Port du serveur Next.js de Documenso. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0–3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Doit être défini `true`** pour le chemin de connexion DB du socket Unix par défaut du point d'entrée ; le module livre cette valeur par défaut `false` contrairement à la plupart des modules basés sur une base de données (voir [Pièges](#6-configuration-pitfalls--sensible-defaults)). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Documenso dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `container_protocol` | `http1` | `http1` ou `h2c`. Documenso n'a pas besoin de texte clair HTTP/2. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Chemin du conteneur pour le socket Unix du proxy d'authentification Cloud SQL ; pertinent uniquement lorsque `enable_cloudsql_volume = true`. |
| `service_annotations` / `service_labels` | `{}` | Annotations/étiquettes de service Cloud Run avancées. |
| `container_resources` | `{ cpu_limit = "1000m", memory_limit = "512Mi" }` | Miroir de convention de fondation de `cpu_limit`/`memory_limit`. **Déclaré mais non transmis** — utilisez ceux-ci à la place. |
| `additional_containers` / `additional_services` | `[]` | Conteneurs sidecar / services Cloud Run supplémentaires. **Déclaré mais non transmis à `App_CloudRun`** — aucun sidecar ou service supplémentaire n'est déployé par ce module, quels que soient ces paramètres. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Accès, réseau et e-mail {#group-5--access-networking--email}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all`, `internal`, ou `internal-and-cloud-load-balancing`. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `prereq_subnet_cidr_override` | `""` | Remplacement du CIDR du sous-réseau primaire VPC inline, pertinent uniquement lorsqu'aucun réseau `Services_GCP` n'existe. Laissez vide pour dériver automatiquement un `/24` unique. |
| `smtp_host` | `""` | Nom d'hôte du serveur SMTP. Laissez vide pour désactiver l'e-mail (invitations, notifications de signature). |
| `smtp_port` / `smtp_secure_enabled` | `587` / `false` | Utilisez `465` + `true` pour TLS implicite, sinon STARTTLS sur `587`. |
| `smtp_user` | `""` | Nom d'utilisateur d'authentification SMTP. |
| `smtp_password` | `""` | Génère automatiquement une valeur Secret Manager lorsqu'il est laissé vide et que `smtp_host` est défini. |
| `mail_from` | `""` | Adresse de l'expéditeur ; revient à `noreply@documenso.local` lorsque `smtp_host` est défini mais que cette valeur est vide. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Clés de remplacement SMTP (`EMAIL_SMTP_*`) | Jeu de valeurs par défaut restantes du modèle partagé du module ; Documenso lui-même lit les noms `NEXT_PRIVATE_SMTP_*` assemblés à partir des variables `smtp_*` du Groupe 5, pas ces clés `EMAIL_SMTP_*` — la définition directe de celles-ci n'a aucun effet sur le mailer de Documenso. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. **C'est ici que vous connectez un vrai certificat de signature** : `NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS` (`.p12` encodé en base64) et `NEXT_PRIVATE_SIGNING_PASSPHRASE`. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |
| `backup_file` | `backup.sql` | Miroir de convention de fondation du nom de fichier de sauvegarde. **Déclaré mais non transmis** — utilisez `backup_uri` à la place. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `github_app_installation_id`,
`cicd_trigger_config`, `enable_cloud_deploy`, `cloud_deploy_stages`,
`enable_binary_authorization`.

| Variable | Valeur par défaut | Description |
|---|---|---|
| `binauthz_evaluation_mode` | `ALWAYS_ALLOW` | Mode d'application lorsque `enable_binary_authorization` est vrai et que `Services_GCP` n'a pas préconfiguré une politique. Non référencé — n'a aucun effet sur le déploiement dans ce module. |

### Groupe 9 — Scripts SQL personnalisés et ciblage d'instances NFS {#group-9--custom-sql-scripts--nfs-instance-targeting}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_custom_sql_scripts` / `custom_sql_scripts_bucket` / `custom_sql_scripts_path` / `custom_sql_scripts_use_root` | désactivé | Exécuter SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md). |
| `nfs_instance_name` | `""` | Cibler directement une VM GCE NFS existante au lieu d'en découvrir une automatiquement. |
| `nfs_instance_base_name` | `app-nfs` | Nom de base pour une VM NFS inline lorsqu'aucune n'est trouvée. |
| `nfs_volume_name` | `nfs-data-volume` | Nom du volume Kubernetes/Cloud Run pour le montage NFS. Ne remplacer que pour un deuxième partage NFS avec un nom de volume distinct. |

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour l'équilibreur de charge HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | un bucket `data` | Remplacé en pratique : `documenso.tf` fournit le bucket `uploads` réel (compatible CORS) via la sortie `storage_buckets` de `Documenso_Common`, et non la valeur par défaut de cette variable. |
| `enable_nfs` | `true` | Provisionne Filestore par défaut. Non utilisé pour le stockage de documents — voir [Vue d'ensemble](#1-overview). |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur (non utilisé par la configuration par défaut de l'application). |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2). |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | **Non validé par le plan à aucun niveau** — le fait de modifier cette valeur pour autre chose que Postgres rompt le schéma Prisma de Documenso à l'exécution plutôt que de faire échouer `tofu plan`. |
| `db_name` | `documenso` | La base de données réellement créée et injectée sous le nom `DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `documenso` | Le rôle réellement créé et injecté sous le nom `DB_USER` ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `sql_instance_name` / `sql_instance_base_name` | `""` / `app-sql` | Cible une instance Cloud SQL existante ou nomme une instance inline. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | `""` | Déclaré pour la parité de convention mais **non transmis** nulle part dans `main.tf` ou `documenso.tf` — la définition de l'une de ces valeurs n'a aucun effet. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Miroirs de convention de fondation de `db_name`/`db_user`. **Déclaré mais non transmis** — utilisez `db_name`/`db_user` à la place. |
| `db_password_env_var_name` | `""` | Nom de variable d'environnement supplémentaire pour exposer le mot de passe de la base de données à côté de `DB_PASSWORD`. **Déclaré mais non transmis** — n'a aucun effet. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Installer des plugins MySQL après le provisionnement. Documenso est uniquement PostgreSQL et aucune des deux variables n'est transmise — n'a aucun effet. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Installer des extensions PostgreSQL après le provisionnement. **Déclaré mais non transmis** — n'a aucun effet pour ce module. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré fourni par `Documenso_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme n'est définie pour Documenso. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 3000, `initial_delay_seconds=30`, `failure_threshold=10` | Sonde spécifique à Documenso transmise via la sortie `config` de `Documenso_Common`. TCP plutôt que HTTP car aucun point de terminaison HTTP ne signale de manière fiable une préparation complète sans risquer une sonde en échec permanent. |
| `liveness_probe` | `enabled = false` | Désactivé — une sonde HTTP contre `/` redémarrerait en boucle un conteneur sain avant que l'application ne soit prête. |
| `startup_probe_config` | désactivé | Sonde structurée alternative (désactivée par défaut ; `startup_probe` prend effet). |
| `health_check_config` | HTTP `/` | Sonde de vivacité structurée alternative. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité Cloud Monitoring ; désactivée par défaut. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Redis / File d'attente de jobs {#group-21--redis--job-queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `false` | **Non transmis à `App_CloudRun`.** Uniquement passé à `Documenso_Common`, qui ne le référence pas non plus — cette variable n'a aucun effet sur le service déployé. Documenso utilise un fournisseur de jobs locaux basé sur PostgreSQL et ne lit jamais `REDIS_HOST`. Le propre `enable_redis` de la fondation (par défaut `true`, non exposé ici) injecte toujours `REDIS_HOST`/`REDIS_PORT` indépendamment — voir [Vue d'ensemble](#1-overview). |
| `redis_host` / `redis_port` / `redis_auth` | `""` / `6379` / `""` | Même mise en garde — inerte au niveau de ce module. |
| `cubejs_api_url` | `http://localhost:4000` | Reste inerte du modèle de variable partagé à partir duquel ce module a été cloné (URL de l'API Cube.js — pas un concept Documenso) ; non lu par aucun Dockerfile, point d'entrée ou mappage d'environnement dans ce module. |
| `hub_api_url` | `http://localhost:8080` | Idem — reste inerte, non lu nulle part dans ce module. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation. |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (si activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (via le socket Auth Proxy) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (le bucket `uploads`). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | Statut de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration au moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — `min_instance_count > max_instance_count`, IAP activé sans identités autorisées, un runtime `gen1` avec des montages NFS/GCS, un `redis_port`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource. `Documenso_CloudRun` lui-même n'ajoute pas de `validation.tf` supplémentaires au-delà des vérifications par variable dans `variables.tf` — donc `database_type` loin de Postgres n'est **pas** détecté à quelque niveau que ce soit, seulement à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | Non validé au moment de la planification par ce module ou la fondation — le passage à MySQL/SQL Server rompt Prisma et chaque requête à l'exécution. |
| Certificat de signature (`NEXT_PRIVATE_SIGNING_LOCAL_FILE_CONTENTS`) | Fournir un vrai `.p12` après le déploiement | Critique | Sans cela, le point d'entrée auto-signe un certificat jetable — les documents "signent" mais la signature n'est pas fiable pour les lecteurs PDF ; non sûr pour la production. |
| `NEXT_PRIVATE_ENCRYPTION_KEY` / `_SECONDARY_KEY` (auto-généré) | Ne jamais modifier directement | Critique | Ceux-ci chiffrent les données Documenso ; ne les faites pivoter que via l'emplacement de la clé secondaire, jamais en régénérant la clé primaire sur place. |
| `enable_cloudsql_volume` | `true` | Critique | Par défaut `false` dans ce module, mais la branche de connexion DB par défaut du point d'entrée attend le socket Unix du proxy d'authentification Cloud SQL à `/cloudsql`. Laisser ceci `false` tout en s'appuyant sur le chemin de connexion par défaut peut empêcher l'application d'atteindre la base de données via un socket. |
| `db_name` / `db_user` | Définir une fois | Élevé | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `webapp_url` | Définir une fois que l'URL/le domaine est connu | Élevé | Laissé non défini, `NEXTAUTH_URL`/`NEXT_PUBLIC_WEBAPP_URL` suivent ce que `CLOUDRUN_SERVICE_URL` résout à chaque démarrage ; une valeur explicite maintient les rappels d'authentification et les liens e-mail stables lors des redéploiements. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans un `backup_uri` valide fait échouer le job d'importation. |
| `db_host_env_var_name` / `db_user_env_var_name` / `db_name_env_var_name` / `db_port_env_var_name` / `service_url_env_var_name` | Laisser non défini | Faible | Déclarés mais jamais transmis à aucun module — les définir n'a aucun effet. |
| `enable_redis` / `redis_host` / `redis_port` / `redis_auth` | Laisser tel quel | Faible | Non transmis à `App_CloudRun` ; le propre `enable_redis` de la fondation (par défaut `true`, non exposé par ce module) injecte `REDIS_HOST`/`REDIS_PORT` de toute façon — Documenso les ignore de toute façon, il s'agit donc d'un piège de documentation, pas d'un risque fonctionnel. |
| `cubejs_api_url` / `hub_api_url` | Laisser par défaut | Faible | Restes inertes du modèle de variable partagé ; Documenso ne les lit jamais. |
| `environment_variables` par défaut (clés `EMAIL_SMTP_*`) | Utiliser `smtp_host`/`smtp_user`/etc. à la place | Moyen | Les clés `EMAIL_SMTP_*` dans la carte par défaut ne sont pas lues par Documenso — configurer l'e-mail via les variables `smtp_*` du groupe 5, qui sont traduites en `NEXT_PRIVATE_SMTP_*` par `Documenso_Common`. |
| `min_instance_count` | `1` pour la production | Moyen | La mise à l'échelle à zéro (`0`) ajoute un délai de démarrage à froid lors de la première requête après l'inactivité. |
| `enable_nfs` | `true` (par défaut) ou `false` si non nécessaire | Moyen | Filestore est facturé que l'application y écrive ou non ; Documenso n'utilise pas le montage NFS dans sa configuration par défaut. |
| `smtp_host` | Définir pour la production | Moyen | Laissé vide, aucune variable `NEXT_PRIVATE_SMTP_*` n'est injectée — aucun e-mail d'invitation ou de notification de signature n'est envoyé. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `container_image_source` | `custom` (par défaut) | Élevé | Le passage à `prebuilt` déploie directement l'image officielle, en ignorant le point d'entrée personnalisé qui assemble `NEXT_PRIVATE_DATABASE_URL`, résout l'URL de l'application web et auto-génère un certificat de signature de secours. |

---

Pour le comportement de la fondation référencé tout au long — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud
Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir
d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration
d'application spécifique à Documenso partagée avec la variante GKE (secrets,
le job `db-init` et le point d'entrée personnalisé) est définie dans `Documenso_Common`
(source du module : `modules/Documenso_Common`).

## Guides associés {#related-guides}

- [Lab pratique : Documenso sur Cloud Run](../labs/Documenso_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Documenso sur GKE Autopilot](Documenso_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [Documenso Common — Configuration d'application partagée](Documenso_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé aux côtés de [OpenProject sur Google Cloud Run](OpenProject_CloudRun.md), [Cal.com sur Google Cloud Run](CalCom_CloudRun.md), [Kimai sur Google Cloud Run](Kimai_CloudRun.md), [Invoice Ninja sur Google Cloud Run](InvoiceNinja_CloudRun.md) dans la solution **Professional Services Automation**.
