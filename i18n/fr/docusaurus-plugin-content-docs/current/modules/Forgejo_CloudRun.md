---
title: "Forgejo sur Google Cloud Run"
description: "Référence de configuration pour le déploiement de Forgejo sur Google Cloud Run avec le module RAD — variables, architecture, réseau et opérations."
---

<!-- translated-from: docs/modules/Forgejo_CloudRun.md @ e69407af sha256:6ffc56515fa4 -->

# Forgejo sur Google Cloud Run {#forgejo-on-google-cloud-run}

<img src="https://storage.googleapis.com/rad-public-2b65/modules/Forgejo_CloudRun.png" alt="Forgejo sur Google Cloud Run" style={{maxWidth: "100%", borderRadius: "8px"}} />

Forgejo est un service Git léger, auto-hébergé et géré par la communauté — un
fork de Gitea — offrant l'hébergement de dépôts, le suivi des problèmes, les
demandes de tirage (pull requests), un exécuteur CI/CD (Actions) intégré, la
révision de code et un registre de paquets à partir d'un seul binaire Go. Ce
module déploie Forgejo sur **Cloud Run v2** au-dessus de la fondation
[App_CloudRun](App_CloudRun.md), qui provisionne et gère l'infrastructure
partagée de Google Cloud.

Ce guide se concentre sur les services cloud utilisés par Forgejo et sur la
manière de les explorer et de les opérer depuis la Google Cloud Console et la
ligne de commande. Pour les mécanismes communs à toutes les applications Cloud
Run — identité de service, ingress et équilibrage de charge, mise à l'échelle
et concurrence, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC Service
Controls, sauvegardes et cycle de vie du déploiement — reportez-vous au
[guide de la fondation App_CloudRun](App_CloudRun.md) plutôt que de les
répéter ici.

---

## Ce que coûte Forgejo sur RAD, et comment cela se compare {#what-forgejo-costs-on-rad-and-how-that-compares}

**Dans un projet Google Cloud que vous possédez, le module Cloud Run de Forgejo
sur RAD coûte environ 84 US$ par mois, plus 11 US$ une fois par déploiement et
aucune licence par utilisateur.** GKE Autopilot est l'alternative pour les
charges de travail qui doivent rester actives en continu ou fonctionner à côté
d'autres applications Kubernetes ; voir le [guide GKE](Forgejo_GKE.md), environ
143 US$ par mois. Forgejo est une forge Git légère et auto-hébergée, un fork
communautaire de Gitea, avec hébergement de dépôts, gestion des problèmes,
demandes de tirage et un exécuteur Actions intégré. Les chiffres sont valables
au 8 octobre 2026 ; les sources sont listées à la fin de cette section.

Si cela s'exécute dans un projet géré par RAD pour vous, il peut être supprimé
et restauré dans les 30 jours pour quelques crédits au lieu de rester en
fonctionnement — ainsi, un déploiement à usage occasionnel coûte quelques
dollars par mois, et non 84 US$. Voir **Mettez-le en pause gratuitement**,
ci-dessous.

### Ce que vous payez sur RAD {#what-you-pay-on-rad}

| | Dans un projet Google Cloud que vous possédez | Dans un projet géré par RAD pour vous |
|---|---|---|
| Frais de module, une fois par déploiement | 110 crédits (11 US$ au prix de la recharge) | 99 crédits (10 % de moins) |
| Temps de build | Quelques crédits par build | Idem |
| Coût de fonctionnement Google Cloud | Facturé par Google à votre propre compte de facturation, environ **84 US$ par mois** pour la configuration par défaut (tableau ci-dessous) | Mesuré à l'heure en crédits ; RAD publie **32 crédits par jour**, environ 960 par mois (environ 96 US$ au prix de la recharge) |
| Qui possède quoi | Vous possédez le projet et sa facturation ; RAD le déploie et le met à jour | RAD possède le projet, avec des garde-fous, des quotas et des alertes budgétaires ; vous avez accès à la console, et un solde minimum acheté est conservé en réserve |

10 crédits coûtent 1 US$ pour une recharge ponctuelle, et moins avec un plan
mensuel. Dans un projet géré par RAD, la base de données, le serveur de
fichiers et le réseau sont partagés par toutes les applications du projet, de
sorte qu'une deuxième application n'ajoute pas une deuxième base de données.

**Coût de fonctionnement par défaut dans votre propre projet** (us-central1,
prix catalogue Google) :

| Ressource (par défaut du module) | Par mois |
|---|---|
| Cloud Run, 1 vCPU / 2 GiB, mise à l'échelle à zéro | 13 US$ |
| Cloud SQL pour PostgreSQL, 1 vCPU / 3,75 Go, zonal, 10 Go SSD | 51 US$ |
| Serveur de fichiers NFS/cache : une petite VM | 13 US$ |
| Passerelle et adresse IP Cloud NAT | 5 US$ |
| Cloud Storage pour les sauvegardes | 1 US$ |
| **Total** | **environ 84 US$** |

### Comment cela se compare {#how-it-compares}

Nous n'avons pas trouvé de plan commercial géré/SaaS spécifiquement pour
Forgejo au 8 octobre 2026, donc la comparaison honnête est avec l'exécution par
vous-même :

| Option | Par mois | Qui l'exécute |
|---|---|---|
| Hetzner CPX22 (2 vCPU/4 Go) | ~24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| DigitalOcean 2 vCPU/4 Go Droplet | 24 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| GCP Compute Engine e2-standard-2 (2 vCPU/8 Go) | ~49 US$ | Vous : OS, mises à jour, sauvegardes, correctifs de sécurité |
| **RAD, Cloud Run, votre propre projet** | **84 US$**, plus 11 US$ une fois | L'automatisation de RAD, dans votre projet |
| RAD, GKE Autopilot | environ 143 US$ ; voir le [guide GKE Autopilot](Forgejo_GKE.md) | RAD |

L'empreinte propre de Forgejo ici (1 vCPU / 2 GiB) est plus légère que celle de
la machine de référence, donc un niveau plus petit et moins cher des mêmes
fournisseurs pourrait également l'exécuter confortablement.

- **RAD n'est généralement pas moins cher en espèces qu'un VPS nu — la
  différence est ce qui est géré pour vous.** Le prix d'un VPS n'inclut pas le
  temps de l'administrateur pour les sauvegardes, les correctifs de sécurité
  et les mises à niveau du système d'exploitation ; Cloud SQL géré par RAD (où
  cette application utilise une base de données), Secret Manager et la
  surveillance couvrent cela à la place.
- **Forgejo est une forge Git légère et auto-hébergée, un fork communautaire
  de Gitea, avec hébergement de dépôts, gestion des problèmes, demandes de
  tirage et un exécuteur Actions intégré.** Cela détermine quelle colonne
  importe : une opération prévisible et sans intervention est plus précieuse
  pour la plupart des équipes utilisant ce type d'outil que de réduire de
  quelques dollars la facture mensuelle.

### Mettez-le en pause gratuitement : supprimez un projet géré par RAD, restaurez-le quand vous en avez besoin {#pause-it-for-free-delete-a-rad-managed-project-restore-it-when-you-need-it}

Si Forgejo s'exécute dans **un projet géré par RAD pour vous**, vous avez une
option au-delà de la mise à l'échelle : **supprimez l'ensemble du projet et
restaurez-le dans les 30 jours pour presque rien.** Cela convient bien mieux à
un déploiement dont vous n'avez besoin qu'occasionnellement — pour étudier en
vue d'une certification, une démo, un besoin saisonnier — que de le faire
fonctionner en continu.

- **Comment ça marche.** La suppression d'un projet géré par RAD délie d'abord
  sa facturation, puis demande à Google de supprimer le projet. Google ne le
  supprime pas immédiatement : il le conserve, récupérable, pendant 30 jours,
  et comme la facturation est déjà déliée, rien n'est facturé pendant cette
  attente. Contrairement à la suppression d'un seul module, cela ne détruit
  pas Cloud SQL, la VM ou Cloud Run un par un — l'ensemble du projet, et tout
  ce qu'il contient, s'arrête simplement.
- **La restauration coûte une poignée de crédits, pas une reconstruction.**
  Dans les 30 jours, le propriétaire du projet peut le restaurer. RAD demande
  à Google de récupérer le projet et de rattacher son compte de facturation,
  puis vous demande d'exécuter **Update** sur chaque déploiement pour
  confirmer que tout est revenu. Comme rien n'a été détruit
  individuellement, cette mise à jour trouve les mêmes ressources déjà
  présentes — c'est une vérification, pas une reconstruction, et une mise à
  jour ne facture jamais les frais de module à nouveau. Cela coûte une
  poignée de crédits de temps de build au total (moins de 1 US$) pour une
  chaîne typique de 2 à 3 déploiements.
- **Ainsi, un mois d'utilisation occasionnelle peut coûter quelques dollars,
  pas 84 US$.** Déployez Forgejo, utilisez-le pour une session, supprimez le
  projet. Restaurez-le la prochaine fois que vous en avez besoin, confirmez
  avec Update, et supprimez-le à nouveau lorsque vous avez terminé. Vous ne
  payez que les frais de module une seule fois, les builds, et les heures
  pendant lesquelles il était réellement actif.
- **Ce que cela nécessite.** Vous devez posséder le projet (pas un projet
  que vous apportez et dont RAD ne gère que la facturation), et vous le
  restaurez vous-même dans les 30 jours — après cela, Google le supprime
  définitivement. La restauration est admise comme la création d'un nouveau
  projet : votre solde de crédits achetés doit toujours dépasser le seuil du
  niveau (100 crédits pour le niveau sandbox que la plupart des utilisations
  d'étude/démo conviennent). Google indique que la plupart des services
  fonctionnent à nouveau pleinement dans les 36 heures suivant une
  restauration.
- **Un véritable manque : les sauvegardes nocturnes ne survivent pas.** Les
  sauvegardes sont écrites dans un bucket à l'intérieur du projet, et ce
  bucket a la suppression douce de Cloud Storage explicitement désactivée,
  il est donc très probable qu'il disparaisse dès que vous supprimez le
  projet — même si le projet lui-même est récupérable pendant 30 jours. Si
  vous avez personnalisé ce déploiement et que vous souhaitez conserver ce
  travail, copiez une sauvegarde (vers Google Drive, ou un bucket en dehors
  du projet) avant de supprimer. Pour une installation par défaut sans rien
  d'irremplaçable, cela n'a pas d'importance.

### Payez uniquement pendant que vous l'utilisez, l'autre méthode : supprimer et redéployer {#pay-only-while-you-use-it-the-other-way-delete-and-redeploy}

Cloud Run se met déjà à l'échelle à zéro entre les requêtes, de sorte que la
plupart de ses propres coûts de calcul s'arrêtent d'eux-mêmes lorsque personne
ne l'utilise. L'option ci-dessus ne s'applique qu'à un projet géré par RAD ;
**dans votre propre projet, ou une fois la fenêtre de 30 jours passée, la
manière d'arrêter de payer est de supprimer le déploiement et de le déployer à
nouveau lorsque vous en avez besoin.**

- **Ce que coûte un redéploiement.** Les frais de module à nouveau plus les
  builds : environ 115 crédits (11,50 US$). La suppression permet d'économiser
  de l'argent si Forgejo devait rester inutilisé pendant environ 5 jours ou
  plus dans votre propre projet (environ 2,79 US$ par jour), ou environ 4
  jours ou plus dans un projet géré par RAD (32 crédits par jour).
- **Supprimez tout ce que Forgejo utilise.** La majeure partie du coût de
  fonctionnement est généralement la base de données et toute VM de fichier/cache
  partagée. Elles ne s'arrêtent que lorsque rien d'autre dans le projet ne les
  utilise, donc la suppression de cette application alors que quelque chose
  d'autre partage le projet n'économise que la partie calcul de cette
  application.
- **Conservez les données en premier.** Les sauvegardes nocturnes vont dans un
  bucket à l'intérieur du déploiement et sont supprimées avec lui, donc copiez
  la dernière sauvegarde avant de la supprimer si vous voulez la conserver.
- **Notez vos paramètres.** RAD ne recrée pas un déploiement supprimé pour
  vous ; vous entrez à nouveau les paramètres lorsque vous déployez.

### Sessions de lab et environnements gérés {#lab-sessions-and-managed-environments}

- **Sessions de lab, pour la formation.** Un formateur anime une session pour
  une classe. Chaque participant obtient Forgejo dans son propre projet Google
  Cloud pendant 15 minutes à 24 heures, dans la limite d'une allocation définie
  par le formateur. Soit le formateur finance toutes les places, soit chaque
  participant paie la sienne. Tout est supprimé à la fin de la session et les
  crédits inutilisés sont reversés au formateur.
- **Environnements gérés, pour les sociétés de conseil.** Un partenaire
  exécute l'application pour un client à partir d'un portefeuille cloisonné
  qu'il finance, et règle directement avec le client. Si le portefeuille
  diminue, la facturation est suspendue et les données sont conservées, de
  sorte que personne ne reçoit de frais inattendus. À la fin, le partenaire
  remet le projet et les déploiements deviennent la propriété du client.

Les crédits peuvent être achetés dans plus de 20 devises, y compris XAF, XOF,
NGN, GHS, KES et ZAR, par carte, virement bancaire ou argent mobile.

**Sources (8 octobre 2026) :** Prix catalogue Google Cloud de l'API Cloud
Billing Catalog ; frais propres de RAD et estimation des crédits quotidiens de
[radmodules.dev/pricing](https://radmodules.dev/pricing) ; [Supprimer et
restaurer des projets](https://cloud.google.com/resource-manager/docs/delete-restore-projects)
pour le mécanisme de pause/restauration. Les prix changent ; vérifiez chaque
source avant de vous fier à un chiffre.

## 1. Vue d'ensemble {#1-overview}

Forgejo s'exécute comme un seul binaire Go à l'intérieur d'un mince wrapper de
build personnalisé sur l'image de base `codeberg.org/forgejo/forgejo` : le wrapper ajoute un
point d'entrée de plateforme (`/platform-entrypoint.sh`) qui compose la connexion à la
base de données au moment de l'exécution, puis passe la main au propre point
d'entrée de Forgejo sous `s6`. Le déploiement relie un ensemble ciblé
de services Google Cloud :

| Capacité | Service Google Cloud | Notes |
|---|---|---|
| Calcul | Cloud Run v2 | Binaire Go sur le port 3000, 1 vCPU / 2 Gi par défaut, autoscaling sans serveur ; `max_instance_count` par défaut à `1` |
| Base de données | Cloud SQL pour PostgreSQL 15 | Verrouillé en pratique — `db-init.sh` utilise `psql` ; le menu déroulant `database_type` liste MYSQL/NONE comme options mais elles ne sont pas prises en charge |
| Persistance des fichiers | Cloud Filestore (NFS) | Activé par défaut ; les dépôts, les objets LFS et les pièces jointes résident sous le montage NFS (`/mnt/nfs`) |
| Stockage d'objets | Cloud Storage | Un bucket générique, inutilisé, suffixé par `data` est provisionné par défaut par la fondation — Forgejo lui-même ne stocke rien dans GCS |
| Secrets | Secret Manager | `SECRET_KEY` et `INTERNAL_TOKEN` auto-générés, plus le mot de passe de la base de données, tous injectés directement comme variables d'environnement `GITEA__` |
| Ingress | URL Cloud Run / Cloud Load Balancing | URL `run.app` par défaut ; équilibreur de charge HTTPS externe optionnel + domaine personnalisé |

**Valeurs par défaut judicieuses à connaître d'emblée :**

- **PostgreSQL 15 est le seul moteur qui fonctionne réellement.** `database_type`
  par défaut à `POSTGRES_15` ; le script du job `db-init` est écrit
  entièrement pour `psql`, donc la sélection de MySQL ou `NONE`
  interrompt la configuration de la base de données même si les métadonnées de
  la variable les listent comme options.
- **Cloud SQL est atteint par TCP IP privé direct par défaut, pas par un
  socket.** `enable_cloudsql_volume = false` par défaut pour ce module (contrairement à de
  nombreux autres modules CloudRun), de sorte que le point d'entrée de la
  plateforme voit une IP privée `DB_HOST` et définit `GITEA__database__SSL_MODE=require` pour
  ce saut. Définissez `enable_cloudsql_volume = true` pour passer au socket Unix du proxy
  d'authentification Cloud SQL à `/cloudsql/<connection-name>` à la place (`SSL_MODE=disable`).
- **NFS est activé par défaut**, monté à `/mnt/nfs`
  (`GITEA__server__APP_DATA_PATH`) — c'est là que les dépôts, les objets Git LFS et les
  pièces jointes persistent. La valeur par défaut de ce module remplace la
  valeur par défaut interne du module `Forgejo_Common` de `/data`.
- **`max_instance_count` par défaut à `1`.** Combiné avec le
  stockage de dépôts basé sur NFS et un seul rôle Postgres, cela évite les
  conflits d'écriture concurrents sans avoir besoin d'une stratégie de
  déploiement `Recreate` de type Kubernetes (Cloud Run n'a pas de concept
  équivalent — une nouvelle révision ne reçoit du trafic qu'une fois que ses
  vérifications de santé sont passées, et les instances de la révision
  précédente sont ensuite drainées).
- **Pas de job de migration séparé.** `GITEA__security__INSTALL_LOCK = "true"` ignore
  l'installateur web de Forgejo ; l'image `forgejo/forgejo` crée et migre son
  propre schéma au démarrage du conteneur contre la base de données vide que le
  job `db-init` a préparée.
- **Aucun compte administrateur n'est amorcé par Terraform.** Il n'y a pas de
  job d'initialisation qui crée un utilisateur administrateur Forgejo — voir
  [Section 3](#3-forgejo-application-behaviour) pour les options côté
  opérateur.
- **`SECRET_KEY` et `INTERNAL_TOKEN` sont auto-générés** et stockés dans
  Secret Manager. Sur Cloud Run, il n'y a pas de restriction CRD SecretSync
  (cela ne s'applique qu'à GKE), ils sont donc injectés directement comme
  variables d'environnement `GITEA__security__` — aucune indirection de fichier
  monté CSI n'est nécessaire.
- **`public_domain` / `public_url` par défaut à `localhost`.** Même si
  le service obtient une URL `run.app` réelle au moment du déploiement,
  `GITEA__server__DOMAIN` / `GITEA__server__ROOT_URL` ne sont pas
  automatiquement synchronisés avec elle — définissez `public_domain` (et
  éventuellement `public_url`) sur le véritable nom d'hôte externe afin que
  les URL de clonage et les liens se résolvent correctement.
- **L'auto-enregistrement est ouvert par défaut** (`GITEA__service__DISABLE_REGISTRATION = "false"`).
- **Redis est provisionné mais pas réellement câblé dans la configuration de
  Forgejo.** `enable_redis = true` par défaut et la fondation injecte
  `REDIS_HOST` / `REDIS_PORT` dans le conteneur, mais
  `Forgejo_Common` ne définit aucune variable `GITEA__cache__*` / `GITEA__session__*`
  / `GITEA__queue__*` pour les consommer — Forgejo revient à ses valeurs par
  défaut de cache/session intégrées à moins que vous n'ajoutiez ce câblage
  vous-même via `environment_variables`.
- **Git-over-SSH n'est pas accessible.** Cloud Run ne route que le trafic
  HTTP(S) sur un seul port de conteneur (3000, HTTP). Le `sshd` interne
  de Forgejo (également supervisé par `s6`, selon le Dockerfile)
  n'a pas de chemin vers le monde extérieur sur cette plateforme — utilisez les
  URL de clonage `https://`, pas `git+ssh://`.
- **Le tag de l'image de base est piloté par un ARG de build spécifique à
  l'application.** L'ARG de build du Dockerfile est `FORGEJO_VERSION`, pas le
  générique `APP_VERSION` que la fondation injecte dans `build_args` (et
  qui autrement gagnerait la fusion et se résoudrait en `forgejo:latest`).
  `application_version = "latest"` correspond au tag épinglé `11` dans la
  configuration de `Forgejo_Common`.

---

## 2. Services Google Cloud et comment les explorer {#2-google-cloud-services--how-to-explore-them}

Toutes les commandes supposent que `PROJECT` et `REGION` sont définis.
Les noms de services et de ressources sont rapportés dans les [Sorties](#5-outputs)
du déploiement.

### A. Cloud Run — le service Forgejo {#a-cloud-run--the-forgejo-service}

Forgejo s'exécute comme un service Cloud Run v2 qui s'adapte automatiquement
en fonction de la charge de requêtes entre le nombre minimum et maximum
d'instances. Chaque déploiement crée une révision immuable ; le trafic peut
être réparti entre les révisions pour des déploiements sûrs.

- **Console :** Cloud Run → sélectionnez le service pour les révisions, le
  trafic, les journaux et les métriques.
- **CLI :**
  ```bash
  gcloud run services list --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --project "$PROJECT" --region "$REGION"
  gcloud run revisions list --service <service-name> --project "$PROJECT" --region "$REGION"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour la mise à l'échelle, la concurrence,
l'environnement d'exécution et la répartition du trafic.

### B. Cloud SQL pour PostgreSQL 15 {#b-cloud-sql-for-postgresql-15}

Forgejo stocke toutes les métadonnées de l'application (utilisateurs, dépôts,
problèmes, demandes de tirage, exécutions d'Actions) dans une instance Cloud
SQL pour PostgreSQL 15 gérée. Par défaut (`enable_cloudsql_volume = false`), le service se
connecte via **TCP IP privé direct** avec `sslmode=require` ; la définition de
`enable_cloudsql_volume = true` bascule vers le socket Unix du proxy d'authentification Cloud
SQL à la place (`sslmode=disable`). Lors du premier déploiement, un job Cloud Run
`db-init` crée le rôle et la base de données de l'application et accorde
les privilèges de schéma ; Forgejo crée et migre ensuite son propre schéma au
premier démarrage du conteneur.

- **Console :** SQL → sélectionnez l'instance pour les connexions, les
  sauvegardes, les drapeaux, les métriques.
- **CLI :**
  ```bash
  gcloud sql instances list --project "$PROJECT"
  gcloud sql instances describe <instance-name> --project "$PROJECT"
  gcloud sql connect <instance-name> --user=<db-user> --database=<db-name> --project "$PROJECT"
  ```

Le nom de l'instance, la base de données, l'utilisateur et le secret du mot de
passe se trouvent dans les [Sorties](#5-outputs). Voir
[App_CloudRun](App_CloudRun.md) pour le modèle de connexion, les sauvegardes et
la rotation des mots de passe.

### C. Cloud Filestore (NFS) — stockage de dépôts {#c-cloud-filestore-nfs--repository-storage}

Les données de dépôt de Forgejo, les objets Git LFS et les pièces jointes
résident sur **NFS (Cloud Filestore)**, monté à l'intérieur du conteneur à
`/mnt/nfs` par défaut (`GITEA__server__APP_DATA_PATH`). C'est là que réside
tout l'état durable et non-base de données de l'application — le système de
fichiers du conteneur lui-même est éphémère.

- **Console :** Filestore → Instances.
- **CLI :**
  ```bash
  gcloud filestore instances list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails de découverte/création
NFS.

### D. Cloud Storage {#d-cloud-storage}

Un bucket générique **Cloud Storage** suffixé par `data` est provisionné
par le défaut `storage_buckets` de la fondation, mais Forgejo n'utilise pas GCS
pour quoi que ce soit — `Forgejo_Common` rapporte toujours une sortie
`storage_buckets` vide. Définissez `create_cloud_storage = false` pour ignorer son
provisionnement si ce n'est pas nécessaire.

- **Console :** Cloud Storage → Buckets.
- **CLI :**
  ```bash
  gcloud storage buckets list --project "$PROJECT" --filter="name~data"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les options GCS Fuse et CMEK.

### E. Redis (provisionné, non câblé) {#e-redis-provisioned-not-wired}

Redis est **activé par défaut** (`enable_redis = true`) ; lorsque `redis_host` est
laissé vide, l'IP de la VM du serveur NFS est utilisée comme point de terminaison
Redis. La fondation injecte `REDIS_HOST` / `REDIS_PORT` dans le
conteneur, mais `Forgejo_Common` ne définit aucune configuration
`GITEA__cache__*` / `GITEA__session__*` / `GITEA__queue__*` pour les utiliser
réellement — Forgejo fonctionne avec ses valeurs par défaut de cache/session/file
d'attente intégrées en mémoire, à moins que vous n'ajoutiez le
`environment_variables` correspondant vous-même.

- **Console :** Memorystore → Redis (si vous utilisez une instance gérée).
- **CLI :**
  ```bash
  redis-cli -h <redis-host> ping
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)'
  ```

### F. Secret Manager {#f-secret-manager}

Deux secrets Forgejo sont générés automatiquement et stockés dans Secret
Manager : `SECRET_KEY` (chiffre les données sensibles telles que les jetons
2FA et OAuth) et `INTERNAL_TOKEN` (authentifie les propres appels API
internes de Forgejo). Le mot de passe de la base de données est le secret géré
par la fondation, aliasé en `GITEA__database__PASSWD` via `db_password_env_var_name` dans
`main.tf`. Sur Cloud Run, les trois arrivent directement comme variables
d'environnement `GITEA__` — il n'y a pas de restriction CRD SecretSync
(cela ne s'applique qu'à GKE), donc aucune indirection de fichier monté CSI
n'est utilisée.

- **Console :** Sécurité → Secret Manager.
- **CLI :**
  ```bash
  gcloud secrets list --project "$PROJECT" --filter="name~forgejo"
  gcloud secrets versions access latest --secret=<secret-name> --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md) pour les détails d'injection et de
rotation.

### G. Réseau et ingress {#g-networking--ingress}

Le service est accessible à son URL `run.app` par défaut
(`ingress_settings = "all"`), ce qui permet un accès public à l'interface web et aux
points de terminaison de clonage/push Git `https://`. Un équilibreur de
charge HTTPS externe avec un domaine personnalisé, Cloud CDN et Cloud Armor
peuvent être ajoutés. Seul le port HTTP (3000) est exposé par Cloud Run — le
`sshd` interne de Forgejo n'a aucun moyen d'être atteint depuis
cette plateforme, donc les URL de clonage `git+ssh://` ne sont pas
disponibles ; clonez via `https://` à la place.

- **Console :** Cloud Run (URL du service) ; Services réseau → Équilibrage de
  charge.
- **CLI :**
  ```bash
  gcloud run services describe <service-name> --region "$REGION" --format='value(status.url)'
  gcloud compute addresses list --project "$PROJECT"
  ```

Voir [App_CloudRun](App_CloudRun.md).

### H. Cloud Logging et Monitoring {#h-cloud-logging--monitoring}

Les journaux des conteneurs sont acheminés vers Cloud Logging ; les métriques
Cloud Run et Cloud SQL sont acheminées vers Cloud Monitoring, avec des tests de
disponibilité et des politiques d'alerte optionnels.

- **Console :** Logging → Explorateur de journaux ; Monitoring → Tableaux de
  bord / Alertes.
- **CLI :**
  ```bash
  gcloud run services logs read <service-name> --project "$PROJECT" --region "$REGION" --limit 50
  ```

---

## 3. Comportement de l'application Forgejo {#3-forgejo-application-behaviour}

- **Configuration de la base de données au premier déploiement.** Le job Cloud
  Run `db-init` exécute `db-init.sh` en utilisant
  `postgres:15-alpine`. Il attend que Cloud SQL accepte les connexions, crée de
  manière idempotente (ou réinitialise le mot de passe) le rôle de
  l'application avec `CREATEDB`, crée la base de données appartenant à ce
  rôle et accorde tous les privilèges de base de données + schéma
  `public` (PG15+). Aucune extension Postgres n'est installée par le
  script — les propres migrations de Forgejo créent tout ce dont il a besoin.
  Le job peut être réexécuté en toute sécurité (`execute_on_apply = true`,
  `max_retries = 3`).
- **Pas de job de migration séparé — la création du schéma se fait au
  démarrage du conteneur.** Avec `GITEA__security__INSTALL_LOCK = "true"`, l'installateur web de
  Forgejo est ignoré ; le point d'entrée `forgejo/forgejo` standard crée et
  migre le schéma dans la base de données vide au premier démarrage, et
  applique d'autres migrations lors des mises à niveau de version
  ultérieures.
- **Aucun compte administrateur n'est créé automatiquement.** Aucun job
  d'initialisation n'exécute une étape `forgejo admin user create` (ou équivalente), et
  l'auto-enregistrement est activé (`GITEA__service__DISABLE_REGISTRATION = "false"`), de sorte que toute
  personne pouvant atteindre le service peut créer un compte. Contrairement à
  GKE, Cloud Run n'a **pas d'équivalent à `kubectl exec`** dans une
  instance en cours d'exécution, de sorte que les options d'amorçage côté
  opérateur diffèrent : soit ajouter une entrée unique à `initialization_jobs`
  qui exécute la CLI Forgejo/Gitea `admin user create` contre la même base de
  données (image : l'image Forgejo déployée ; nécessite les variables
  d'environnement DB que ce module injecte déjà), soit se fier au
  comportement de Forgejo/Gitea selon lequel le premier utilisateur devient
  administrateur si cela s'applique à la version déployée. TODO : confirmer
  l'invocation CLI exacte et si la version déployée de Forgejo accorde
  toujours les droits d'administrateur au premier compte auto-enregistré avant
  de se fier à l'une ou l'autre voie — cela n'a pas été vérifié à partir de
  la source de ce dépôt.
- **Câblage des variables d'environnement de connexion à la base de données.**
  La fondation injecte `DB_HOST` (l'IP privée par défaut, ou le
  répertoire du socket du proxy d'authentification Cloud SQL lorsque
  `enable_cloudsql_volume = true`), `DB_NAME`, `DB_USER`, et le
  secret `DB_PASSWORD` (aliasé en `GITEA__database__PASSWD`). Parce que les
  références `$(VAR)` de style Kubernetes ne sont pas interpolées par
  Cloud Run, `/platform-entrypoint.sh` compose `GITEA__database__{HOST,NAME,USER,SSL_MODE}` au moment de
  l'exécution à partir des valeurs `DB_*` injectées, en se basant
  sur la forme de `DB_HOST` elle-même (début `/` →
  socket, `disable` ; `127.0.0.1`/`localhost` → proxy
  loopback, `disable` ; tout le reste → TCP IP privé direct,
  `require`) — le même point d'entrée fonctionne également sans
  modification sur la variante GKE.
- **L'instance unique par défaut assure la sécurité des écritures basées sur
  NFS.** `max_instance_count` par défaut à `1`, de sorte qu'une
  seule instance Forgejo s'exécute à la fois sur les données de dépôt NFS
  partagées et la base de données Postgres. L'augmenter n'est pas quelque
  chose que ce module a testé pour la correction des écritures Git
  concurrentes — traitez-le avec la même prudence que toute charge de travail
  de système de fichiers partagé.
- **Chemin de santé.** Les deux sondes sont HTTP `GET /api/healthz`, que Forgejo
  sert sans authentification une fois les migrations de base de données
  terminées : sonde de démarrage `initial_delay_seconds=30`, `timeout_seconds=5`,
  `period_seconds=20`, `failure_threshold=10` ; sonde de vivacité
  `initial_delay_seconds=15`, `timeout_seconds=5`, `period_seconds=30`,
  `failure_threshold=3`.
- **Inspecter l'exécution du job et la configuration en cours :**
  ```bash
  gcloud run jobs list --project "$PROJECT" --region "$REGION"
  gcloud run jobs executions list --job <db-init-job-name> --project "$PROJECT" --region "$REGION"
  gcloud run services describe <service-name> --region "$REGION" \
    --format='value(spec.template.spec.containers[0].env)' | tr ';' '\n' | grep GITEA__
  ```

---

## 4. Variables de configuration {#4-configuration-variables}

Les variables sont regroupées exactement comme elles apparaissent sur la
plateforme de déploiement. Seuls les paramètres spécifiques ou notables pour
Forgejo sont listés ; toutes les autres entrées sont héritées de
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
| `resource_labels` | `{}` | Étiquettes appliquées à toutes les ressources. |

### Groupe 3 — Identité de l'application {#group-3--application-identity}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `application_name` | `forgejo` | Nom de base des ressources. Ne pas modifier après le premier déploiement. |
| `display_name` | `Forgejo` | Nom lisible par l'homme affiché dans la Console. |
| `description` | `Forgejo - Self-hosted Git service and source-code hosting` | Description du service. |
| `application_version` | `11` | Tag d'image `codeberg.org/forgejo/forgejo`, appliqué via l'argument de build `FORGEJO_VERSION` spécifique à l'application ; `latest` correspond au tag épinglé `11`. |

### Groupe 4 — Exécution et mise à l'échelle {#group-4--runtime--scaling}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `deploy_application` | `true` | Définissez `false` pour provisionner uniquement l'infrastructure. |
| `container_image_source` | `custom` | Construit le mince wrapper `FROM codeberg.org/forgejo/forgejo:${FORGEJO_VERSION}`. `prebuilt` ne fonctionnera pas sur Cloud Run — pas d'interpolation d'environnement `$(VAR)`. |
| `container_port` | `3000` | Port HTTP de Forgejo ; définit également `GITEA__server__HTTP_PORT`. |
| `cpu_limit` | `1000m` | 1 vCPU par instance (minimum pour un fonctionnement fiable). |
| `memory_limit` | `2Gi` | Minimum 512 Mio ; 2 Gio recommandés pour la production. |
| `cpu_always_allocated` | `false` | Facturation basée sur les requêtes par défaut. Définissez `true` uniquement si vous comptez sur la synchronisation miroir planifiée, le cron de santé du dépôt ou la livraison de webhook temporisée. |
| `min_instance_count` | `0` | `0` active la mise à l'échelle à zéro. |
| `max_instance_count` | `1` | Maintient une seule instance écrivant sur les données de dépôt NFS partagées et la base de données. |
| `execution_environment` | `gen2` | Requis pour les montages NFS. |
| `timeout_seconds` | `300` | Durée maximale de la requête (0 à 3600 secondes). |
| `enable_cloudsql_volume` | `false` | TCP IP privé direct par défaut (`sslmode=require`) ; définissez `true` pour le socket Unix du proxy d'authentification Cloud SQL à la place. |
| `enable_image_mirroring` | `true` | Mettre en miroir l'image Forgejo dans Artifact Registry. |
| `traffic_split` | `[]` | Répartir le trafic entre les révisions pour des déploiements progressifs. |
| `max_revisions_to_retain` | `7` | Déclaré pour la parité de convention ; non référencé par le déploiement de ce module. |

### Groupe 5 — Contrôle d'accès et d'ingress {#group-5--access--ingress-control}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `ingress_settings` | `all` | `all` est requis pour le clonage/push Git public via HTTPS et l'accès web. |
| `vpc_egress_setting` | `PRIVATE_RANGES_ONLY` | Acheminer uniquement le trafic RFC 1918 via VPC. |
| `enable_iap` | `false` | Exiger la connexion Google. **Bloque le clonage/push Git CLI**, qui ne peut pas terminer un flux de navigateur Google OAuth. |
| `iap_authorized_users` / `iap_authorized_groups` | `[]` | Qui peut accéder via IAP. |

### Groupe 6 — Variables d'environnement, secrets et URL publique {#group-6--environment-variables-secrets--public-url}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `environment_variables` | Espaces réservés SMTP | Paramètres non secrets supplémentaires. Les valeurs `GITEA__*` de base sont définies automatiquement — ne définissez pas `GITEA__database__*` ou les clés secrètes auto-générées ici. |
| `secret_environment_variables` | `{}` | Mappage de variable d'environnement → nom de secret Secret Manager. |
| `secret_propagation_delay` | `30` | Secondes à attendre après la création du secret avant de continuer. |
| `secret_rotation_period` | `2592000s` | Fréquence de notification de rotation de Secret Manager. |
| `public_domain` | `localhost` | Définit `GITEA__server__DOMAIN` ; utilisé pour construire les URL de clonage et les liens. À remplacer en production. |
| `public_url` | `""` → `http://<public_domain>/` | Définit `GITEA__server__ROOT_URL`. |

### Groupe 7 — Sauvegarde et restauration {#group-7--backup--restore}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `backup_schedule` | `0 2 * * *` | Cron de sauvegarde automatisée (UTC). |
| `backup_retention_days` | `7` | Rétention ; augmenter pour la production/conformité. |
| `enable_backup_import` / `backup_source` / `backup_uri` / `backup_format` | options de restauration | Restaurer à partir d'une sauvegarde lors du déploiement. |

### Groupe 8 — CI/CD et Binary Authorization {#group-8--cicd--binary-authorization}

Intégration standard App_CloudRun Cloud Build / Cloud Deploy — voir
[App_CloudRun](App_CloudRun.md). Entrées clés : `enable_cicd_trigger`,
`github_repository_url`, `github_token`, `enable_cloud_deploy`,
`enable_binary_authorization`.

### Groupe 9 — Initialisation personnalisée et SQL {#group-9--custom-initialization--sql}

`enable_custom_sql_scripts`, `custom_sql_scripts_bucket`,
`custom_sql_scripts_path`, `custom_sql_scripts_use_root` — exécutez du SQL à partir d'un
bucket GCS après le provisionnement. Le propre schéma de Forgejo ne nécessite
pas de SQL personnalisé. Voir [App_CloudRun](App_CloudRun.md).

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
| `create_cloud_storage` | `true` | Crée le bucket GCS par défaut suffixé par `data`, que Forgejo n'utilise jamais. Définissez `false` pour l'ignorer. |
| `storage_buckets` | `[{ name_suffix = "data" }]` | Buckets GCS supplémentaires au-delà du bucket de données auto-provisionné (inutilisé). |
| `enable_nfs` | `true` | NFS est activé par défaut afin que les dépôts, les objets LFS et les pièces jointes persistent. |
| `nfs_mount_path` | `/mnt/nfs` | Chemin de montage à l'intérieur du conteneur ; définit `GITEA__server__APP_DATA_PATH`. Remplace la valeur par défaut interne de `Forgejo_Common` de `/data`. |
| `nfs_instance_name` / `nfs_instance_base_name` | _(auto-découverte)_ | Ciblez ou nommez un serveur NFS existant/intégré. |
| `gcs_volumes` | `[]` | Montages de volumes GCS Fuse (nécessite gen2) ; inutilisés par Forgejo tel quel. |
| `manage_storage_kms_iam` / `enable_artifact_registry_cmek` | `false` | Options CMEK. |

### Groupe 12 — Backend de base de données {#group-12--database-backend}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `db_name` | `forgejo` | Nom de la base de données, injecté comme `GITEA__database__NAME`. Immuable après le premier déploiement. |
| `db_user` | `forgejo` | Utilisateur de la base de données, injecté comme `GITEA__database__USER`. Mot de passe auto-généré et aliasé en `GITEA__database__PASSWD` (via un `main.tf` de niveau `db_password_env_var_name`, pas une variable visible par l'utilisateur). |
| `database_type` | `POSTGRES_15` | Le seul moteur que `db-init.sh` prend en charge — ne pas modifier. |
| `database_password_length` | `32` | Longueur du mot de passe généré (16-64). |
| `sql_instance_name` / `sql_instance_base_name` | _(auto-découverte)_ | Ciblez ou nommez une instance Cloud SQL existante/intégrée. |
| `enable_auto_password_rotation` / `rotation_propagation_delay_sec` | désactivé | Rotation du mot de passe de la base de données. |

### Groupe 13 — Jobs et tâches planifiées {#group-13--jobs--scheduled-tasks}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `initialization_jobs` | `[]` | Laissez vide pour utiliser le job `db-init` intégré. |
| `cron_jobs` | `[]` | Non utilisé — Forgejo n'a pas de tâches récurrentes planifiées par la plateforme par défaut. |

### Groupe 14 — Observabilité et santé {#group-14--observability--health}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `startup_probe` | HTTP `/api/healthz`, `initial_delay_seconds=30`, `period_seconds=20`, `failure_threshold=10` | Sonde de démarrage spécifique à l'application. |
| `liveness_probe` | HTTP `/api/healthz`, `initial_delay_seconds=15`, `period_seconds=30`, `failure_threshold=3` | Sonde de vivacité spécifique à l'application. |
| `startup_probe_config` | désactivé | Sonde structurée alternative au niveau de Cloud Run (désactivée par défaut ; `startup_probe` prend effet). |
| `health_check_config` | HTTP `/` | Sonde de vivacité structurée alternative au niveau de Cloud Run. |
| `uptime_check_config` | `{ enabled=false, path="/" }` | Test de disponibilité Cloud Monitoring ; désactivé par défaut, activez-le explicitement pour l'activer. |
| `alert_policies` | `[]` | Politiques d'alerte métrique. |

### Groupe 21 — Cache Redis {#group-21--redis-cache}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_redis` | `true` | Injecte `REDIS_HOST` / `REDIS_PORT`, mais `Forgejo_Common` ne définit aucune configuration `GITEA__cache__*`/`session__*`/`queue__*` pour les consommer — voir [Section 1](#1-overview). |
| `redis_host` | `""` | Remplacer pour pointer vers Cloud Memorystore ou une autre instance Redis ; par défaut, l'IP du serveur NFS. |
| `redis_port` | `6379` | Port Redis. |
| `redis_auth` | `""` (sensible) | Mot de passe d'authentification Redis facultatif. |

### Groupe 22 — VPC Service Controls et journalisation d'audit {#group-22--vpc-service-controls--audit-logging}

| Variable | Valeur par défaut | Description |
|---|---|---|
| `enable_vpc_sc` | `false` | Appliquer un périmètre VPC-SC (nécessite `organization_id`). |
| `vpc_cidr_ranges` / `vpc_sc_dry_run` | _(défini)_ | CIDR de niveau d'accès / mode de simulation (dry-run). |
| `enable_audit_logging` | `false` | Journaux d'audit Cloud détaillés. |

Toutes les autres entrées — y compris les miroirs de variables de fondation
inertes (`additional_containers`, `additional_services`, `container_resources`,
`enable_postgres_extensions`/`postgres_extensions`, `enable_mysql_plugins`/`mysql_plugins`,
`network_name`, etc.) déclarées pour la parité de convention mais non
transmises au déploiement Forgejo — suivent le comportement standard de
[App_CloudRun](App_CloudRun.md).

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
| `storage_buckets` | Buckets Cloud Storage créés (non utilisés par Forgejo). |
| `network_name` / `network_exists` / `regions` | Réseau VPC, présence, régions. |
| `container_image` / `container_registry` | Image déployée et dépôt Artifact Registry. |
| `monitoring_enabled` / `monitoring_notification_channels` / `uptime_check_names` | État de la surveillance, canaux, tests de disponibilité. |
| `initialization_jobs` | Noms des jobs de configuration (`db-init`). |
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

> **Validation héritée au moment de la planification.** Ce module transmet sa configuration via le moteur de base [App_CloudRun](App_CloudRun.md), qui valide les valeurs *et les combinaisons* au moment de la planification — un réplica en lecture sans son primaire, IAP sans identités autorisées, un environnement d'exécution `gen1` avec des montages NFS/GCS, un `timeout_seconds`/`backup_retention_days` hors de portée. Une configuration invalide fait échouer le **plan** avec une erreur claire et nommée avant la création de toute ressource, de sorte que la plupart des erreurs ci-dessous sont détectées en amont plutôt qu'au moment de l'apply ou de l'exécution.

| Paramètre | Valeur judicieuse | Risque | Conséquence en cas d'erreur |
|---|---|---|---|
| `database_type` | `POSTGRES_15` | Critique | `db-init.sh` est uniquement `psql` ; MySQL/`NONE` interrompt la configuration de la base de données même si les métadonnées de la variable les listent. |
| `db_name` / `db_user` | Définir une seule fois | Critique | Immuable après le premier déploiement ; le renommage recrée la base de données/l'utilisateur et orpheline tous les dépôts, problèmes et PR stockés avec l'ancien rôle. |
| `SECRET_KEY` / `INTERNAL_TOKEN` (auto-généré) | Ne jamais changer | Critique | La rotation de ceux-ci invalide les données chiffrées 2FA/OAuth et l'authentification API interne de Forgejo, interrompant les opérations Git et API. |
| `enable_nfs` | `true` | Critique | Le désactiver rend les dépôts, les objets LFS et les pièces jointes éphémères — perdus lorsque l'instance de conteneur est remplacée. |
| `enable_backup_import` | `false` sauf en cas de restauration | Critique | L'activation sans `backup_uri` valide fait échouer le job d'importation. |
| `enable_cloudsql_volume` | `false` (par défaut) ou `true` | Élevé | La valeur par défaut se connecte via TCP IP privée directe nécessitant SSL — assurez-vous que `vpc_egress_setting` et les règles de pare-feu l'autorisent. La définition de `true` bascule vers le socket Unix ; la sélection du mode SSL du point d'entrée suppose le mode réellement actif. |
| `public_domain` / `public_url` | Nom d'hôte externe réel | Élevé | Par défaut à `localhost` / `http://localhost/`, produisant des URL de clonage Git incorrectes et des liens brisés jusqu'à ce qu'ils soient remplacés. |
| `GITEA__service__DISABLE_REGISTRATION` (via `environment_variables`) | `true` pour les instances non publiques | Élevé | L'auto-enregistrement est ouvert par défaut et aucun compte administrateur n'est créé automatiquement — toute personne atteignant le service peut s'inscrire. |
| Compte administrateur initial | Créer manuellement après le déploiement | Élevé | Aucun job d'initialisation ne démarre un administrateur ; Cloud Run n'a pas d'équivalent `kubectl exec`, donc la récupération nécessite une entrée `initialization_jobs` unique ou l'exécution de la CLI sur la même base de données. |
| `enable_iap` | uniquement lorsque l'accès Git CLI n'est pas nécessaire | Élevé | IAP nécessite une connexion Google interactive que la CLI `git` ne peut pas effectuer — le clonage/push via HTTPS est interrompu pour tous les clients non-navigateurs. |
| `ingress_settings` | `all` | Élevé | La définition à `internal` bloque tout clonage/push Git externe et l'accès web. |
| `enable_redis` | `true`, mais confirmez que c'est réellement nécessaire | Moyen | `REDIS_HOST`/`REDIS_PORT` sont injectés sans effet à moins que vous n'ajoutiez également la configuration `GITEA__cache__*`/`GITEA__session__*` correspondante — provisionnement de la capacité Redis sans aucun avantage sinon. |
| `max_instance_count` | `1` (par défaut) | Moyen | L'augmenter permet à plusieurs instances de partager le même répertoire de données Git basé sur NFS et la même base de données Postgres ; la correction multi-instance pour les écritures Git concurrentes n'est pas documentée ni testée ici. |
| `application_version` | `11` ou une balise spécifique épinglée | Moyen | `latest` ne suit pas l'amont — l'argument de build `FORGEJO_VERSION` du Dockerfile mappe `"latest"` à la balise épinglée `11`, donc un paramètre `latest` simple reste silencieusement sur cet épinglage. |
| `memory_limit` | `2Gi` | Moyen | Minimum 512 Mio ; des valeurs inférieures risquent des arrêts OOM lors d'opérations de dépôt concurrentes. |
| `storage_buckets` / `create_cloud_storage` | Laisser tel quel ou définir `create_cloud_storage = false` | Faible | Le bucket par défaut suffixé `data` est provisionné mais inutilisé par Forgejo (toutes les données de l'application résident sur NFS/Postgres) — coût mineur inutile s'il est laissé activé sans nécessité. |
| Git-over-SSH | Non disponible sur cette plateforme | Faible | Cloud Run expose uniquement le port HTTP(S) ; les URL de clonage `git+ssh://` ne fonctionneront pas quelle que soit la configuration — utilisez `https://`. |
| `backup_retention_days` | `7` (augmenter pour la production) | Moyen | Trop court pour la rétention de conformité. |

---

Pour le comportement de base référencé tout au long — identité de service, mise à l'échelle et concurrence, entrée et équilibrage de charge, CI/CD, Cloud Armor, IAP, Binary Authorization, VPC-SC, sauvegardes et mise en miroir d'images — voir **[App_CloudRun](App_CloudRun.md)**. La configuration d'application spécifique à Forgejo (câblage de base de données, secrets et disposition NFS) est définie dans le module `Forgejo_Common` et partagée avec la variante GKE de cette application.

## Guides associés {#related-guides}

- [Lab pratique : Forgejo sur Cloud Run](../labs/Forgejo_CloudRun.md) — déployez-le étape par étape, avec les écrans de la console et les commandes à chaque étape.
- [Forgejo sur GKE Autopilot](Forgejo_GKE.md) — la même application sur Kubernetes, lorsque vous avez besoin de l'autre cible de déploiement.
- [Forgejo Common — Configuration d'application partagée](Forgejo_Common.md) — la configuration partagée par les deux cibles de déploiement.
