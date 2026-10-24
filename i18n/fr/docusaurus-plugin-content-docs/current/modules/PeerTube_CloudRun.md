---
title: "PeerTube sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de PeerTube sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/PeerTube_CloudRun.md @ e69407af sha256:9fa6c17864da -->

# PeerTube sur Google Cloud Run {#peertube-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/PeerTube_CloudRun.png" alt="PeerTube sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

PeerTube est une plateforme d'hébergement vidéo open-source, fédérée par
ActivityPub — une alternative auto-hébergée à YouTube où des instances
opérées indépendamment se suivent et fédèrent des vidéos, des commentaires et
des chaînes entre elles (et le reste du Fediverse) de la même manière que
Mastodon fédère les publications. Ce module déploie PeerTube sur **Cloud Run
v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui
provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud utilisés par PeerTube et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à chaque application Cloud Run
— identité de service, ingress et équilibrage de charge, mise à l'échelle et
concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte PeerTube sur RAD, et comment cela se compare {#what-peertube-costs-on-rad-and-how-that-compares}

**Pour une seule instance, le module Cloud Run de PeerTube sur RAD coûte environ 99 $ US par mois, sans licence par utilisateur.** PeerTube est géré par des opérateurs indépendants plutôt que vendu comme un SaaS commercial unique ; un serveur auto-géré est moins cher en espèces que RAD, mais vous gérez alors vous-même la croissance du stockage, les sauvegardes, les correctifs de sécurité et les mises à niveau. Les chiffres sont à jour au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour étudier en vue d'une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que les 99 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 crédits par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US lors d'une recharge ponctuelle, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 2 Gio (scaleToZero) | 28,37 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 99 $ US** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ; la VM coûte environ 10 % de plus.
- **La mise à l'échelle à zéro est la valeur par défaut.** La ligne Cloud Run ci-dessus reflète déjà ce coût ; le réglage `min_instance_count = 1` maintient une instance chaude et augmente cette ligne, en échange de l'absence de démarrages à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 Tio, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- PeerTube est géré par des opérateurs indépendants plutôt que vendu comme un SaaS commercial unique, il n'y a donc pas de prix de fournisseur unique à citer ici ; la comparaison se fait plutôt avec un serveur nu.
- Un VPS nu dimensionné de manière similaire à l'empreinte de PeerTube — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $/mois, ou un GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) à environ 49 $/mois — est moins cher en espèces que l'un ou l'autre des chiffres RAD ci-dessus, et le stockage/l'egress vidéo est facturé séparément dans tous les cas.
- Le stockage d'objets de RAD basé sur Cloud Storage, les sauvegardes Cloud SQL et la file d'attente de jobs Redis sont gérés pour vous ; sur un VPS nu, la croissance du stockage, les sauvegardes et la file d'attente de transcodage sont votre propre travail.
- Si PeerTube doit rester actif sans mise à l'échelle à zéro, ou fonctionner aux côtés d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](PeerTube_GKE.md) — environ 143 $ US par mois dans votre propre projet, ou 3 240 crédits (environ 259 à 324 $ US) par mois dans un projet géré par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si PeerTube s'exécute dans **un projet géré par RAD pour vous**, vous avez une
deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez
l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.**
Cela convient bien mieux à une utilisation occasionnelle — étudier pour une
certification, un environnement de démonstration, une activité saisonnière —
qu'à l'exécution continue de PeerTube.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ni les ressources qu'il contient, sera utilisable après sa restauration : la restauration ne peut donc pas servir de moyen fiable de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application, stockées en dehors du projet. Si la restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa
  facturation, puis demande à Google de supprimer le projet. Google ne supprime pas
  le projet immédiatement : il le conserve, récupérable, pendant 30 jours. La
  facturation étant déjà déliée, rien n'est facturé pendant cette attente. Contrairement
  à la suppression d'un module, cela ne détruit pas Cloud SQL, aucune VM ou Cloud Run
  un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.** Dans les
  30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de
  récupérer le projet et de rattacher son compte de facturation, puis vous demande
  d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu.
  Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes
  ressources déjà présentes — c'est une vérification, pas une reconstruction, et une
  mise à jour ne facture plus jamais les frais de module. Cela coûte une poignée de
  crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les
  115 crédits (11,50 $ US) que coûte un redéploiement complet ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 99 $ US.**
  Déployez PeerTube, utilisez-le un certain temps, supprimez le projet. Restaurez-le la
  prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à
  nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une fois,
  les builds, et le temps réel d'activité de PeerTube.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet
  "apportez votre propre" pour lequel RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement.
  La restauration est admise comme la création d'un nouveau projet : votre solde de
  crédits achetés doit toujours dépasser le seuil du palier (100 crédits pour le palier
  sandbox qui convient à la plupart des utilisations d'étude et de démonstration). Google
  indique que la plupart des services sont à nouveau pleinement fonctionnels dans les
  36 heures suivant une restauration.
- **Un véritable manque : le bucket de sauvegarde ne survit pas.** Les sauvegardes de
  PeerTube sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est
  **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très
  probable qu'il disparaisse dès que vous supprimez le projet — même si le projet
  lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à
  PeerTube que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive, ou
  un bucket en dehors du projet) avant de supprimer, de la même manière que le flux de
  redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable,
  cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds :
  environ 115 crédits (11,50 $ US), car RAD recrée le projet et les services
  partagés avant PeerTube. La suppression ne permet d'économiser de l'argent que si
  PeerTube resterait inutilisé pendant environ 4 jours ou plus, à la fois dans votre
  propre projet (environ 3,29 $ US par jour) et dans un projet géré par RAD (32
  crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM
  de fichier/cache partagée.** Ils ne s'arrêtent que si rien d'autre dans le projet
  ne les utilise, donc la suppression de PeerTube alors que quelque chose d'autre
  partage le projet n'économise que la partie calcul de PeerTube.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à
  l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la
  dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau
  les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une
  classe. Chaque participant obtient l'application dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par
  le formateur. Soit le formateur finance toutes les places, soit chaque participant
  paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés
  retournent au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute
  l'application pour un client à partir d'un portefeuille cloisonné qu'il finance,
  et règle directement avec le client. Si le portefeuille est faible, la facturation
  est suspendue et les données sont conservées, de sorte que personne ne reçoit de
  facture inattendue. À la fin, le partenaire transfère le projet et les
  déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et
ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle.

---

## 1. Vue d'ensemble {#1-overview}

PeerTube s'exécute comme un conteneur Node.js personnalisé sur Cloud Run v2,
construit à partir d'un Dockerfile superposé à l'image de base officielle
`chocobozzz/peertube` afin qu'un ARG de build `PEERTUBE_VERSION` dédié puisse
épingler une version réelle. Le déploiement relie un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Serveur Node.js sur le port 9000 ; 2 vCPU / 2 Gio par défaut (conservateur — augmenter pour un transcodage réel) ; `cpu_always_allocated = true` |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — extensions `pg_trgm`/`unaccent` pré-créées ; PeerTube migre son propre schéma |
| Cache et file d'attente | Redis | **Obligatoire, non optionnel** — la file d'attente de jobs BullMQ de PeerTube (transcodage, livraison de fédération, notifications) n'a pas de repli en mémoire |
| Stockage d'objets | Cloud Storage | Un bucket public `videos` (compatible S3, identifiants HMAC) pour les fichiers vidéo/listes de lecture en streaming ; un bucket privé `data` (GCS FUSE) pour l'état local |
| Secrets | Secret Manager | `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD` auto-générés, paire de clés d'accès/secrètes S3 HMAC ; mot de passe de la base de données |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL par défaut `run.app` — public requis pour la fédération ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **Redis est obligatoire.** Le transcodage, la livraison de fédération et le
  pipeline de notification de PeerTube s'exécutent tous via une file d'attente
  de jobs BullMQ en cours de traitement sans repli en mémoire — contrairement à
  la plupart des modules de ce catalogue où Redis est un bouton de
  performance/mise à l'échelle optionnel. `enable_redis = true` est la valeur par
  défaut et ne doit jamais être désactivée.
- **`cpu_always_allocated = true` par défaut.** Le traitement des jobs BullMQ n'est pas lié à
  une seule requête HTTP entrante — sous la facturation basée sur les requêtes,
  le CPU se réduit à presque zéro entre les requêtes et un job de transcodage
  peut bloquer ou ne jamais se terminer (même raisonnement que le modèle de
  travailleur en arrière-plan n8n/Kestra de ce catalogue).
- **Ceci est une variante VOD/transcodage léger, pas un déploiement de
  transcodage de production.** `cpu_limit = "2000m"` / `memory_limit = "2Gi"` sont
  délibérément des valeurs par défaut conservatrices pour une utilisation de
  démonstration/légère. La FAQ de PeerTube recommande jusqu'à 8 vCPU / 8 Gio
  lorsque le transcodage s'exécute au même endroit que le serveur — augmenter
  substantiellement pour une charge réelle, ou préférer `PeerTube_GKE`.
- **Le streaming en direct RTMP ne fonctionne pas sur Cloud Run, point final.**
  `enable_live_streaming` n'a aucun effet quelle que soit la valeur — les services
  Cloud Run ne routent qu'un seul port de conteneur HTTP(S), et l'ingestion
  RTMP (ports 1935/1936) est un protocole TCP brut. Utilisez `PeerTube_GKE`
  pour le streaming en direct.
- **Le bucket `videos` est délibérément public.** L'architecture propre
  de PeerTube exige que les navigateurs récupèrent les fichiers vidéo/listes de
  lecture en streaming directement depuis le stockage d'objets, et non via un
  proxy de l'application — le bucket remplace la valeur par défaut sécurisée
  de la Fondation `public_access_prevention = "enforced"` par `"inherited"` afin que
  l'autorisation `allUsers:objectViewer` requise puisse s'appliquer. Voir §3 pour
  l'histoire complète.
- **`host` (le domaine de fédération ActivityPub) est immuable après la
  première utilisation réelle.** Laissé vide par défaut afin que le point
  d'entrée le dérive de l'URL de service prédite de Cloud Run — fonctionne
  immédiatement lors d'un nouveau déploiement. Définissez un véritable domaine
  personnalisé avant l'utilisation en production.
- **Aucun job d'initialisation d'amorçage d'administrateur n'est nécessaire.**
  `PT_INITIAL_ROOT_PASSWORD` est lu directement depuis `process.env` par le
  propre `installer.ts` de PeerTube lors du premier démarrage lorsqu'aucun
  utilisateur n'existe encore — le compte `root` est créé
  automatiquement.
- **La connexion à la base de données utilise TCP avec chiffrement sans
  vérification, et non un socket Unix.** Le mécanisme `App_CloudRun` de
  `db_host_env_var_name` alias toujours l'IP privée brute de Cloud SQL sous
  `PEERTUBE_DB_HOSTNAME` (pas le chemin de socket `DB_HOST` que
  résoudrait autrement), donc `PeerTube_CloudRun` remplace `PEERTUBE_DB_SSL=true`
  par reject-unauthorized `false` — le même modèle déjà prouvé
  pour `GTS_DB_TLS_MODE` de GoToSocial.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service PeerTube {#a-cloud-run--the-peertube-service}

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

PeerTube stocke toutes les données de l'application (comptes, métadonnées vidéo, commentaires, suivis, listes de lecture) dans une instance gérée de Cloud SQL pour PostgreSQL 15. Le service se connecte via TCP chiffré à l'IP privée de l'instance (voir §3 pour savoir pourquoi ce n'est pas une connexion de socket Unix, contrairement à la plupart des applications Cloud Run de ce catalogue).

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT" --filter="name~peertube"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Redis — la file d'attente de jobs BullMQ {#c-redis--the-bullmq-job-queue}

Redis soutient la file d'attente de jobs de transcodage, de livraison de fédération et de notification de PeerTube. Lorsque `redis_host` est laissé vide, l'IP de la VM du serveur NFS partagé est utilisée comme hôte Redis par défaut.

- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  # Confirm the remapped env vars in the running revision:
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | grep -i redis
  ```

### D. Cloud Storage — `videos` (public) et `data` (privé) {#d-cloud-storage--videos-public-and-data-private}

Deux buckets GCS sont provisionnés :

- **`videos`** — public (`public_access_prevention = "inherited"`,
  `allUsers:objectViewer`), compatible CORS, accessible via le client natif
  S3-compatible de PeerTube (AWS SDK) contre le point de terminaison XML
  S3-interop de GCS en utilisant des identifiants HMAC d'un compte de service
  dédié. Contient les cinq classes de stockage d'objets PeerTube (web-videos,
  streaming-playlists, original-video-files, user-exports, captions) sous des
  préfixes distincts.
- **`data`** — privé, monté GCS FUSE à `/data`. Contient
  l'état local de PeerTube (non-stockage d'objets) : avatars, vignettes,
  aperçus, storyboards, torrents, plugins, journaux et tmp/cache — toujours
  sur disque local/monté quelle que soit la configuration du stockage
  d'objets vidéo.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~peertube"
  gcloud storage ls gs://<videos-bucket>/
  gcloud storage buckets describe gs://<videos-bucket> --format='value(iamConfiguration.publicAccessPrevention)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Le conteneur de PeerTube lit `PEERTUBE_SECRET`, `PT_INITIAL_ROOT_PASSWORD`
(consulté uniquement au premier démarrage lorsqu'aucun utilisateur n'existe), la
paire de clés d'accès/secrètes S3 HMAC, et — lorsque le SMTP est configuré — un
mot de passe SMTP, le tout sous forme de variables d'environnement basées sur
des secrets. Le mot de passe de la base de données est géré séparément par la
fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~peertube"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation, et
[PeerTube_Common](PeerTube_Common.md) §2 pour la liste complète des secrets.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings
= "all"`, requise pour la fédération ActivityPub publique et la livraison vidéo). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN (utile pour la livraison vidéo) et Cloud Armor peuvent être superposés.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les journaux de conteneur sont acheminés vers Cloud Logging ; les métriques Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Logs Explorer ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application PeerTube {#3-peertube-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init`
  exécute `scripts/peertube/db-init.sh` en utilisant `postgres:15-alpine`. Il
  attend que Cloud SQL accepte les connexions, puis crée de manière
  idempotente le rôle et la base de données de l'application, accorde les
  privilèges et crée les extensions `pg_trgm` et `unaccent`
  en tant que superutilisateur postgres — le guide d'installation de PeerTube
  exige les deux mais ne les crée pas lui-même. Peut être réexécuté en toute
  sécurité (`execute_on_apply = true`, `max_retries = 3`).
- **Pas de job de migration séparé.** PeerTube crée et migre son propre schéma
  Sequelize automatiquement à chaque démarrage du serveur.
- **Le compte administrateur s'initialise automatiquement — aucune action
  manuelle n'est nécessaire.** Contrairement à certaines applications
  ActivityPub de ce catalogue (GoToSocial nécessite un job CLI manuel), le
  `installer.ts` de PeerTube lit `PT_INITIAL_ROOT_PASSWORD` directement
  depuis `process.env` (pas node-config, donc pas de préfixe
  `PEERTUBE_`) au premier démarrage lorsqu'aucun utilisateur n'existe
  encore, et crée automatiquement le compte administrateur `root`
  avec ce mot de passe. Récupérez-le :
  ```bash
  SECRET=$(gcloud secrets list --project "$PROJECT" --filter="name~root-password" --format="value(name)")
  gcloud secrets versions access latest --secret="$SECRET" --project "$PROJECT"
  ```
  Connectez-vous à `$SERVICE_URL/login` avec le nom d'utilisateur `root`.
- **Le domaine de fédération (`host`) est immuable après une
  utilisation réelle.** `PEERTUBE_WEBSERVER_HOSTNAME` est intégré à chaque URI
  d'acteur/objet ActivityPub créé localement la première fois que le serveur
  démarre avec des données réelles. Lorsque `host` est laissé
  vide, `docker-entrypoint.sh` le dérive de l'URL `CLOUDRUN_SERVICE_URL` de Cloud
  Run au démarrage du conteneur — une valeur par défaut fédérée fonctionnelle
  ne nécessitant aucune décision de domaine avant le déploiement. Définissez
  un véritable domaine personnalisé via `host` avant
  l'utilisation en production ; le modifier après l'existence de comptes/vidéos
  réels nécessite le propre script de maintenance `update-host` de
  PeerTube et ne corrige pas rétroactivement les URI déjà fédérés.
- **La surcharge d'accès public du bucket `videos` est essentielle, pas
  optionnelle.** `App_CloudRun`/`App_GKE` définissent par
  défaut chaque bucket provisionné sur `public_access_prevention = "enforced"` sauf
  surcharge explicite. Les propres documents de PeerTube exigent un bucket
  public `videos` avec CORS configuré (les navigateurs
  récupèrent les fichiers vidéo/listes de lecture en streaming directement
  depuis le stockage d'objets). Sans la surcharge, l'autorisation
  `google_storage_bucket_iam_member` du module pour `allUsers:objectViewer` échoue
  au moment de l'application avec `Error 412: ... public access prevention is enforced`. La sortie
  `PeerTube_Common` de `storage_buckets` définit `public_access_prevention = "inherited"`
  sur le bucket `videos` spécifiquement (pas le bucket
  `data`) pour corriger cela — confirmé en direct le 22/07/2026.
- **Sur un projet RAD géré en libre-service, une surcharge de politique
  d'organisation au niveau du projet est appliquée en premier, puis attendue.**
  Les projets gérés par RAD héritent d'une politique d'organisation de dossier
  appliquant `constraints/storage.publicAccessPrevention`, ce qui surcharge le paramètre de
  niveau de bucket ci-dessus et réintroduit le même `412`.
  Lorsque `is_self_serve_project = true` (injecté par le serveur — ne le définissez
  jamais à la main ; c'est `false` pour un projet
  "apportez votre propre" ordinaire, où tout ce mécanisme est une opération
  nulle), le module surcharge cette contrainte au niveau du **projet** via le
  fournisseur guardrails-admin. La surcharge est liée à l'état propre de ce
  module, donc la destruction du déploiement ramène le projet à la posture par
  défaut appliquée par le dossier. **La surcharge nécessite ~90s pour se
  propager avant que l'octroi du bucket ne réussisse.** Terraform signale
  l'écriture de la politique d'organisation comme terminée en 0s, mais
  l'application de GCP est en retard : l'étape d'application suivante a
  toujours rencontré le même `412`, même après
  l'épuisement de la nouvelle tentative/backoff IAM intégrée du fournisseur
  (~30s, `Too many
  conflicts`). Un `time_sleep.wait_for_org_policy_propagation` de 90s se
  situe entre les deux, et l'octroi du bucket dépend de l'attente plutôt que
  directement de la surcharge — donc une application sur un projet en
  libre-service est ~90s plus lente par conception. Confirmé en direct le
  06/08/2026.
- **Point délicat : la surcharge est limitée au projet, donc deux variantes
  PeerTube dans un même projet entrent en collision.** `storage.publicAccessPrevention`
  n'a pas de variante limitée au bucket une fois appliquée à un niveau
  supérieur. Si le même projet exécute à la fois `PeerTube_CloudRun` et
  `PeerTube_GKE`, l'état de chaque module gère indépendamment le
  *même* objet de politique au niveau du projet, et la destruction de l'un ou
  l'autre le supprime de l'autre. `solutions.yaml` ne sélectionne
  toujours qu'une seule variante PeerTube par solution, c'est donc rare en
  pratique et n'est pas résolu dans le module.
- **Les ACL de téléchargement sont intentionnellement laissées non définies.**
  L'interopérabilité S3 XML de GCS sous Uniform Bucket-Level Access ne respecte
  pas les ACL par objet définies via un client S3 (la même limitation que les
  propres documents de PeerTube décrivent pour Backblaze B2), donc
  `object_storage.upload_acl.*` est laissé non configuré et la lecture publique est
  accordée au niveau du bucket à la place.
- **Chemin de santé.** La sonde de démarrage est **TCP** sur le port 9000 — les
  propres migrations DB/Redis de PeerTube et l'amorçage de l'administrateur au
  premier démarrage peuvent prendre plus de temps que ne le permet une fenêtre
  de disponibilité HTTP typique, et une sonde HTTP contre une API pas encore
  prête empêcherait la création de la révision. La sonde de vivacité utilise
  le point de terminaison public, non authentifié `GET /api/v1/config`.
- **Inspectez le job d'initialisation et la configuration en cours d'exécution :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions describe <revision-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement telles qu'elles apparaissent sur la
plateforme de déploiement (correspondant à la balise `{{UIMeta group=N}}` de
chaque variable dans `variables.tf`). Seuls les paramètres
spécifiques ou notables pour PeerTube sont listés ; toutes les autres entrées
sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement
standard.

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
| `application_name` | `peertube` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `PeerTube` | Nom lisible par l'homme affiché dans la Console. |
| `description` | `PeerTube - Federated (ActivityPub) Video Hosting Platform` | Description du service. |
| `application_version` | `latest` | Résout la balise Docker Hub `production` maintenue via l'ARG de build `PEERTUBE_VERSION` dédié — pas le générique `APP_VERSION` de la Fondation (qui gagnerait autrement la fusion et produirait une balise `latest` irrésoluble). |
| `host` | `""` | `PEERTUBE_WEBSERVER_HOSTNAME` — le domaine de fédération public. **Immuable après la première utilisation réelle.** Laissé vide, il le dérive de l'URL Cloud Run prédite. |
| `admin_email` | `admin@example.com` | E-mail attribué au compte administrateur `root` auto-créé. |
| `enable_open_registration` | `false` | Autoriser les nouveaux utilisateurs à s'inscrire eux-mêmes. |
| `enable_live_streaming` | `false` | **Aucun effet sur cette variante Cloud Run** — RTMP nécessite un port TCP brut que les services Cloud Run ne peuvent pas exposer. Utilisez `PeerTube_GKE`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit une image basée sur Dockerfile (base `chocobozzz/peertube:${PEERTUBE_VERSION}`) via Cloud Build. |
| `cpu_limit` | `2000m` | Valeur par défaut conservatrice pour une utilisation démo/VOD. La FAQ de PeerTube recommande jusqu'à 8 vCPU pour une charge de transcodage réelle. |
| `memory_limit` | `2Gi` | Valeur par défaut conservatrice. La FAQ de PeerTube recommande jusqu'à 8 Gio pour une charge de transcodage réelle. |
| `container_port` | `9000` | Valeur par défaut native `PEERTUBE_LISTEN_PORT` de PeerTube. |
| `cpu_always_allocated` | `true` | Facturation basée sur l'instance — la file d'attente de jobs BullMQ de PeerTube n'est liée à aucune requête HTTP entrante. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Plafond de coût. |
| `execution_environment` | `gen2` | Requis pour les montages GCS FUSE. |
| `enable_cloudsql_volume` | `true` | Injecte le montage de socket Cloud SQL Auth Proxy ; les propres variables d'environnement `PEERTUBE_DB_*` de PeerTube sont définies indépendamment via l'alias `db_host_env_var_name` (voir §3). |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image de base dans Artifact Registry. |

### Groupe 5 — Accès, réseau, SMTP {#group-5--access-networking-smtp}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Requis — la fédération et la livraison vidéo nécessitent toutes deux une accessibilité publique. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque la fédération** — approprié uniquement pour une instance entièrement privée. |
| `smtp_host` | `""` | Nom d'hôte SMTP. Vide désactive l'e-mail ; une valeur non vide provisionne le secret du mot de passe SMTP. |
| `smtp_port` / `smtp_user` / `smtp_password` / `smtp_secure_enabled` / `mail_from` | `587` / `""` / `""` / `false` / `""` | Configuration SMTP standard, utilisée uniquement lorsque `smtp_host` est défini. `mail_from` prend par défaut la valeur `noreply@<host>` lorsqu'il est vide. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Variables d'environnement en texte clair fusionnées dans les valeurs par défaut de `PeerTube_Common`. |
| `secret_environment_variables` | `{}` | Références Secret Manager destinées à l'opérateur. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

Configuration standard de sauvegarde/restauration App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard de Cloud Build / Cloud Deploy d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 9 — Scripts SQL personnalisés {#group-9--custom-sql-scripts}

Exécution standard de scripts SQL personnalisés d'App_CloudRun — voir
[App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner un équilibreur de charge HTTPS global + WAF Cloud Armor. |
| `application_domains` | `[]` | Noms de domaine personnalisés — doivent correspondre à `host`. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend de l'équilibreur de charge HTTPS — utile pour la livraison vidéo. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS — `PeerTube_Common` fournit les vrais buckets `data`/`videos`, remplaçant la valeur par défaut générique `data` de cette variable. |
| `enable_nfs` | `true` (ignoré) | **Codé en dur à `false` dans `main.tf`** — PeerTube utilise GCS FUSE et le stockage d'objets au lieu de NFS. |
| `enable_gcs_storage_volume` | `true` | Monte le bucket `data` via FUSE à `/data`. Conserver `true` — l'état local de PeerTube y réside toujours quelle que soit la configuration du stockage d'objets vidéo. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse supplémentaires au-delà de `data`. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | PeerTube nécessite PostgreSQL. |
| `db_name` | `peertube` | La base de données réellement créée et injectée en tant que `PEERTUBE_DB_NAME`. Immuable après le premier déploiement. |
| `db_user` | `peertube` | Le rôle réellement créé et injecté en tant que `PEERTUBE_DB_USERNAME` ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16–64). |
| `enable_postgres_extensions` | `true` | Installe `postgres_extensions` après le provisionnement. |
| `postgres_extensions` | `["pg_trgm", "unaccent"]` | Requis par le guide d'installation de PeerTube ; non créé par PeerTube lui-même. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré fourni par `PeerTube_Common`. |
| `cron_jobs` | `[]` | Aucune tâche récurrente planifiée par la plateforme n'est définie pour PeerTube. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | TCP, port 9000 | Confirme que le port est lié ; les propres migrations DB/Redis de PeerTube et l'amorçage de l'administrateur se terminent avant que l'API HTTP ne soit réellement prête. |
| `liveness_probe` | HTTP `/api/v1/config`, délai initial de 60s | Le point de terminaison de configuration public et non authentifié. |
| `uptime_check_config` | `{ enabled=true, path="/" }` | Vérification de la disponibilité de Cloud Monitoring. |

### Groupe 21 — Redis {#group-21--redis}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — ne jamais désactiver. PeerTube n'a pas de repli en mémoire pour BullMQ. |
| `redis_host` | `""` | Laisser vide pour utiliser l'IP du serveur NFS par défaut. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

---

## 5. Sorties {#5-outputs}

Retournées lors d'un déploiement réussi — le moyen le plus rapide de localiser
et d'explorer les ressources en cours d'exécution.

| Sortie | Description |
|---|---|
| `service_name` | Nom du service Cloud Run. |
| `service_url` | URL par défaut `run.app` du service. |
| `service_location` | Région dans laquelle le service s'exécute. |
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée Cloud SQL sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés (`data`, `videos`). |
| `network_name` | Nom du réseau VPC. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `uptime_check_names` | État de la surveillance, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
| `deployment_id` / `tenant_id` / `resource_prefix` | Identifiants de nommage. |
| `project_id` | Identifiant du projet. |
| `cicd_enabled` / `artifact_registry_repository` | État CI/CD et dépôt Artifact Registry. |
| `vpc_sc_enabled` / `audit_logging_enabled` | État VPC-SC et journalisation d'audit. |

---

## 6. Pièges de configuration et valeurs par défaut judicieuses {#6-configuration-pitfalls--sensible-defaults}

> Risque : **Critique** (perte de données / panne / sécurité) — **Élevé** (service dégradé) —
> **Moyen** (coût ou dégradation partielle) — **Faible** (mineur).

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `host` (`PEERTUBE_WEBSERVER_HOSTNAME`) | Définissez votre vrai domaine avant la première utilisation réelle | Critique | Intégré à chaque URI d'acteur/objet ActivityPub au moment de la création ; le modifier après l'existence de comptes/vidéos réels interrompt la fédération pour tout ce qui a été créé avec l'ancienne valeur. |
| `enable_redis` | `true` (ne jamais désactiver) | Critique | PeerTube n'a pas de solution de repli en mémoire pour BullMQ — le transcodage, la livraison de fédération et les notifications cessent tous de fonctionner sans Redis. |
| `videos` bucket `public_access_prevention` | `"inherited"` (défini par `PeerTube_Common`, ne pas remplacer par `"enforced"`) | Critique | L'architecture de PeerTube exige que les navigateurs récupèrent les fichiers vidéo directement depuis le stockage d'objets ; `"enforced"` bloque l'autorisation `allUsers:objectViewer` requise avec une erreur `412` au moment de l'apply. |
| `enable_live_streaming` | Laissez `false`, ou déplacez vers `PeerTube_GKE` | Élevé | N'a aucun effet sur Cloud Run quelle que soit la valeur — l'ingestion RTMP nécessite un port TCP brut que les services Cloud Run ne peuvent pas exposer. L'activer ici crée une fausse attente, pas une fonctionnalité fonctionnelle. |
| `PEERTUBE_DB_SSL` / rejet-unauthorized override | Laissez tel quel (`true` / `false`, défini automatiquement) | Critique | L'alias `db_host_env_var_name` de Cloud Run pour l'IP privée brute de Cloud SQL, qui nécessite un chiffrement ; le simple "désactiver" qui serait correct sur GKE échoue ici avec "pas de chiffrement", et la vérification complète du certificat échoue contre le certificat de Cloud SQL (pas de SAN IP). |
| `cpu_limit` / `memory_limit` | Augmentez substantiellement pour une charge de transcodage réelle | Élevé | Les valeurs par défaut `2000m`/`2Gi` sont délibérément conservatrices pour une utilisation de démonstration/VOD ; la FAQ de PeerTube elle-même recommande jusqu'à 8 vCPU/8Gi pour un transcodage de production réel — des ressources sous-dimensionnées bloquent ou font échouer les jobs de transcodage. |
| `cpu_always_allocated` | `true` (par défaut, ne pas désactiver) | Élevé | Le traitement BullMQ de PeerTube n'est lié à aucune requête HTTP entrante ; sous la facturation basée sur les requêtes, le CPU est étranglé à presque zéro entre les requêtes et les jobs en arrière-plan peuvent rester bloqués indéfiniment. |
| `database_type` | `POSTGRES_15` | Critique | PeerTube nécessite PostgreSQL ; les extensions `pg_trgm`/`unaccent` et le schéma Sequelize sont spécifiques à Postgres. |
| `startup_probe` | Laissez `type = "TCP"` | Élevé | Les migrations de base de données/Redis de PeerTube et le démarrage de l'administration prennent plus de temps qu'une fenêtre de disponibilité HTTP typique ne le permet ; une sonde HTTP contre une API pas encore prête peut empêcher la révision de devenir prête. |
| `enable_open_registration` | `false` pour la plupart des déploiements | Moyen | Laisser l'inscription ouverte sur une instance publique permet à quiconque ayant l'URL de créer un compte et de télécharger du contenu vidéo. |
| `enable_iap` | `false` pour une instance publique | Moyen | IAP bloque le trafic de fédération ActivityPub non authentifié et la visualisation publique de vidéos — ne convient que pour une instance entièrement privée/de test. |
| `PT_INITIAL_ROOT_PASSWORD` secret | Récupérez et stockez en toute sécurité après le premier déploiement | Moyen | C'est la seule information d'identification pour le compte administrateur `root` ; elle n'est pas régénérée ou réappliquée après l'existence du compte. |

---

Pour le comportement de base référencé partout — identité de service, mise à
l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor,
IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images —
voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application
spécifique à PeerTube est définie dans **[PeerTube_Common](PeerTube_Common.md)**
(source du module : `modules/PeerTube_Common`).

<!-- related-guides -->

## Guides associés {#related-guides}

- [Lab pratique : PeerTube sur Cloud Run](../labs/PeerTube_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [PeerTube sur GKE Autopilot](PeerTube_GKE.md) — la même application sur Kubernetes, pour quand vous avez besoin de l'autre cible de déploiement.
- [PeerTube Common — Configuration d'application partagée](PeerTube_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [Ghost sur Google Cloud Run](Ghost_CloudRun.md), [Castopod sur Google Cloud Run](Castopod_CloudRun.md), [WriteFreely sur Google Cloud Run](WriteFreely_CloudRun.md), [GoToSocial sur Google Cloud Run](GoToSocial_CloudRun.md) dans la solution **Créateur et publication de médias**.
