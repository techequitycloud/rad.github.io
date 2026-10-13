---
title: "Outline sur Google Cloud Run"
description: "Référence de configuration pour le déploiement d'Outline sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Outline_CloudRun.md @ e69407af sha256:facade3bdc67 -->

# Outline sur Google Cloud Run {#outline-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Outline_CloudRun.png" alt="Outline sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Outline est une base de connaissances et un wiki d'équipe rapide et collaboratif, de style Notion, avec édition en temps réel, documents Markdown riches et recherche puissante — une alternative open source à Confluence et Notion. Ce module déploie Outline sur **Cloud Run v2** au-dessus de la fondation [App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure Google Cloud partagée.

Ce guide se concentre sur les services cloud qu'Outline utilise et sur la manière de les explorer et de les opérer depuis la console Google Cloud et la ligne de commande. Pour les mécanismes communs à chaque application Cloud Run — identité de service, ingress et équilibrage de charge, mise à l'échelle et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au [guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les répéter ici.

---

## Ce que coûte Outline sur RAD, et comment cela se compare {#what-outline-costs-on-rad-and-how-that-compares}

**Pour une équipe de dix personnes, Outline sur le module Cloud Run de RAD coûte environ 82 $ US par mois, sans licence par utilisateur.** Le plan Cloud Starter hébergé d'Outline coûte 10 $ US par mois pour un maximum de 10 membres — moins cher en espèces que les chiffres RAD ci-dessus ; voir **Comment cela se compare** pour ce que RAD offre en échange. Les chiffres sont valables au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si vous n'en avez besoin qu'occasionnellement — pour préparer une certification, une démo, une activité saisonnière — un projet géré par RAD peut être supprimé et restauré dans les 30 jours pour quelques crédits, de sorte que ces 82 $ US deviennent quelques dollars par mois. Voir **Mettez-le en pause gratuitement**, ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 $ US au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Environ 19 crédits par build (le build moyen de RAD prend environ 19 minutes) | Idem |
| Coût d'exécution Google Cloud | Facturé par Google à votre propre compte de facturation (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, soit environ 960 crédits par mois (environ 96 $ US au prix de la recharge, 77 $ US au tarif du plan Scale) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 $ US pour une recharge ponctuelle, et moins pour un plan mensuel. Dans un projet géré par RAD, la base de données, le serveur de fichiers et le réseau sont partagés par toutes les applications du projet, de sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût d'exécution par défaut dans votre propre projet** (us-central1, prix catalogue Google) :

| Ressource (valeur par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1x vCPU / 1 GiB (scaleToZero) | 11,58 $ US |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51,02 $ US |
| Serveur de fichiers NFS/cache (petite VM) | 13,43 $ US |
| Cloud NAT et réseau | 5 $ US |
| Cloud Storage (modules complémentaires, sauvegardes) | 1 $ US |
| **Total** | **environ 82 $ US** |

- Cloud SQL et Cloud Run coûtent le même prix en africa-south1 (Johannesburg) ; la VM coûte environ 10 % de plus.
- **La mise à l'échelle à zéro est la valeur par défaut.** La ligne Cloud Run ci-dessus reflète déjà ce coût ; le paramètre `min_instance_count = 1` maintient une instance active et augmente cette ligne, en échange de l'absence de démarrages à froid.
- **Évitez Filestore pour un petit déploiement.** Le module utilise par défaut une petite VM NFS/cache. La plus petite instance de Filestore est de 1 TiB, ce qui coûte environ 164 $ US par mois à elle seule.

### Comment cela se compare {#how-it-compares}

- **Outline vend son propre plan Cloud hébergé.** Le plan Starter coûte **10 $ US/mois pour une équipe de 10 membres maximum** (getoutline.com/pricing, 8 octobre 2026), passant à 79 $ US/mois pour 11 à 100 membres ; les deux plans incluent les mêmes fonctionnalités.
- Le chiffre de RAD pour un projet propre est plus élevé en termes monétaires car il s'agit d'une infrastructure dédiée, et non d'un service mutualisé partagé — une instance Cloud SQL dédiée, un serveur de fichiers NFS et un service Cloud Run, plutôt qu'une part de l'infrastructure d'Outline.
- Un VPS nu — Hetzner CPX22 ou un Droplet DigitalOcean 2 vCPU/4 Go, tous deux à environ 24 $ US/mois — est également moins cher que le chiffre de RAD pour un projet propre, au prix de l'exécution de PostgreSQL, Redis, des sauvegardes et des correctifs par vous-même. Outline n'a besoin que de 1 vCPU / 1-2 GiB, donc un niveau de VPS plus petit/moins cher ferait probablement l'affaire.
- Outline Cloud est le moins cher des trois jusqu'à ce qu'une équipe dépasse 10 membres ou ait besoin que les données restent dans son propre projet Google Cloud.
- Si Outline doit rester actif sans mise à l'échelle à zéro, ou fonctionner aux côtés d'autres charges de travail Kubernetes, consultez plutôt le [guide GKE](Outline_GKE.md) — environ 110 $ US par mois dans votre propre projet, ou 2 850 crédits (environ 228-285 $ US) par mois dans un projet géré par RAD.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le lorsque vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Outline s'exécute dans **un projet géré par RAD pour vous**, vous avez une deuxième option qui va bien au-delà de la mise à l'échelle à zéro : **supprimez l'ensemble du projet et restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à une utilisation occasionnelle — préparation d'une certification, environnement de démonstration, activité saisonnière — que l'exécution continue d'Outline.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord sa facturation, puis demande à Google de supprimer le projet. Google ne supprime pas le projet immédiatement : il le conserve, récupérable, pendant 30 jours. Comme la facturation est déjà déliée, rien n'est facturé pendant cette attente. Contrairement à la suppression d'un seul module, cela ne détruit pas Cloud SQL, aucune VM ou Cloud Run un par un — l'ensemble du projet, et tout ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas un rebuild.** Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande à Google de récupérer le projet et de rattacher son compte de facturation, puis vous demande d'exécuter **Update** sur chaque déploiement pour confirmer que tout est revenu. Comme rien n'a été détruit individuellement, cette mise à jour trouve les mêmes ressources déjà présentes — c'est une vérification, pas un rebuild, et une mise à jour ne facture jamais les frais de module à nouveau. Cela coûte une poignée de crédits (moins de 1 $ US) pour une chaîne typique de 2 à 3 déploiements, contre les 115 crédits (11,50 $ US) qu'un redéploiement complet coûte ci-dessous.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars, pas 82 $ US.** Déployez Outline, utilisez-le pendant un certain temps, supprimez le projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne payez les frais de module qu'une seule fois, les builds, et le temps pendant lequel Outline était réellement actif.
- **Ce dont cela a besoin.** Vous devez être propriétaire du projet (pas un projet que vous apportez et pour lequel RAD ne gère que la facturation), et vous le restaurez vous-même dans les 30 jours — après cela, Google le supprime définitivement. La restauration est admise comme la création d'un nouveau projet : votre solde de crédits achetés doit toujours dépasser le seuil du niveau (100 crédits pour le niveau sandbox que la plupart des utilisations d'étude et de démonstration conviennent). Google indique que la plupart des services sont à nouveau pleinement fonctionnels dans les 36 heures suivant une restauration.
- **Une véritable lacune : le bucket de sauvegarde ne survit pas.** Les sauvegardes d'Outline sont écrites dans un bucket à l'intérieur du projet, et ce bucket n'est **pas** protégé par la suppression logicielle de Cloud Storage, il est donc très probable qu'il disparaisse dès que vous supprimez le projet — même si le projet lui-même est récupérable pendant 30 jours. Si vous avez apporté des modifications à Outline que vous souhaitez conserver, copiez une sauvegarde (vers Google Drive ou un bucket en dehors du projet) avant de supprimer, comme pour le workflow de redéploiement ci-dessous. Pour une installation par défaut sans rien d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ; **dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la façon d'arrêter de payer est de supprimer le déploiement et de le redéployer lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les builds : environ 115 crédits (11,50 $ US), car RAD recrée le projet et les services partagés avant Outline. La suppression ne permet d'économiser de l'argent que si Outline devait rester inutilisé pendant environ 5 jours ou plus, à la fois dans votre propre projet (environ 2,73 $ US par jour) et dans un projet géré par RAD (32 crédits par jour).
- **La majeure partie du coût d'exécution est généralement la base de données et la VM de fichier/cache partagée.** Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les utilise, donc la suppression d'Outline alors que quelque chose d'autre partage le projet n'économise que la partie calcul d'Outline.
- **Conservez d'abord les données.** Les sauvegardes sont écrites dans un bucket à l'intérieur du déploiement et sont supprimées avec celui-ci, alors copiez la dernière sauvegarde avant de la supprimer si vous souhaitez la conserver.
- **RAD ne recrée pas un déploiement supprimé pour vous** ; vous saisissez à nouveau les paramètres lors du déploiement.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour une classe. Chaque participant reçoit l'application dans son propre projet Google Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie par le formateur. Soit le formateur finance toutes les places, soit chaque participant paie la sienne. Tout est supprimé à la fin de la session et les crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les cabinets de conseil.** Un partenaire exécute l'application pour un client à partir d'un portefeuille cloisonné qu'il finance, et règle directement avec le client. Si le portefeuille est faible, la facturation est suspendue et les données sont conservées, de sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire transfère le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF, NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud Billing Catalog ; [radmodules.dev/pricing](https://radmodules.dev/pricing) pour les frais propres à RAD et les estimations de crédits quotidiens ; [Supprimer et restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects) pour la fenêtre de pause/restauration et ce qu'elle dit sur les objets Cloud Storage sans suppression logicielle ; [Tarification Outline](https://www.getoutline.com/pricing).

---

## 1. Vue d'ensemble {#1-overview}

Outline s'exécute en tant que conteneur Node.js sur Cloud Run v2, construit à partir d'une image personnalisée (`outlinewiki/outline` plus un point d'entrée de plateforme). Le déploiement connecte un ensemble ciblé de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Service Node.js, 1 vCPU / 1 GiB par défaut, facturation basée sur les requêtes, mise à l'échelle à zéro |
| Base de données | Cloud SQL pour PostgreSQL 15 | Requis — connecté via le socket Unix du proxy d'authentification Cloud SQL ; extension `pg_trgm` activée |
| Cache et sessions | Redis | **Requis par Outline** ; activé par défaut, servi depuis l'hôte NFS partagé sauf si `redis_host` est défini |
| Fichiers partagés | Filestore (NFS) | Les pièces jointes téléchargées (`FILE_STORAGE=local`) persistent après les redémarrages et les instances (gen2 requis) |
| Stockage d'objets | Cloud Storage | Un bucket `storage` dédié provisionné automatiquement |
| Secrets | Secret Manager | `SECRET_KEY`, `UTILS_SECRET` et le mot de passe de la base de données gérés automatiquement |
| Ingress | URL Cloud Run / Équilibrage de charge Cloud | URL `run.app` par défaut, équilibreur de charge HTTPS externe facultatif + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est obligatoire.** Outline est une application Sequelize/PostgreSQL ; MySQL n'est pas pris en charge.
- **`DATABASE_URL` et `REDIS_URL` sont assemblés au démarrage du conteneur.** La plateforme injecte les éléments individuels (`DB_USER`, `DB_PASSWORD`, `DB_HOST`, `DB_NAME`, `REDIS_HOST`, …) et le point d'entrée personnalisé construit les URL de connexion — ne définissez jamais `DATABASE_URL` vous-même.
- **L'URL du service est injectée en tant que `URL`.** `service_url_env_var_name` prend par défaut la valeur `URL` car Outline a besoin de sa propre URL publique pour construire l'`redirect_uri` OIDC. Sans cela, Outline n'enregistre **aucun** fournisseur d'authentification.
- **Un fournisseur d'authentification est une étape opérateur.** Les variables d'environnement `OIDC_*` sont **intentionnellement vides** — tant que vous ne configurez pas un fournisseur d'identité OIDC après le déploiement, la page de connexion est vide et le wiki est inutilisable. Voir [§3](#3-outline-application-behaviour).
- **Redis est requis, pas facultatif.** `enable_redis` prend par défaut la valeur `true` ; lorsque `redis_host` est vide, la fondation pointe `REDIS_URL` vers l'hôte NFS partagé, qui co-héberge Redis.
- **Les téléchargements vont vers NFS.** `FILE_STORAGE=local` avec `FILE_STORAGE_LOCAL_ROOT_DIR=/var/lib/outline/data`, soutenu par le montage Filestore au même chemin (limite de 25 MiB par téléchargement par défaut).
- **`FORCE_HTTPS=false` est défini délibérément.** TLS est terminé en amont par Cloud Run ; la redirection HTTPS par défaut d'Outline casserait les sondes de santé HTTP.
- **Un job `db-init` s'exécute à chaque apply** pour créer de manière idempotente la base de données et l'utilisateur PostgreSQL d'Outline.
- **Mise à l'échelle à zéro par défaut.** `min_instance_count = 0`, `max_instance_count = 1`, facturation basée sur les requêtes (`cpu_always_allocated = false`).

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis. Les noms de service et de ressource sont indiqués dans les [Sorties](#5-outputs) du déploiement.

### A. Cloud Run — le service Outline {#a-cloud-run--the-outline-service}

Outline s'exécute en tant que service Cloud Run v2 écoutant sur le port 3000 qui s'adapte automatiquement en fonction de la charge des requêtes entre le nombre minimal et maximal d'instances. Chaque déploiement crée une révision immuable ; le trafic peut être réparti entre les révisions pour des déploiements sûrs. Un WebSocket d'édition collaborative ouvert compte comme une requête active, de sorte que le CPU reste alloué pendant que quelqu'un édite, même avec une facturation basée sur les requêtes.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le trafic, les logs et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence, l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Outline stocke toutes les données d'application (documents, collections, utilisateurs, révisions) dans une instance Cloud SQL pour PostgreSQL 15 gérée. Le service se connecte en privé via le **Cloud SQL Auth Proxy** sur un socket Unix (pas d'IP publique) ; le point d'entrée assemble automatiquement le `DATABASE_URL` au format socket et l'extension `pg_trgm` est activée pour la recherche. Lors du premier déploiement, un job `db-init` crée la base de données et l'utilisateur de l'application.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les sauvegardes, les indicateurs, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de passe se trouvent dans les [Sorties](#5-outputs). Voir [App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et la rotation des mots de passe.

### C. Filestore (NFS) et Cloud Storage {#c-filestore-nfs-and-cloud-storage}

Les pièces jointes et images téléchargées sont écrites sur un partage **Filestore (NFS)** monté à `/var/lib/outline/data` afin que toutes les instances partagent les mêmes fichiers et que les téléchargements survivent aux redémarrages. Un bucket **Cloud Storage** dédié (suffixe `storage`) est également provisionné automatiquement. L'environnement d'exécution gen2 est requis pour les montages NFS.

- **Console :** Filestore → Instances ; Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  gcloud storage buckets list --project "$PROJECT"
  gcloud storage ls gs://<storage-bucket>/        # bucket name is in the Outputs
  ```

Voir [App_CloudRun](App_CloudRun.md) pour le montage NFS, GCS Fuse et CMEK.

### D. Redis {#d-redis}

Outline **nécessite** Redis pour les sessions, la mise en cache et sa file d'attente en arrière-plan — il ne démarrera pas sans un point de terminaison Redis accessible. Lorsqu'aucun hôte Redis externe n'est configuré, la fondation injecte un `REDIS_URL` pointant vers l'hôte NFS partagé, qui co-héberge Redis.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  redis-cli -h <redis-host> info keyspace
  ```

### E. Secret Manager {#e-secret-manager}

Trois secrets sont gérés automatiquement : le mot de passe de la base de données (créé par la fondation) plus `SECRET_KEY` et `UTILS_SECRET` d'Outline — deux valeurs de 64 caractères hexadécimaux (le format `openssl rand -hex 32` requis en amont) créées par `Outline_Common` et injectées dans le service au moment de l'exécution. Le texte en clair n'apparaît jamais dans la configuration.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~outline"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de rotation.

### F. Réseau et ingress {#f-networking--ingress}

Le service est accessible par son URL `run.app` par défaut. Un équilibreur de charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor peuvent être superposés ; les paramètres d'ingress et le contrôle d'egress VPC contrôlent la connectivité. N'oubliez pas que `URL` d'Outline doit correspondre à l'hôte que les utilisateurs consultent réellement — si vous placez le service derrière un domaine personnalisé, définissez `URL` en conséquence.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### G. Cloud Logging et Monitoring {#g-cloud-logging--monitoring}

Les logs des conteneurs sont envoyés à Cloud Logging ; les métriques Cloud Run et Cloud SQL sont envoyées à Cloud Monitoring, avec des vérifications de disponibilité et des politiques d'alerte facultatives.

- **Console :** Logging → Explorateur de logs ; Monitoring → Tableaux de bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Outline {#3-outline-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Un job `db-init` (`postgres:15-alpine`) se connecte à Cloud SQL via le socket Auth Proxy et crée de manière idempotente la base de données et l'utilisateur Outline, accorde les privilèges et accorde le rôle de l'utilisateur à `postgres` afin que la propriété puisse être définie. Le job s'exécute à chaque apply et peut être réexécuté en toute sécurité.
- **Migrations à chaque démarrage.** Outline ne migre pas automatiquement. Le point d'entrée personnalisé attend PostgreSQL (`pg_isready`, jusqu'à ~3 minutes), puis exécute les migrations Sequelize (`sequelize db:migrate --env=production-ssl-disabled`) avant de démarrer le serveur, de sorte que les mises à niveau de version appliquent les modifications de schéma sans étape manuelle.
- **Les URL de connexion sont assemblées, non configurées.** Le point d'entrée construit `DATABASE_URL` à partir des variables `DB_*` injectées par la plateforme — format socket (`?host=/cloudsql/…&sslmode=disable`) sur Cloud Run — et `REDIS_URL` à partir de `REDIS_HOST`/`REDIS_PORT` avec un repli sur l'hôte NFS. Ne définissez aucune de ces variables manuellement.
- **`URL` est injecté automatiquement.** La fondation injecte l'URL de service prédite en tant que `URL` (via `service_url_env_var_name = "URL"`). Outline l'utilise pour construire l'`redirect_uri` OIDC et tous les liens absolus. Ne la remplacez que si vous servez à partir d'un domaine personnalisé.
- **L'authentification est une étape POST-DÉPLOIEMENT REQUISE.** Les espaces réservés `OIDC_*` sont livrés vides, et avec eux la page de connexion affiche **aucun fournisseur** — le déploiement est sain mais personne ne peut se connecter. Pour connecter Google en tant qu'IdP, par exemple :
  ```bash
  gcloud run services update <service-name> --project "$PROJECT" --region "$REGION" \
    --update-env-vars=OIDC_AUTH_URI=https://accounts.google.com/o/oauth2/v2/auth,\
  OIDC_TOKEN_URI=https://oauth2.googleapis.com/token,\
  OIDC_USERINFO_URI=https://openidconnect.googleapis.com/v1/userinfo,\
  OIDC_USERNAME_CLAIM=email
  ```
  Ensuite, liez les identifiants client en tant que secrets. **Piège :** `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET` sont livrés en tant que *variables d'environnement vides en clair*, et gcloud refuse de convertir une variable d'environnement en référence de secret en une seule étape ("déjà définie avec un type différent") — supprimez-les d'abord, puis mettez à jour :
  ```bash
  gcloud run services update <service-name> --region "$REGION" \
    --remove-env-vars=OIDC_CLIENT_ID,OIDC_CLIENT_SECRET
  gcloud run services update <service-name> --region "$REGION" \
    --update-secrets=OIDC_CLIENT_ID=<client-id-secret>:latest,OIDC_CLIENT_SECRET=<client-secret-secret>:latest
  ```
  Enregistrez `<URL>/auth/oidc.callback` comme URI de redirection autorisé sur le **même hôte** que `URL` — l'URL, le rappel enregistré et le navigateur doivent tous être d'accord sur un seul nom d'hôte.
- **Redirection HTTPS désactivée volontairement.** `FORCE_HTTPS=false` car TLS est terminé par le frontal de Cloud Run ; la propre redirection 301-vers-HTTPS d'Outline enverrait les sondes de santé HTTP vers un port sans écouteur et provoquerait une boucle de crash du conteneur. Les opérateurs terminant TLS eux-mêmes peuvent passer outre via `environment_variables`.
- **Chemin de santé.** Les sondes de démarrage et de vivacité ciblent `/`, qui répond une fois que les migrations sont terminées et que Redis est connecté. La sonde de démarrage permet un délai initial de 60 secondes plus six tentatives de 10 secondes.
- **Vérification.** Confirmez que la révision déployée a reçu les `URL` injectés et le câblage de la base de données :
  ```bash
  gcloud run services describe <service-name> --region "$REGION" \
    --format="json(spec.template.spec.containers[0].env)" | grep -E '"URL"|DB_HOST|REDIS'
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour Outline sont listés ; toutes les autres entrées sont héritées de [App_CloudRun](App_CloudRun.md) avec son comportement standard.

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
| `application_name` | `outline` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Outline` | Nom convivial affiché dans la console. |
| `application_version` | `latest` | Tag de version de l'image Outline ; incrémenter pour déclencher un nouveau build et une nouvelle révision. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définir `false` pour provisionner uniquement l'infrastructure. |
| `cpu_limit` | `1000m` | CPU par instance ; 1 vCPU minimum pour Outline. |
| `memory_limit` | `1Gi` | Mémoire par instance ; 2 GiB recommandés pour la production (recherche en texte intégral, gestion des actifs). |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes. Un WebSocket d'édition ouvert compte comme une requête active ; définissez `true` uniquement si vous comptez sur la file d'attente en arrière-plan d'Outline (notifications par e-mail, indexation des liens retour) s'exécutant entre les requêtes. |
| `min_instance_count` | `0` | Mise à l'échelle à zéro par défaut ; définissez `1` pour éviter les démarrages à froid. |
| `max_instance_count` | `1` | Plafond de coût ; augmentez-le pour une édition concurrente plus intensive. |
| `enable_cloudsql_volume` | `true` | Socket du proxy d'authentification Cloud SQL. Requis — la connexion Postgres d'Outline utilise le format socket. |
| `execution_environment` | `gen2` | Requis pour le montage NFS. |
| `timeout_seconds` | `300` | Délai d'attente par requête ; augmentez-le pour les exportations volumineuses. |

### Groupe 5 — Accès et contrôle d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_iap` | `false` | Exiger la connexion Google via Identity-Aware Proxy. |
| `ingress_settings` | `all` | Quels réseaux peuvent atteindre le service (tous / interne / LB uniquement). |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Comment le trafic sortant est acheminé via le connecteur VPC. |

### Groupe 6 — Variables d'environnement et secrets {#group-6--environment-variables--secrets}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | `{}` | Fusionné sur la configuration Outline intégrée. C'est ici que vous configurez le fournisseur d'authentification **requis** (`OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI`, …) et, éventuellement, remplacez `URL`. Ne définissez **pas** `DATABASE_URL`/`REDIS_URL` ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager (utilisez pour `OIDC_CLIENT_ID`/`OIDC_CLIENT_SECRET`). |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmentez pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et autorisation binaire {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir [App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`, `github_repository_url`, `github_token`, `enable_cloud_deploy`, `enable_binary_authorization`, `binauthz_evaluation_mode`.

### Groupe 9 — SQL personnalisé {#group-9--custom-sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`, `custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un bucket GCS après le provisionnement. Voir [App_CloudRun](App_CloudRun.md).

### Groupe 10 — Domaine, CDN, Cloud Armor et rétention d'images {#group-10--domain-cdn-cloud-armor--image-retention}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_domains` | `[]` | Noms d'hôtes personnalisés pour l'équilibreur de charge externe. Outline doit connaître son URL publique — définissez `URL` en conséquence. |
| `enable_cdn` / `enable_cloud_armor` / `admin_ip_ranges` | désactivé | Options CDN / WAF. |
| `max_images_to_retain` / `delete_untagged_images` / `image_retention_days` | _(défini)_ | Politique de nettoyage d'Artifact Registry. |

### Groupe 11 — Stockage et système de fichiers {#group-11--storage--filesystem}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_nfs` | `true` | Volume Filestore partagé pour les fichiers téléchargés. Nécessite gen2. |
| `nfs_mount_path` | `/var/lib/outline/data` | Chemin de montage — doit correspondre à `FILE_STORAGE_LOCAL_ROOT_DIR`. |
| `create_cloud_storage` / `storage_buckets` / `gcs_volumes` | _(défini)_ | Buckets supplémentaires / montages GCS Fuse. Le bucket `storage` est toujours provisionné automatiquement. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `database_type` | `POSTGRES_15` | Outline nécessite PostgreSQL — ne pas changer pour MySQL. |
| `db_name` | `outline` | Nom de la base de données PostgreSQL. Immuable après le premier déploiement. |
| `db_user` | `outline` | Utilisateur de l'application. Immuable après le premier déploiement. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `service_url_env_var_name` | `URL` | Injecte l'URL de service prédite en tant que `URL`. **Ne pas laisser vide** — sans `URL`, Outline n'enregistre aucun fournisseur d'authentification. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laisser vide pour utiliser le job `db-init` intégré (`postgres:15-alpine`). |
| `cron_jobs` | `[]` | Jobs récurrents déclenchés par Cloud Scheduler. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/`, délai initial de 60s, 6 échecs | Permet le temps pour les migrations au premier démarrage et la connexion Redis. |
| `liveness_probe` | HTTP `/`, délai initial de 60s, période de 30s | Redémarre le conteneur après 3 échecs consécutifs. |
| `uptime_check_config` | désactivé, chemin `/` | Vérification de disponibilité Cloud Monitoring. |
| `alert_policies` | `[]` | Politiques d'alerte métriques. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | **Requis** — Outline ne fonctionnera pas sans Redis. |
| `redis_host` | `""` | Point de terminaison Redis. Laisser vide pour utiliser l'hôte NFS partagé (co-héberge Redis). |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` | Mot de passe d'authentification Redis facultatif (sensible). |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
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
| `load_balancer_ip` / `load_balancer_url` | IP / URL de l'équilibreur de charge HTTPS externe (lorsqu'il est activé). |
| `database_instance_name` | Nom de l'instance Cloud SQL. |
| `database_name` / `database_user` | Nom / utilisateur de la base de données de l'application. |
| `database_password_secret` | Secret Secret Manager contenant le mot de passe de la base de données. |
| `database_host` / `database_port` | Point de terminaison / port de la base de données. |
| `storage_buckets` | Buckets Cloud Storage créés (inclut le bucket `storage`). |
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
| `OIDC_*` variables d'environnement | configurées après le déploiement | Critique | Expédition intentionnellement vide — tant qu'un IdP n'est pas configuré, la page de connexion affiche **zéro fournisseur** et le wiki est inutilisable, même si le déploiement est sain. |
| `service_url_env_var_name` | `URL` | Critique | Le fait de le vider supprime le `URL` injecté ; Outline ne peut pas construire l'OIDC `redirect_uri` et n'enregistre aucun fournisseur d'authentification. |
| `database_type` | `POSTGRES_15` | Critique | Outline nécessite PostgreSQL ; MySQL provoque un échec au démarrage. |
| `db_name` / `db_user` | défini une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et détruit tous les documents. |
| `enable_redis` | `true` | Critique | Outline nécessite Redis pour les sessions et sa file d'attente ; sans cela, le conteneur ne devient jamais sain. |
| `enable_nfs` | `true` | Critique | Sans stockage partagé, les pièces jointes téléchargées sont perdues entre les instances/redémarrages. |
| `enable_cloudsql_volume` | `true` | Critique | La connexion Postgres du point d'entrée utilise le socket du proxy d'authentification ; le TCP IP-privé direct est rejeté par Cloud SQL sans configuration SSL. |
| `DATABASE_URL` / `REDIS_URL` dans `environment_variables` | jamais défini | Élevé | Le point d'entrée assemble les deux correctement par plateforme ; une valeur définie manuellement la remplace par la mauvaise forme d'hôte. |
| `FORCE_HTTPS` | `false` (valeur par défaut du module) | Élevé | La réactivation fait qu'Outline redirige les sondes de santé HTTP en 301 → échec de la sonde → boucle de crash. TLS est déjà terminé par Cloud Run. |
| Liaison secrète OIDC | supprimer puis mettre à jour | Élevé | `OIDC_CLIENT_ID`/`SECRET` sont des variables d'environnement vides ; un seul `--update-secrets` échoue avec "déjà défini avec un type différent" — `--remove-env-vars`-les d'abord. |
| URI de redirection OIDC | `<URL>/auth/oidc.callback` sur le même hôte que `URL` | Élevé | Une non-concordance d'hôte entre `URL`, le rappel enregistré et le navigateur interrompt l'aller-retour OAuth. |
| `nfs_mount_path` | `/var/lib/outline/data` | Élevé | Doit correspondre à `FILE_STORAGE_LOCAL_ROOT_DIR`, sinon les téléchargements atterrissent sur un disque éphémère et disparaissent. |
| `startup_probe` initial_delay_seconds | `60` | Élevé | Le réduire tue Outline avant la fin des migrations Sequelize du premier démarrage. |
| `execution_environment` | `gen2` | Élevé | Les montages NFS nécessitent la génération 2 ; la génération 1 ne peut pas monter Filestore. |
| `memory_limit` | `1Gi`+ (`2Gi` prod) | Moyen | Trop peu de mémoire provoque des OOM de Node.js pendant l'indexation de la recherche ou les exportations volumineuses. |
| `min_instance_count` | `0` (dev) / `1` (prod) | Moyen | `0` ajoute un démarrage à froid (avec vérification de la migration) à la première requête après l'inactivité. |
| `backup_retention_days` | `7` (augmenter pour la prod) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement fondamental référencé tout au long — identité de service, mise à l'échelle et concurrence, ingress et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Outline partagée avec la variante GKE est décrite dans **[Outline_Common](Outline_Common.md)**.

## Guides associés {#related-guides}

- [Lab pratique : Outline sur Cloud Run](../labs/Outline_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Outline sur GKE Autopilot](Outline_GKE.md) — la même application sur Kubernetes, pour lorsque vous avez besoin de l'autre cible de déploiement.
- [Outline Common — Configuration d'application partagée](Outline_Common.md) — la configuration partagée par les deux cibles de déploiement.
- Déployé avec [BookStack sur Google Cloud Run](BookStack_CloudRun.md), [Paperless-ngx sur Google Cloud Run](Paperless_CloudRun.md), [Stirling-PDF sur Google Cloud Run](StirlingPDF_CloudRun.md) dans la solution **Base de connaissances et documentation**.
