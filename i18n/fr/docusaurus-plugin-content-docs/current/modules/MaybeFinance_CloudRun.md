---
title: "Maybe Finance sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Maybe Finance sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/MaybeFinance_CloudRun.md @ 40c83c3f sha256:55b478c90203 -->

# Maybe Finance sur Google Cloud Run {#maybe-finance-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/MaybeFinance_CloudRun.png" alt="Maybe Finance sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Maybe (Maybe Finance) est une alternative open source auto-hébergée à Mint/Monarch
pour la gestion des finances personnelles et du patrimoine — budgétisation, suivi de la valeur nette,
catégorisation des transactions et agrégation multi-comptes, basée sur Ruby on
Rails. Ce module déploie Maybe sur **Cloud Run v2** au-dessus de la
fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
Google Cloud partagée.

Ce guide se concentre sur les services cloud que Maybe utilise et sur la façon de les explorer et de les
utiliser depuis la console Google Cloud et la ligne de commande. Pour les
mécanismes communs à toutes les applications Cloud Run — identité de service,
ingestion et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary
Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement —
reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte MaybeFinance sur RAD, et comment cela se compare {#what-maybefinance-costs-on-rad-and-how-that-compares}

**Le module Cloud Run de Maybe sur RAD coûte environ 102 $ US par mois dans votre propre projet, sans abonnement mensuel par foyer.** RAD facture 175 crédits une fois par déploiement dans votre propre projet (157,5 crédits, soit 10 % de moins, dans un projet géré par RAD). Les builds sont inclus dans le prix. MaybeFinance se déploie également sur GKE Autopilot pour environ 150 $ US par mois — consultez le [guide GKE](MaybeFinance_GKE.md) si vous en avez besoin pour qu'il s'exécute là-bas. Si vous n'en avez besoin qu'occasionnellement, un projet géré par RAD peut être supprimé et restauré dans les 30 jours sans frais supplémentaires, de sorte que ce chiffre mensuel ne représente que quelques dollars — voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 175 crédits (17,50 $ US au prix de la recharge) | 157,5 crédits (10 % de moins) |
| Builds | Inclus dans le prix : pas de frais de build pour la création, 5 mises à jour par mois (mois calendaire UTC) gratuites, puis 2 crédits chacune, et rien pour la suppression ou pour un build échoué. Les sessions de lab et les projets clients sont l'exception : ils sont toujours facturés pour le temps de build à la minute | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation, environ **102 $ US par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **67 crédits par jour**, soit environ 2 010 par mois (environ 201 $ US au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est détenu en réserve |

10 crédits coûtent 1 $ US en recharge unique, et moins avec un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas de deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (module par défaut) | Par mois |
|---|---|
| Cloud Run, 2x vCPU / 4 GiB (scaleToZero) | 32 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 102 $ US** |

### Comment cela se compare {#how-it-compares}

- **Monarch Money**, un traqueur de finances personnelles et de valeur nette hébergé, coûte **14,99 $ US par mois** (99,99 $ US par an, soit environ 8,33 $ US par mois facturé annuellement).
- Le module Maybe de RAD coûte environ 102 $ US par mois dans votre propre projet — beaucoup plus que Monarch Money en termes monétaires pour un seul foyer. L'argument en faveur de l'auto-hébergement ici n'est pas le prix, c'est que **vos comptes bancaires liés, vos soldes et vos transactions vivent dans une infrastructure que vous contrôlez**, plutôt qu'avec un agrégateur tiers qui stocke vos identifiants bancaires et vend des données financières anonymisées dans le cadre de son modèle commercial.
- Comparaison auto-gérée : à 2 vCPU / 4 GiB avec une base de données Postgres, une instance GCP Compute Engine e2-standard-2 (environ 49 $ US/mois) est à portée, mais vous gérez vous-même Postgres, les sauvegardes, les correctifs de sécurité et la disponibilité pour des données aussi sensibles.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si MaybeFinance s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à MaybeFinance dont vous n'avez besoin qu'occasionnellement — pour l'évaluer, un environnement de démonstration, une charge de travail saisonnière ou intermittente — que de le faire fonctionner en continu.

> **Une restauration n'est pas garantie — conservez vos propres sauvegardes.** Les conditions de Google Cloud ne garantissent pas qu'un projet restauré, ou les ressources qu'il contient, seront utilisables après sa restauration. Par conséquent, la restauration ne peut pas être considérée comme un moyen de récupérer un projet supprimé. Avant de supprimer, assurez-vous d'avoir effectué des sauvegardes appropriées des données et de la configuration de l'application et de les avoir stockées en dehors du projet. Si une restauration échoue, ou si le projet restauré ne fonctionne pas, la solution de repli consiste à redéployer l'application (voir la section suivante) et à restaurer sa configuration et ses données à partir de ces sauvegardes.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette période d'attente. Contrairement à la suppression d'un module, cela ne détruit pas la base de données, aucune VM ou la ressource de calcul une par une — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration est une vérification, pas une reconstruction.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Mettre à jour** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas une reconstruction, et une mise à jour ne facture jamais les frais de module à nouveau. Les mises à jour sont incluses dans le prix (5 par mois pour chaque déploiement), donc une restauration ne coûte normalement aucun crédit.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, et non les 201 $ US par mois pour le maintenir en fonctionnement.** Déployez MaybeFinance, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Mettre à jour, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez que les frais de module une seule fois et le temps qu'il a réellement été en ligne.
- **Ce que cela nécessite.** Vous devez être propriétaire du projet (pas un projet dont RAD gère uniquement la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des évaluations utilisent). Google indique que la plupart des services fonctionnent à nouveau pleinement dans les 36 heures suivant une restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les sauvegardes et autres fichiers générés sont écrits dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez personnalisé MaybeFinance et que vous souhaitez conserver ce travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors du projet) avant de supprimer. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Ne payez que pendant que vous l'utilisez, l'autre façon : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau (les builds sont inclus) — 175 crédits (17,50 $ US) au total. La suppression ne permet d'économiser de l'argent que si MaybeFinance reste inutilisé suffisamment longtemps pour compenser ce coût de redéploiement par rapport à son propre coût d'exécution — environ **6 jours ou plus**, à la fois dans votre propre projet (environ 3,40 $ US par jour) et dans un projet géré par RAD (67 crédits par jour).
- **La majeure partie du coût d'exécution est généralement partagée.** Pour MaybeFinance, il s'agit de la base de données et de la VM de fichiers/cache partagée. Ils ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression de cette application pendant que quelque chose d'autre partage le projet n'économise que la partie calcul de cette application.
- **Gardez vos données en premier.** Les sauvegardes nocturnes vont dans un bucket à l'intérieur du déploiement et sont supprimées avec lui, alors copiez la dernière sauvegarde avant de supprimer si vous voulez la conserver.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant dispose de l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est interrompue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; frais RAD et estimation des crédits quotidiens de [radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour les mécanismes de pause/restauration et ce qu'il dit sur les objets Cloud Storage sans suppression logicielle ; [Monarch Money](https://www.monarch.com/pricing). Les prix changent ; vérifiez chaque source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Maybe s'exécute comme un conteneur Rails/Puma unique sur Cloud Run v2, avec un
processus de job en arrière-plan Sidekiq démarré à côté de lui dans le même
conteneur par le point d'entrée cloud. Le déploiement connecte un ensemble ciblé de
services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Rails/Puma sur le port 3000, 2 vCPU / 4 GiB par défaut ; Sidekiq s'exécute comme un processus en arrière-plan dans le même conteneur |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — une garde au moment de la planification n'accepte que `POSTGRES_13`/`14`/`15` (ou `NONE`) ; MySQL est rejeté |
| Jobs en arrière-plan et UI en temps réel | Redis (via la VM NFS partagée, ou un hôte explicite) | Obligatoire — une précondition au moment de la planification échoue si `enable_redis = false` ; alimente Sidekiq (synchronisation de compte, traitement d'importation, notifications) |
| Persistance des fichiers | Cloud Filestore (NFS) | Les pièces jointes persistent sous `/rails/storage` ; également la source par défaut pour l'IP de l'hôte Redis |
| Stockage d'objets | Cloud Storage | Un bucket `storage` est automatiquement provisionné par `MaybeFinance_Common` ; la variable `storage_buckets` par défaut ajoute un bucket `data` |
| Secrets | Secret Manager | `SECRET_KEY_BASE` auto-généré (clé de session/chiffrement Rails) ; mot de passe de la base de données |
| Ingestion | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** `database_type` par défaut à `POSTGRES_15`
  et une précondition au moment de la planification (`validation.tf`) rejette tout sauf
  `POSTGRES_13`/`14`/`15`/`NONE` — MySQL n'est pas pris en charge.
- **Redis est obligatoire, pas facultatif.** Une précondition au moment de la planification échoue
  directement si `enable_redis = false`. Lorsque `redis_host` est laissé vide,
  `enable_nfs` doit rester `true` afin que l'IP du serveur NFS partagé soit utilisée comme hôte
  Redis.
- **Cloud SQL est atteint via TCP IP privée, pas un socket, par défaut.**
  Contrairement à la plupart des applications du module Common, `enable_cloudsql_volume` par défaut à
  **`false`** ici : le pilote `pg` de Rails ne peut pas analyser le DSN de socket Unix de Cloud SQL,
  donc le module ignore le sidecar Auth Proxy et se connecte via l'IP privée de l'instance
  à la place. Le point d'entrée cloud mappe les variables d'environnement
  `DB_HOST`/`DB_PORT`/`DB_NAME`/`DB_USER`/`DB_PASSWORD` de la Fondation
  sur les variables d'environnement discrètes `DB_HOST`/`DB_PORT`/`POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` de Maybe
  et définit `PGSSLMODE=require` (Cloud SQL rejette le TCP IP privée non chiffré) ;
  si `enable_cloudsql_volume` est activé, `DB_HOST` devient un répertoire de socket
  et le point d'entrée revient à `DB_IP` via TCP au lieu
  d'essayer d'utiliser directement le chemin du socket.
- **La mise à l'échelle à zéro est la valeur par défaut (`min_instance_count = 0`,
  `cpu_always_allocated = false`).** Il s'agit d'une valeur par défaut axée sur les coûts, mais cela
  signifie que le worker Sidekiq colocalisé ne s'exécute que lorsqu'une instance est
  active — définissez `min_instance_count = 1` et `cpu_always_allocated = true`
  pour que les jobs en arrière-plan (synchronisation de compte, traitement d'importation,
  notifications) s'exécutent en continu, correspondant aux valeurs par défaut de la variante GKE.
- **Conteneur web + worker combiné, pas un sidecar.** Le point d'entrée cloud
  démarre `bundle exec sidekiq` en arrière-plan, puis `exec` le serveur web Rails
  au premier plan du *même* conteneur — Maybe n'est pas
  déployé avec un worker `additional_services` séparé. Si `REDIS_URL`
  est vide, le point d'entrée ignore entièrement le démarrage de Sidekiq plutôt que de
  planter.
- **`SECRET_KEY_BASE` est généré une fois** par `MaybeFinance_Common` et stocké
  dans Secret Manager, partagé de manière identique par les processus web et Sidekiq.
  Rails l'utilise pour signer les sessions/cookies et pour dériver la clé qui chiffre
  les colonnes chiffrées d'ActiveRecord.
- **Le schéma est créé par un job d'initialisation, pas au démarrage.** Le
  job `maybefinance-migrate` exécute `rails db:prepare` pendant l'apply ; le
  point d'entrée d'exécution n'exécute jamais de migrations.
- **`container_image_source = "custom"`.** Cloud Build construit une image wrapper légère
  `FROM ghcr.io/maybe-finance/maybe:<version>`. `application_version`
  par défaut à `"stable"` ; une requête `"latest"` est mappée au
  canal de publication `stable` épinglé via l'ARG de build
  `MAYBE_VERSION` spécifique à l'application (l'ARG de build générique
  `APP_VERSION` de la Fondation n'est intentionnellement pas utilisé).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont
rapportés dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Maybe (web + Sidekiq) {#a-cloud-run--the-maybe-service-web--sidekiq}

Maybe s'exécute en tant que service Cloud Run v2 qui s'adapte automatiquement à la charge de requêtes entre
les nombres minimum et maximum d'instances. Le serveur web Rails/Puma et le
worker Sidekiq s'exécutent en tant que deux processus dans le même conteneur, partageant
`SECRET_KEY_BASE` et la connexion Redis. Chaque déploiement crée une
révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Maybe stocke toutes les données de l'application (comptes, transactions, budgets, utilisateurs) dans
une instance gérée de Cloud SQL pour PostgreSQL 15. Contrairement à la variante GKE (qui
atteint Cloud SQL via un sidecar Auth Proxy en boucle locale), le service Cloud Run
se connecte via l'**IP privée de l'instance avec `sslmode=require`** —
`enable_cloudsql_volume` par défaut `false` car Rails ne peut pas analyser le
DSN de type socket que le proxy présenterait autrement. Lors du premier déploiement, le
job `db-init` crée la base de données et l'utilisateur de l'application, accorde le rôle d'application
`cloudsqlsuperuser` (afin que la propre migration de Maybe puisse créer des extensions Postgres
sans accès superutilisateur), et pré-crée l'extension `pgcrypto` ;
`maybefinance-migrate` exécute ensuite `rails db:prepare`.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs,
  les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les
[Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Cloud Filestore (NFS) et Redis {#c-cloud-filestore-nfs--redis}

**Cloud Filestore (NFS)** est monté à `/rails/storage`
(`enable_nfs = true` par défaut) afin que les pièces jointes téléchargées persistent entre
les révisions. Maybe nécessite également **Redis**, qui est obligatoire — une
précondition au moment de la planification bloque `enable_redis = false`. Lorsque `redis_host` est laissé vide,
l'IP `REDIS_HOST` injectée se résout en l'IP du serveur NFS partagé (la VM NFS
co-héberge Redis dans la convention de plateforme de ce dépôt), c'est pourquoi `enable_nfs`
doit rester `true` à moins qu'une `redis_host` explicite ne soit fournie.

> **Sidekiq nécessite Redis 6.2 ou plus récent, et le Redis hébergé sur NFS est 6.0.** Le Redis partagé sur la
> VM NFS exécute 6.0.16, et Sidekiq 7 refuse de démarrer avec. L'interface web fonctionne toujours (le
> point d'entrée met Sidekiq en arrière-plan), de sorte que le déploiement semble sain alors qu'aucun job en arrière-plan ne s'exécute.
> Pointez `redis_host` vers une instance Redis 6.2+ — par exemple Memorystore, via `create_redis = true`
> dans Services_GCP, qui provisionne Redis 7.2.

- **Console :** Filestore → Instances ; Compute Engine → Instances de VM (la VM NFS, si elle
  exécute également Redis).
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la découverte/provisionnement NFS et les mécanismes d'injection Redis.

### D. Cloud Storage {#d-cloud-storage}

Un bucket **`storage`** est provisionné automatiquement par `MaybeFinance_Common`,
et la variable `storage_buckets` par défaut ajoute un deuxième bucket **`data`**.
Aucun n'est monté dans le système de fichiers du conteneur par défaut — `gcs_volumes`
est vide par défaut — ils existent donc en tant que stockage provisionné mais sont inertes
jusqu'à ce qu'ils soient explicitement connectés.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~maybefinance"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Secret Manager {#e-secret-manager}

Un secret spécifique à Maybe est généré automatiquement et stocké dans Secret
Manager : `SECRET_KEY_BASE` (`secret-<prefix>-maybefinance-secret-key-base`),
une valeur aléatoire de 64 caractères partagée par le processus web Rails et le
worker Sidekiq. Le mot de passe de la base de données est géré séparément par la fondation.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~maybefinance"
  gcloud secrets versions access latest --secret=<secret-key-base-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingestion {#f-networking--ingress}

Le service est accessible à son URL `run.app` par défaut (`ingress_settings
= "all"`). Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN,
et Cloud Armor peuvent être superposés ; les paramètres d'ingestion et le contrôle de l'égression VPC
contrôlent la connectivité.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs de conteneur (`RAILS_LOG_TO_STDOUT = "true"`) sont envoyés à Cloud Logging ; les métriques Cloud
Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité
et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Maybe Finance {#3-maybe-finance-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il se connecte via TCP IP privée (`sslmode=require`),
  crée de manière idempotente la base de données et l'utilisateur de l'application, accorde les privilèges,
  accorde le rôle d'application `cloudsqlsuperuser` (les utilisateurs d'applications Cloud SQL ne sont pas de vrais
  superutilisateurs, cela permet donc à la propre migration de Maybe de créer des extensions Postgres),
  et pré-crée `pgcrypto` comme mesure de précaution. Le job peut être réexécuté en toute sécurité.
- **La migration de schéma est un job d'initialisation distinct.** `maybefinance-migrate` exécute
  `bundle exec rails db:prepare` sur l'image Maybe construite (`image = null`
  dans sa spécification de job, il réutilise donc l'image et la chaîne d'outils construites pour l'application),
  dépend de la fin de `db-init` en premier, et réessaie jusqu'à 3 fois
  (`max_retries = 3`, `timeout_seconds = 1200`, `memory_limit = 2Gi`).
- **Enregistrement de l'administrateur à la première exécution, pas un secret auto-créé.**
  `SELF_HOSTED = "true"` active l'interface utilisateur d'auto-hébergement de Maybe, qui permet au premier
  visiteur d'enregistrer le compte administrateur initial via l'interface utilisateur web — il n'y a
  pas de secret de mot de passe administrateur auto-généré à récupérer.
  {/* TODO: verify whether a first-run invite/registration lock exists after the first admin is created */}
- **`SECRET_KEY_BASE` est immuable en pratique.** Il est généré une fois par
  `MaybeFinance_Common` et partagé par les processus web et Sidekiq. Le faire pivoter
  après le premier démarrage invalide les sessions existantes et rend
  les colonnes chiffrées d'ActiveRecord illisibles.
- **Le mappage des variables d'environnement de la base de données se fait dans le point d'entrée cloud, pas un DSN d'URL.** La
  plateforme injecte `DB_HOST` (l'IP privée de l'instance sur Cloud Run, puisque
  `enable_cloudsql_volume` par défaut `false`), `DB_PORT`, `DB_NAME`, `DB_USER`,
  `DB_PASSWORD`, et `DB_IP` ; le point d'entrée les mappe sur
  `POSTGRES_DB`/`POSTGRES_USER`/`POSTGRES_PASSWORD` (convention Rails
  `config/database.yml` de Maybe) et définit `PGSSLMODE=require` car l'hôte
  résolu est une véritable IP privée, pas une boucle locale.
- **Câblage Redis.** `REDIS_URL` est construit à partir de `REDIS_HOST`/
  `REDIS_PORT`/`REDIS_AUTH` injectés s'il n'est pas déjà défini. Si `REDIS_URL` est vide
  (Redis inaccessible), le point d'entrée ignore entièrement le démarrage de Sidekiq —
  les jobs en arrière-plan s'arrêtent silencieusement au lieu de faire planter le conteneur.
- **Les jobs en arrière-plan nécessitent une instance toujours chaude.** Parce que Sidekiq est
  démarré en processus par le point d'entrée, il ne s'exécute que tant qu'une instance de conteneur
  est active. Avec les valeurs par défaut de CloudRun (`min_instance_count = 0`,
  `cpu_always_allocated = false`), les périodes de mise à l'échelle à zéro et la limitation du CPU
  entre les requêtes interrompent le traitement des jobs en arrière-plan.
- **Chemin de santé.** La sonde de démarrage est **HTTP** `GET /up` avec une généreuse
  tolérance pour un premier démarrage lent (`initial_delay_seconds = 60`,
  `period_seconds = 15`, `failure_threshold = 30` — environ 8 minutes de
  marge). La sonde de vivacité est également **HTTP** `GET /up`
  (`initial_delay_seconds = 60`, `period_seconds = 30`,
  `failure_threshold = 3`).
- **Inspecter l'exécution du job :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <maybefinance-migrate-job-name> --project "$PROJECT" --region "$REGION"
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement (la
balise `{{UIMeta group=N}}` dans la description de chaque variable dans `variables.tf`).
Seuls les paramètres spécifiques ou notables pour Maybe sont listés ; toutes les autres entrées
sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard
et ses valeurs par défaut.

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
| `resource_labels` | `{}` | Libellés appliqués à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `maybefinance` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Maybe` | Nom lisible par l'homme affiché dans la console. |
| `description` | _(défini)_ | Description du service. |
| `application_version` | `stable` | Tag d'image `ghcr.io/maybe-finance/maybe` utilisé comme base de build personnalisée ; `latest` est mappé au canal de publication `stable` épinglé via `MAYBE_VERSION`. |

`application_display_name`/`application_description` sont des déclarations de miroir de Fondation inertes
(jamais transmises à l'appel de la Fondation) — l'identité effective provient de
`display_name`/`description` ci-dessus.

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Image wrapper légère construite À PARTIR de l'image GHCR en amont. |
| `cpu_limit` | `2000m` | CPU par instance. |
| `memory_limit` | `4Gi` | Mémoire par instance ; Maybe recommande au moins 2 Gi. |
| `cpu_always_allocated` | `false` | Valeur par défaut de démarrage à froid axée sur les coûts. Définissez `true` (avec `min_instance_count >= 1`) pour que Sidekiq traite en continu. |
| `container_resources` | _(null)_ | Remplace `cpu_limit`/`memory_limit` lorsqu'il est défini. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut — diffère de `min=1` de la variante GKE ; arrête le worker Sidekiq colocalisé entre les requêtes. |
| `max_instance_count` | `5` | Plafond de coût. |
| `container_port` | `3000` | Port natif Rails/Puma de Maybe. |
| `execution_environment` | `gen2` | Gen2 requis pour les montages NFS et GCS Fuse. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | **Désactivé par défaut pour Maybe** — Rails ne peut pas analyser le DSN de socket Cloud SQL, donc l'application se connecte via TCP IP privée à la place. |
| `cloudsql_volume_mount_path` | `/cloudsql` | Pertinent uniquement si `enable_cloudsql_volume` est activé. |
| `container_protocol` | `http1` | Version du protocole HTTP. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements échelonnés. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |
| `enable_image_mirroring` | `true` | Toujours vrai — l'image de base GHCR est mise en miroir dans Artifact Registry avant la construction du wrapper. |
| `container_build_config` | `{ enabled = true }` | Paramètres de build ; l'ARG de build `MAYBE_VERSION` est défini à partir de `application_version` dans `MaybeFinance_Common`, non exposé en tant que variable de niveau supérieur. |
| `additional_services` / `additional_containers` | `[]` | Non utilisé par Maybe (Sidekiq s'exécute en processus, pas en tant que sidecar ou service séparé). |

### Groupe 5 — Accès et réseau {#group-5--access--networking}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | Accessibilité publique pour l'interface utilisateur web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |
| `network_name` | `""` | Découvre automatiquement le réseau VPC géré par Services_GCP. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Paramètres non secrets supplémentaires. Les valeurs principales de Rails/Maybe (`RAILS_ENV`, `SELF_HOSTED`, `RAILS_LOG_TO_STDOUT`, etc.) sont définies automatiquement par `MaybeFinance_Common`. |
| `secret_environment_variables` | `{}` | Mappage de la variable d'environnement → nom du secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_file` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécuter du SQL à partir d'un bucket GCS
après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Équilibreur de charge, CDN et rétention d'images {#group-10--load-balancer-cdn--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_cloud_armor` | `false` | Provisionner Global HTTPS LB + Cloud Armor WAF. |
| `admin_ip_ranges` | `[]` | Plages CIDR exemptées des règles WAF. |
| `application_domains` | `[]` | Noms de domaine personnalisés pour le LB HTTPS. |
| `enable_cdn` | `false` | Activer Cloud CDN sur le backend du LB HTTPS. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `create_cloud_storage` | `true` | Créer des buckets GCS définis dans `storage_buckets`. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Bucket GCS supplémentaire au-delà du bucket `storage` auto-provisionné. |
| `enable_nfs` | `true` | Les pièces jointes persistent et sont partagées entre les révisions ; également la source par défaut pour l'IP de l'hôte Redis. |
| `nfs_mount_path` | `/rails/storage` | Où Maybe stocke les pièces jointes téléchargées. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(découverte automatique)_ | Nommage de VM NFS existante/intégrée. |
| `gcs_volumes` | `[]` | Montages de volume GCS Fuse (nécessite gen2) ; non utilisés par défaut. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Une précondition au moment de la planification limite cela à `POSTGRES_13`/`14`/`15`/`NONE` ; MySQL est rejeté. |
| `db_name` | `maybefinance` | Nom effectif de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `maybefinance` | Utilisateur effectif de la base de données de l'application ; mot de passe auto-généré dans Secret Manager. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |
| `enable_postgres_extensions` / `postgres_extensions` | `false` / `[]` | Désactivé — `db-init.sh` pré-crée déjà `pgcrypto` via l'octroi `cloudsqlsuperuser`. |
| `enable_mysql_plugins` / `mysql_plugins` | `false` / `[]` | Inutilisé — Maybe est uniquement PostgreSQL. |
| `application_database_name` / `application_database_user` | `crappdb` / `crappuser` | Déclarations de miroir de Fondation **inertes** (jamais transmises à `main.tf`) — le vrai nom/utilisateur de la base de données proviennent de `db_name`/`db_user` ci-dessus via `MaybeFinance_Common`. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser les jobs `db-init` + `maybefinance-migrate` intégrés. |
| `cron_jobs` | `[]` | Non transmis — Maybe n'a pas de tâches récurrentes planifiées par la plateforme ; son propre travail en arrière-plan s'exécute en processus via Sidekiq. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/up`, délai de 60s, 30 tentatives | Sonde de démarrage. Prévoir environ 8 minutes au premier démarrage. |
| `liveness_probe` | HTTP `/up`, délai de 60s | Sonde de vivacité. |
| `startup_probe_config` / `health_check_config` | HTTP `/up` | Sondes structurées alternatives. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Vérification de disponibilité de Cloud Monitoring ; désactivée par défaut, activer explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache et file d'attente Redis {#group-21--redis-cache--queue}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Obligatoire** — une précondition au moment de la planification échoue si définie sur `false`. |
| `redis_host` | `""` | Laissez vide pour utiliser l'IP du serveur NFS (nécessite `enable_nfs = true`). |
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
| `database_host` / `database_port` | Point de terminaison de la base de données (IP privée sur Cloud Run) / port. |
| `storage_buckets` | Buckets Cloud Storage créés. |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`, `maybefinance-migrate`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration
> via le moteur de base [App_CloudRun](App_CloudRun.md), plus ses propres
> gardes `validation.tf` (`min` ≤ `max`, Redis obligatoire, un hôte Redis doit être
> résolvable, `database_type` PostgreSQL uniquement, pas de proxy d'authentification sans une vraie
> base de données). Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée
> avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées
> en amont plutôt qu'à l'apply ou à l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` (ou `13`/`14`) | Critique | Un moteur non-PostgreSQL est rejeté au moment de la planification ; forcer un contournement de la garde casse l'installateur et chaque requête. |
| `enable_redis` | `true` | Critique | La précondition au moment de la planification bloque `false` purement et simplement — Maybe n'a pas de file d'attente de jobs en arrière-plan fonctionnelle sans Redis. |
| `db_name` / `db_user` | Définir une fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit toutes les données. |
| `SECRET_KEY_BASE` (auto-généré) | Ne jamais faire pivoter après le premier démarrage | Critique | Le faire pivoter invalide toutes les sessions et rend les colonnes chiffrées par ActiveRecord illisibles. |
| `enable_cloudsql_volume` | `false` (Cloud Run) | Critique | Le fait de l'activer change `DB_HOST` en un répertoire de socket que Rails ne peut pas analyser directement ; le point d'entrée revient à `DB_IP`, mais un `database_type = "NONE"` mal configuré combiné à `enable_cloudsql_volume = true` est bloqué au moment de la planification car le sidecar proxy n'aurait aucune instance à laquelle se connecter. |
| `redis_host` | `""` (NFS) ou explicite | Élevé | Lorsque Redis est activé mais `enable_nfs` est désactivé et qu'aucun hôte n'est défini, la précondition au moment de la planification échoue ; si `enable_nfs` est désactivé après un déploiement fonctionnel, les pièces jointes téléchargées deviennent éphémères et l'hôte Redis peut devenir obsolète. |
| `min_instance_count` / `cpu_always_allocated` | `1` / `true` pour la production | Élevé | Avec les valeurs par défaut axées sur les coûts (`0` / `false`), le worker Sidekiq colocalisé ne s'exécute que lorsqu'une instance est active — la synchronisation des comptes, le traitement des importations et les notifications cessent silencieusement de se déclencher entre les requêtes et pendant les fenêtres de mise à l'échelle à zéro. |
| `memory_limit` | `4Gi` (par défaut) | Élevé | Le processus combiné Rails + Sidekiq est gourmand en mémoire sous les charges de travail d'importation/synchronisation ; Maybe recommande au moins 2 Gi. |
| `SELF_HOSTED` (auto-injecté `"true"`) | Enregistrer le premier administrateur rapidement | Élevé | Laisser le déploiement accessible avant qu'un administrateur ne s'enregistre permet à quiconque ayant l'URL de revendiquer le compte administrateur initial. |
| `ingress_settings` | `all` | Moyen | Le fait de le définir sur `internal` bloque l'accès à l'interface utilisateur web pour toute personne extérieure au VPC. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |
| `enable_cloud_armor` | activer pour la production | Moyen | L'interface utilisateur d'administration est accessible publiquement sans protection WAF. |

---

Pour le comportement de base référencé partout — identité de service,
mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP,
Autorisation binaire, VPC-SC, sauvegardes et mise en miroir d'images — voir
**[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Maybe
partagée avec la variante GKE se trouve dans le module `MaybeFinance_Common` — voir
**[MaybeFinance_Common](MaybeFinance_Common.md)** pour les secrets, le démarrage de la base de données,
le comportement du point d'entrée, les sondes de santé et le stockage.

## Guides associés {#related-guides}

- [Lab pratique : Maybe Finance sur Cloud Run](../labs/MaybeFinance_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Maybe Finance sur GKE Autopilot](MaybeFinance_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [MaybeFinance Common — Configuration d'application partagée](MaybeFinance_Common.md) — la configuration partagée par les deux cibles de déploiement.
